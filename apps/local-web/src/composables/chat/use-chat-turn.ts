import { computed, shallowRef } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import type {
  ChatSessionResponse,
  ChatTurnEvent,
} from "@vynel/contracts/chat/chat-http";
import { useVynel } from "../use-vynel.js";
import { useUiStore } from "../../stores/ui-store.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { streamChatTurnEvents } from "./chat-turn-stream.js";
import type { TurnAttachmentInput } from "./turn-attachments.js";
import {
  applyChatTurnEvent,
  createActiveTurnView,
} from "./active-turn-view.js";
import type { ActiveTurnView } from "./active-turn-view.js";
import { sessionKeys } from "./session-keys.js";
import type { SessionScope } from "./session-scope.js";
import { workspaceKeys } from "../workspaces/workspace-keys.js";

// Drives one live turn against the real SSE stream. Each ChatTurnEvent folds
// into the active-turn view (transport-blind — the same pure fold the parser
// tests cover); once the server-persisted turn ends, history reconciles by
// invalidation (letterman rule). Approvals are decided out-of-band through the
// approvals API and the stream reflects the resolution, so this engine only
// streams and interrupts.
export function useChatTurn(options: {
  scope: () => SessionScope;
  onSessionCreated?: (session: ChatSessionResponse) => void;
}) {
  const vynel = useVynel();
  const ui = useUiStore();
  const queryClient = useQueryClient();
  const activity = useActivityStore();

  const view = shallowRef<ActiveTurnView | null>(null);
  /** The session the in-flight turn renders into — known up front for a resume/
   *  continue, or learned from `session-created` for a fresh conversation. */
  const activeSessionId = shallowRef<string | null>(null);
  let abortController: AbortController | null = null;

  const isStreaming = computed(
    () => view.value !== null && view.value.status === "streaming",
  );

  function ingest(event: ChatTurnEvent) {
    if (!view.value) return;
    view.value = applyChatTurnEvent(view.value, event);
    if (event.kind === "session-created") {
      activeSessionId.value = event.session.id;
      options.onSessionCreated?.(event.session);
      // A fresh conversation appears in the Sessions library mid-turn — the
      // full sessionKeys.all reconcile still runs once the turn settles.
      void queryClient.invalidateQueries({ queryKey: sessionKeys.overview() });
    }
  }

  async function startTurn(input: {
    sessionId: string | null;
    isContinuous: boolean;
    userText: string;
    attachments?: TurnAttachmentInput[];
  }) {
    if (isStreaming.value) return;

    const scope = options.scope();
    view.value = createActiveTurnView();
    activeSessionId.value = input.sessionId;
    activity.turnStarted();
    abortController = new AbortController();

    try {
      const stream = streamChatTurnEvents(vynel, {
        scope,
        userMessageText: input.userText,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        model: ui.composerModelId,
        // Both scopes carry the composer's session mode — a global turn's mode also
        // governs any delegation the brain enqueues (surface-up step 1).
        mode: ui.composerMode,
        // Auto means "omit the field" — the provider's adaptive default.
        ...(ui.composerThinkingEffort !== "auto"
          ? { thinkingEffort: ui.composerThinkingEffort }
          : {}),
        signal: abortController.signal,
        // Global root manages its own thread. A workspace turn continues its
        // primary, resumes a picked session, or starts fresh.
        ...(scope.kind === "workspace"
          ? input.isContinuous
            ? { continueRoot: true }
            : input.sessionId !== null
              ? { resumeSessionId: input.sessionId }
              : {}
          : {}),
      });
      for await (const event of stream) ingest(event);
    } catch (error) {
      settleFailedTurn(error);
    } finally {
      activity.turnEnded();
      abortController = null;
    }

    // The server persisted the turn — reconcile every session view by refetch.
    await queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    // A global (brain) turn can create a workspace via register_workspace —
    // refresh the list so a newly created one appears without a manual refetch.
    if (scope.kind === "global") {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
    }
    view.value = null;
    activeSessionId.value = null;
  }

  // A dropped or aborted stream still has to settle the view. An abort is the
  // user's interrupt; anything else surfaces as a turn error.
  function settleFailedTurn(error: unknown) {
    const sessionId = activeSessionId.value ?? "";
    if (isAbortError(error)) {
      ingest({ kind: "session-interrupted", sessionId });
    } else {
      ingest({
        kind: "session-errored",
        sessionId,
        errorCode: "stream-failed",
        errorMessage:
          error instanceof Error ? error.message : "The turn stream failed.",
        isRecoverable: true,
      });
    }
    ingest({ kind: "turn-stream-ended" });
  }

  function interrupt() {
    abortController?.abort();
    // Actively stop the server-side turn on BOTH scopes — without the server
    // call the abort only tears down this client's stream while the turn runs
    // on detached to completion. Best-effort — a failed interrupt call is
    // safe to ignore here (the abort already settled the UI).
    const scope = options.scope();
    const sessionId = activeSessionId.value;
    if (scope.kind === "workspace" && sessionId !== null) {
      void vynel.chat
        .interruptSession(scope.workspaceId, sessionId)
        .catch(() => undefined);
    } else if (scope.kind === "global") {
      void vynel.root.interruptTurn().catch(() => undefined);
    }
  }

  return { view, activeSessionId, isStreaming, startTurn, interrupt };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

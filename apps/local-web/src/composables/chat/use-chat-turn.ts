import { computed, onScopeDispose, shallowRef } from "vue";
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
import {
  invalidateWorkViews,
  isWorkMutatingToolName,
} from "./work-view-invalidation.js";

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
  /** True when the in-flight turn was sent from the CONTINUOUS thread — the
   *  overlay-visibility resolver keys on the turn's ORIGIN, never on a live
   *  query value that can change mid-turn (`visible-active-turn.ts`). */
  const startedContinuous = shallowRef(false);
  /** The last turn's failure, kept AFTER the overlay tears down — the overlay's
   *  own error note lives milliseconds before settle wipes it (the silent-vanish
   *  bug). Cleared on the next send. */
  const errorText = shallowRef<string | null>(null);
  let abortController: AbortController | null = null;
  // Tab switches re-key the RouterView with no KeepAlive — without this, the
  // orphaned reader kept draining from a dead view, retargeting the old tab's
  // shell and firing global invalidations for the rest of the turn. Client
  // abort only: the SERVER turn keeps running (rows persist per chunk) and the
  // activity feed reports it as a background turn until it settles.
  let isDisposed = false;
  onScopeDispose(() => {
    isDisposed = true;
    abortController?.abort();
  });

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
    // The assistant just wrote the task list or the step dock — refresh them
    // NOW so the dock ticks while the turn is still running, not after it.
    if (
      event.kind === "tool-call-completed" &&
      isWorkMutatingToolName(event.toolCall.toolName)
    ) {
      void invalidateWorkViews(queryClient);
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
    startedContinuous.value = input.isContinuous;
    errorText.value = null;
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
        thinkingEffort: ui.composerThinkingEffort,
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
      // The stream closed with NO terminal frame at all — a server crash
      // mid-turn used to end here looking exactly like success, pinning
      // "working" forever. A stream the server ENDED deliberately
      // (`turn-stream-ended`, hasEnded) is not a drop.
      if (
        view.value !== null &&
        view.value.status === "streaming" &&
        !view.value.hasEnded
      ) {
        settleFailedTurn(
          new Error(
            "The connection to the assistant dropped mid-turn — anything already produced is in the transcript.",
          ),
        );
      }
    } catch (error) {
      settleFailedTurn(error);
    } finally {
      activity.turnEnded();
      abortController = null;
    }

    // A disposed instance (tab switch mid-turn) stops here: no error note, no
    // invalidation storm from a dead view — the activity feed settles history
    // when the server turn ends.
    if (isDisposed) return;

    // Keep the failure visible past the overlay teardown below.
    if (view.value?.status === "errored" && view.value.error !== null) {
      errorText.value = view.value.error.message;
    }

    // The server persisted the turn — reconcile every session view by refetch.
    // BOUNDED: a hung refetch must not strand the overlay (and the send queue
    // behind it) forever; past the deadline the overlay clears and the refetch
    // finishes in the background.
    await Promise.race([
      queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
    // The turn may have written tasks or steps through its own tools — the
    // settle used to reconcile only the session views, leaving both stale
    // until something else refetched.
    void invalidateWorkViews(queryClient);
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

  return {
    view,
    activeSessionId,
    startedContinuous,
    isStreaming,
    errorText,
    startTurn,
    interrupt,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

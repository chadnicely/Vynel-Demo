import { computed, shallowRef } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import type {
  ChatSessionResponse,
  ChatTurnEvent,
} from "@vynel/contracts/chat/chat-http";
import type { DemoTurnHandle } from "../../demo/chat-turn-player.js";
import { playDemoTurn } from "../../demo/chat-turn-player.js";
import { buildDemoTurnScript } from "../../demo/turn-script.js";
import { buildGlobalDelegationTurn } from "../../demo/delegation-scenario.js";
import type { DemoTurnPlan } from "../../demo/delegation-scenario.js";
import { buildTurnResultFromView } from "../../demo/persist-turn.js";
import {
  DEMO_GLOBAL_ROOT_WORKSPACE_ID,
  demoStore,
} from "../../demo/demo-store.js";
import { makeDemoId } from "../../demo/demo-ids.js";
import { useActivityStore } from "../../stores/activity-store.js";
import {
  applyChatTurnEvent,
  createActiveTurnView,
} from "./active-turn-view.js";
import type { ActiveTurnView } from "./active-turn-view.js";
import { sessionKeys } from "./session-keys.js";
import type { SessionScope } from "./session-scope.js";

// Drives one live turn for a chat surface. DEMO TRANSPORT today (scripted
// player); when `POST /sessions/turn` lands, startTurn swaps its body for the
// SSE reader and everything else — folding, rendering, interrupts, approvals —
// stays as is. Global turns play the delegation scenario (the brain routes
// work to a workspace); workspace turns run tools directly.
export function useChatTurn(options: {
  scope: () => SessionScope;
  onSessionCreated?: (session: ChatSessionResponse) => void;
}) {
  const queryClient = useQueryClient();
  const activity = useActivityStore();

  const view = shallowRef<ActiveTurnView | null>(null);
  /** The session the in-flight turn belongs to — set synchronously by startTurn
   *  so the view can bind the live turn to the right thread immediately. */
  const activeSessionId = shallowRef<string | null>(null);
  let handle: DemoTurnHandle | null = null;

  const isStreaming = computed(
    () => view.value !== null && view.value.status === "streaming",
  );

  function ingest(event: ChatTurnEvent) {
    if (!view.value) return;
    view.value = applyChatTurnEvent(view.value, event);
    if (event.kind === "session-created") {
      options.onSessionCreated?.(event.session);
      void queryClient.invalidateQueries({ queryKey: sessionKeys.lists() });
    }
  }

  async function startTurn(input: {
    sessionId: string | null;
    userText: string;
  }) {
    if (isStreaming.value) return;

    const scope = options.scope();
    const workspaceId =
      scope.kind === "global"
        ? DEMO_GLOBAL_ROOT_WORKSPACE_ID
        : scope.workspaceId;

    const existingSessionId = input.sessionId;
    const isNewSession = existingSessionId === null;
    const session =
      existingSessionId === null
        ? demoStore.createSession(
            workspaceId,
            deriveSessionTitle(input.userText),
          )
        : demoStore.getSessionDetail(existingSessionId)?.session;
    if (!session) return;

    const plan: DemoTurnPlan =
      scope.kind === "global"
        ? buildGlobalDelegationTurn({
            session,
            userText: input.userText,
            isNewSession,
          })
        : buildDemoTurnScript({
            session,
            userText: input.userText,
            isNewSession,
          });

    view.value = createActiveTurnView();
    activeSessionId.value = session.id;
    activity.turnStarted();
    handle = playDemoTurn(session.id, plan.steps, ingest);
    plan.startChildren?.(queryClient);
    try {
      await handle.done;
    } finally {
      activity.turnEnded();
      handle = null;
    }

    persistFinishedTurn(session.id, plan);
    await queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    view.value = null;
    activeSessionId.value = null;
  }

  // Mirrors what the real backend does server-side: the turn's outcome becomes
  // chat history, and the UI reconciles by invalidation (letterman rule).
  function persistFinishedTurn(sessionId: string, plan: DemoTurnPlan) {
    const finished = view.value;
    if (!finished) return;

    const result = buildTurnResultFromView({
      sessionId,
      userMessage: plan.userMessage,
      assistantMessageId: plan.assistantMessageId,
      view: finished,
      ...(plan.assistantExtras !== undefined && {
        extras: plan.assistantExtras,
      }),
    });
    if (result) demoStore.appendTurnResult(sessionId, result);
  }

  function interrupt() {
    handle?.interrupt();
  }

  // The demo seam for inline approvals: pokes the player today, calls
  // `client.approvals.decide` when the stream is real.
  function decideApproval(
    approvalRequestId: string,
    decision: "approved" | "denied",
  ) {
    handle?.decideApproval(approvalRequestId, decision);
  }

  return {
    view,
    activeSessionId,
    isStreaming,
    startTurn,
    interrupt,
    decideApproval,
  };
}

function deriveSessionTitle(userText: string): string {
  const firstLine = userText.split("\n", 1)[0] ?? "";
  return firstLine.length > 48
    ? `${firstLine.slice(0, 48)}…`
    : firstLine || makeDemoId("chat");
}

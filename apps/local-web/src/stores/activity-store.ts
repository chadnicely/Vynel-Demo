import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  SessionActivityEvent,
  SessionTurnActivity,
} from "@vynel/contracts/chat/session-activity";

// Cross-view liveness, two sources folded together:
//  - local turns — streams THIS tab started (use-chat-turn counts them);
//  - server turns — everything the /activity/stream feed reports in flight:
//    another tab's turn, a Telegram/voice turn, a schedule fire.
// The titlebar presence dot reads the union; the chat views read the server
// map to go live (poll their thread) while a turn they didn't start runs in
// their scope.
export const useActivityStore = defineStore("activity", () => {
  const runningTurnCount = ref(0);
  /** Turns the SERVER reports in flight, keyed by turnId (feed vocabulary). */
  const serverTurns = ref<Record<string, SessionTurnActivity>>({});

  const isTurnRunning = computed(
    () =>
      runningTurnCount.value > 0 || Object.keys(serverTurns.value).length > 0,
  );

  const hasGlobalServerTurn = computed(() =>
    Object.values(serverTurns.value).some((turn) => turn.scopeKind === "global"),
  );

  /** The origin of the running global turn (indicator copy) — null when none. */
  const globalServerTurnOrigin = computed(
    () =>
      Object.values(serverTurns.value).find(
        (turn) => turn.scopeKind === "global",
      )?.origin ?? null,
  );

  function hasServerTurnInWorkspace(workspaceId: string): boolean {
    return Object.values(serverTurns.value).some(
      (turn) =>
        turn.scopeKind === "workspace" && turn.workspaceId === workspaceId,
    );
  }

  /** The running turn on ONE session (any scope) — the thread watcher reads
   *  its `startedAt` so a reattached overlay's elapsed clock is the turn's,
   *  not the switch-back's. Null when the session is idle. */
  function serverTurnForSession(sessionId: string): SessionTurnActivity | null {
    return (
      Object.values(serverTurns.value).find(
        (turn) => turn.sessionId === sessionId,
      ) ?? null
    );
  }

  function turnStarted() {
    runningTurnCount.value += 1;
  }

  function turnEnded() {
    runningTurnCount.value = Math.max(0, runningTurnCount.value - 1);
  }

  /** Fold one feed event. Replaces the map so consumers' computeds re-run. */
  function applyServerActivity(event: SessionActivityEvent) {
    if (event.kind === "turn-started") {
      const { kind: _kind, ...turn } = event;
      serverTurns.value = { ...serverTurns.value, [turn.turnId]: turn };
      return;
    }
    const existing = serverTurns.value[event.turnId];
    if (existing === undefined) return; // ended-before-seen — nothing to fold
    if (event.kind === "turn-updated") {
      serverTurns.value = {
        ...serverTurns.value,
        [event.turnId]: { ...existing, sessionId: event.sessionId },
      };
      return;
    }
    // ONLY turn-ended removes. The feed also carries turn-step narration
    // (turn-tool-started/settled, approval bells) with a known turnId — folding
    // those as removals would kill a live turn from the presence map.
    if (event.kind !== "turn-ended") return;
    const next = { ...serverTurns.value };
    delete next[event.turnId];
    serverTurns.value = next;
  }

  /** The feed dropped — without a live subscription the map is stale. */
  function resetServerTurns() {
    serverTurns.value = {};
  }

  return {
    runningTurnCount,
    serverTurns,
    isTurnRunning,
    hasGlobalServerTurn,
    globalServerTurnOrigin,
    hasServerTurnInWorkspace,
    serverTurnForSession,
    turnStarted,
    turnEnded,
    applyServerActivity,
    resetServerTurns,
  };
});

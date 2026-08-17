import { computed } from "vue";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import type { SessionTurnActivity } from "@vynel/contracts/chat/session-activity";
import {
  deriveSessionStatus,
  type SessionStatusView,
} from "@vynel/contracts/chat/session-status";
import { useActivityStore } from "../../stores/activity-store.js";
import { useSessionsOverview } from "./use-sessions-overview.js";

// THE one home for a CONVERSATION's status light (Move 3) — the per-session
// sibling of `use-workspace-status`. Facts come from two places the app
// already watches:
//   - each overview entry's `statusFacts` (the assistant-set state, the last
//     assistant error, pending approvals, the supersession anchor),
//   - the live activity feed (an in-flight turn — fresher than any poll).
// The ladder itself lives in `deriveSessionStatus` (contracts), so the
// Sessions row and the node screen's dot can never disagree.
//
// No client-side retention of `turn-ended.outcome` is needed: a failed turn
// persists its error on the assistant row, and the feed's turn-end
// invalidation refetches the overview — the durable fact IS the signal.

/** The entry's in-flight turn start, or null when quiet. A turn belongs to
 *  THIS conversation when it runs on any of its chain segments; a workspace
 *  entry also owns its room's turn, whose session id resolves a frame later
 *  (the row must go live immediately — the shipped `isWorking` rule). */
export function liveTurnStartedAtForEntry(
  entry: SessionsOverviewEntry,
  serverTurns: Record<string, SessionTurnActivity>,
): string | null {
  const segmentIds = new Set(entry.segments.map((segment) => segment.sessionId));
  const turns = Object.values(serverTurns);
  const onSegment = turns.find(
    (turn) => turn.sessionId !== null && segmentIds.has(turn.sessionId),
  );
  if (onSegment !== undefined) return onSegment.startedAt;
  if (entry.scope === "workspace" && entry.workspaceId !== null) {
    const inRoom = turns.find(
      (turn) =>
        turn.scopeKind === "workspace" && turn.workspaceId === entry.workspaceId,
    );
    if (inRoom !== undefined) return inRoom.startedAt;
  }
  // The assistant thread's own pre-resolution window. A global turn announces
  // itself before its session id is known, and on a COLD start that gap is the
  // whole engine spawn — long enough for a retry after a failed turn to show
  // red while it is in fact running (problem outranks running in the ladder).
  // Safe to claim: every OTHER global-scope turn on the feed is a spawned
  // session's, and those always carry their session id from the start.
  if (entry.scope === "global") {
    const brainTurn = turns.find(
      (turn) => turn.scopeKind === "global" && turn.sessionId === null,
    );
    if (brainTurn !== undefined) return brainTurn.startedAt;
  }
  return null;
}

export function useSessionStatuses() {
  const activity = useActivityStore();
  const overviewQuery = useSessionsOverview(true);

  const statusBySessionId = computed<Record<string, SessionStatusView>>(() => {
    const views: Record<string, SessionStatusView> = {};
    for (const entry of overviewQuery.data.value ?? []) {
      views[entry.sessionId] = deriveSessionStatus(entry.statusFacts, {
        liveTurnStartedAt: liveTurnStartedAtForEntry(entry, activity.serverTurns),
      });
    }
    return views;
  });

  /** The assistant thread's own view — the global row's status source (fork B
   *  keeps the brain's chain in the overview as the "Assistant" entry). Null
   *  until the overview lands. */
  const globalStatusView = computed<SessionStatusView | null>(() => {
    const globalEntry = (overviewQuery.data.value ?? []).find(
      (entry) => entry.scope === "global",
    );
    return globalEntry === undefined
      ? null
      : (statusBySessionId.value[globalEntry.sessionId] ?? null);
  });

  function statusFor(sessionId: string): SessionStatusView | null {
    return statusBySessionId.value[sessionId] ?? null;
  }

  return { statusBySessionId, globalStatusView, statusFor };
}

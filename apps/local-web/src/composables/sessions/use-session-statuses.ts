import { computed, toValue, type MaybeRefOrGetter } from "vue";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import type { SessionTurnActivity } from "@vynel/contracts/chat/session-activity";
import {
  deriveSessionStatus,
  type SessionStatusView,
} from "@vynel/contracts/chat/session-status";
import { useActivityStore } from "../../stores/activity-store.js";
import { matchTurnToIdentity } from "../activity/match-turn-to-identity.js";
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
 *  THIS conversation when it runs on any of its chain segments, or when it
 *  names the conversation's continuing identity — the PRE-RESOLUTION window,
 *  where a turn has announced itself but not yet learned its session id. On a
 *  cold start that gap is the whole engine spawn, long enough for a retry
 *  after a failed turn to show red while it is in fact running (problem
 *  outranks running in the ladder).
 *
 *  Identity, not absence (session-hardening D1). This used to claim ANY
 *  global-scope turn with no session id for the Assistant row, on the
 *  invariant that only spawned turns share that scope and those carry their
 *  ids from the start — false since the voice arc (a spoken turn lit the
 *  Assistant as running, hiding a standing problem) and false for delegated
 *  runs (which announce with a primary id and no session id). Both now
 *  resolve to their own entry, or to none.
 *
 *  A workspace entry also owns its ROOM's turn, whose session id resolves a
 *  frame later (the row must go live immediately — the shipped `isWorking`
 *  rule). */
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

  const primarySessionId = entry.primarySessionId;
  if (primarySessionId !== null) {
    const onIdentity = turns.find((turn) =>
      matchTurnToIdentity(turn, { kind: "primary", primarySessionId }),
    );
    if (onIdentity !== undefined) return onIdentity.startedAt;
  }

  const workspaceId = entry.workspaceId;
  if (entry.scope === "workspace" && workspaceId !== null) {
    const inRoom = turns.find((turn) =>
      matchTurnToIdentity(turn, { kind: "workspace", workspaceId }),
    );
    if (inRoom !== undefined) return inRoom.startedAt;
  }
  return null;
}

/**
 * @param entries A caller's OWN list of entries, when it has one. The Sessions
 * library pages its rows, and a row scrolled in on page three is not in the
 * shared (capped) overview — so without this its status light would be blank
 * for exactly the conversations paging exists to reach. Passing entries also
 * skips subscribing to the shared read, since the facts already rode in on
 * each entry. Omit it and the shared overview is the source, as before.
 */
export function useSessionStatuses(
  entries?: MaybeRefOrGetter<readonly SessionsOverviewEntry[] | undefined>,
) {
  const activity = useActivityStore();
  const overviewQuery = useSessionsOverview(entries === undefined);
  const source = computed<readonly SessionsOverviewEntry[]>(
    () => toValue(entries) ?? overviewQuery.data.value ?? [],
  );

  const statusBySessionId = computed<Record<string, SessionStatusView>>(() => {
    const views: Record<string, SessionStatusView> = {};
    for (const entry of source.value) {
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
    const globalEntry = source.value.find((entry) => entry.scope === "global");
    return globalEntry === undefined
      ? null
      : (statusBySessionId.value[globalEntry.sessionId] ?? null);
  });

  function statusFor(sessionId: string): SessionStatusView | null {
    return statusBySessionId.value[sessionId] ?? null;
  }

  return { statusBySessionId, globalStatusView, statusFor };
}

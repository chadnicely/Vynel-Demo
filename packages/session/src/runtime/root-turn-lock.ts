// Serializes global-root turns PER USER (brain-tree Ch4, the advisor-caught blocker). There is
// ONE root SDK session per user, and the session-swap write (`currentSdkSessionId`) assumes a
// SINGLE writer. Channels are a FIREHOSE: the channels-service fires `processInboundMessage`
// concurrently (1s cadence; root turns take seconds), so two channel messages would concurrently
// resume + swap the same root session → one turn's messages orphan. BOTH global-root turn paths
// run their WHOLE turn under this lock — the channel runner (`runGlobalRootTurn`) AND the web SSE
// route (`streamGlobalRootTurn`) — each from resolve-target → resume → swap → drain. The web route
// relocates its setup INSIDE the lock so `resolveGlobalRootConversationTarget` (which reads
// `currentSdkSessionId`) is serialized too; a wrapper around only the stream body would still
// resume stale. So web-vs-channel AND channel-vs-channel overlaps for a user are strictly serial
// (brain-tree Ch4 fully closed — the web-route lock was the last deferred piece, 2026-06-27).
//
// In-process (Phase 1 single process). The map holds one entry per LOCK KEY — the user id for the
// global conversation, `${userId}:voice` for the spoken twin (voice-session arc: two continuing
// sessions, two single-writer domains) — so it is bounded by users × identities. Phase 2
// (multi-pod) replaces this with a Postgres advisory lock keyed the same way.

const rootTurnTailByLockKey = new Map<string, Promise<unknown>>()
// Turns queued or running per key — the `isRootTurnLockBusy` read. Kept beside
// the tail (not derived from it) because a settled promise cannot be asked
// whether it settled; the count drops as each chained turn settles.
const rootTurnCountByLockKey = new Map<string, number>()

/** The lock key one global-root identity serializes on: the user id for the global
 *  conversation, `${userId}:voice` for the spoken twin. ONE home for the shape — the
 *  runner derives the key it holds from this, and the SSE stream asks
 *  `isRootTurnLockBusy` about the same key before it parks. */
export function rootTurnLockKey(userId: string, isVoiceTurn: boolean): string {
  return isVoiceTurn ? `${userId}:voice` : userId
}

/** Whether a turn is queued or running on the lock key RIGHT NOW — the global
 *  stream's queued-sentinel probe (`turn-queued { reason: 'busy' }` before it
 *  parks, the workspace/DM streams' `locks.isBusy` twin). */
export function isRootTurnLockBusy(lockKey: string): boolean {
  return (rootTurnCountByLockKey.get(lockKey) ?? 0) > 0
}

/** Run `turn` only after the lock key's previous root turn has settled (success OR failure — a
 *  failed turn must never wedge the chain). Returns the turn's result. */
export function runUnderRootTurnLock<T>(lockKey: string, turn: () => Promise<T>): Promise<T> {
  const previousTail = rootTurnTailByLockKey.get(lockKey) ?? Promise.resolve()
  rootTurnCountByLockKey.set(lockKey, (rootTurnCountByLockKey.get(lockKey) ?? 0) + 1)
  // Chain after the previous turn regardless of its outcome (both handlers run `turn`).
  const chainedTurn = previousTail.then(turn, turn)
  // Runs on BOTH outcomes: drops this turn from the busy count and, being the
  // tail's handler, swallows the value/error so a rejection here never becomes
  // an unhandled rejection (the real value/rejection flows to the caller via
  // `chainedTurn`). The next caller waits for THIS turn to settle.
  const settle = (): void => {
    const remaining = (rootTurnCountByLockKey.get(lockKey) ?? 1) - 1
    if (remaining <= 0) rootTurnCountByLockKey.delete(lockKey)
    else rootTurnCountByLockKey.set(lockKey, remaining)
  }
  rootTurnTailByLockKey.set(lockKey, chainedTurn.then(settle, settle))
  return chainedTurn
}

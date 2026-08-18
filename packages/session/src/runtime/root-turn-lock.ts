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

const swallow = (): void => {}

/** Run `turn` only after the lock key's previous root turn has settled (success OR failure — a
 *  failed turn must never wedge the chain). Returns the turn's result. */
export function runUnderRootTurnLock<T>(lockKey: string, turn: () => Promise<T>): Promise<T> {
  const previousTail = rootTurnTailByLockKey.get(lockKey) ?? Promise.resolve()
  // Chain after the previous turn regardless of its outcome (both handlers run `turn`).
  const chainedTurn = previousTail.then(turn, turn)
  // The next caller waits for THIS turn to settle; swallow the value/error in the tail so a
  // rejection here never becomes an unhandled rejection (the real value/rejection flows to the
  // caller via `chainedTurn`).
  rootTurnTailByLockKey.set(lockKey, chainedTurn.then(swallow, swallow))
  return chainedTurn
}

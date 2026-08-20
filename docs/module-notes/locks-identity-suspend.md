# Locks, identity, suspend — round-2 P2s R2-J / R2-K / R2-L (2026-08-20)

Branch `feature/locks-identity-suspend`; R2-M SKIPPED. Rows: `docs/audits/session-2026-08-19-r2/README.md`
(P2). Doctrine: `session-hardening.md` D5 — "every wait has a bound and an owner".

## L1 · the lock QUEUE gets a bound, a cancel and a heartbeat (R2-J)

One home `packages/session/src/runtime/lock-wait.ts`: `LockWaitOptions` (`maxWaitMs` / `signal` /
`onStillWaiting`), the typed `LockWaitExpiredError` + `LockWaitAbandonedError`, and `waitInLockQueue()`.
Both locks take the options OPTIONALLY — omitted = today's unbounded wait, so the delegation pool, the
schedule fire pool and the channel runner keep their yield/requeue behaviour and their FIFO tests. New
knob `VYNEL_LOCK_WAIT_MAX_MS` (local-api `env.ts`; unset = `VYNEL_INTERACTIVE_TURN_MAX_MS` via
`resolveLockWaitMaxMs`, one home). The three interactive streams build their options in
`apps/local-api/src/streams/turn-queue-wait.ts` — also the one home for the `turn-queued` frame (first
announce AND re-announce) and for the give-up ending (`session-errored`, `lock-wait-exceeded`).
**Reversal, decide deliberately:** a disconnected waiter no longer runs its turn "because the client saw
`turn-queued`" — it leaves the queue, so a message typed and then abandoned mid-queue is DROPPED rather
than delivered. The audit's ground: a turn running for nobody still holds the single-writer key.

## L2 · a begin frame that is not the room's own thread names its identity (R2-K)

`matchTurnToIdentity` is the contract and is NOT extended. Schedule half already fixed
(`build-schedule-fire-deps.ts` stamps `target.primarySessionId`) — verified. `run-agent-run-job.ts`
announced workspace-scope with no primary when `targetPrimarySessionId` was unstamped: the announce now
sits AFTER the resolution phase and names the colleague. A row that resolves no colleague still fires the
room's problem signal, as a `begin(...).end('failed')` pair with no thread to bind to. New api-side census
`packages/session/src/runtime/session-activity-census.test.ts` (roster + payloads through the real feed +
the workspace-with-no-primary allowlist); the web census gains the failure frame.

## L3 · a suspend must not reap live runs (R2-L)

New `apps/local-api/src/services/suspend-aware-lease-sweep.ts`: the 60 s sweeper compares its own
last-tick wall clock to now; past 2x the interval the machine slept, so that ONE tick skips reaping and
re-arms. The BOOT pass stays ungated. No schema change; `delegation-orphan-settlement.ts` not modified.

// The BOUND and the CANCEL every lock QUEUE honours — the missing half of the
// session-hardening bounds doctrine (D5: "every wait has a bound and an
// owner"; audit R2-J). The arc bounded the turn that HOLDS a lock; the waiters
// behind it were still unbounded and uncancellable, so N queued turns behind
// one wedged holder waited N x the interactive cap, and a waiter whose SSE
// client had already gone still took the lock and ran a turn for nobody.
//
// One primitive, two locks: `SessionTargetLocks.acquire` (the workspace /
// spawned-session FIFO) and `runUnderRootTurnLock` (the per-user global chain)
// both park through `waitInLockQueue`. The options are OPTIONAL everywhere —
// omitting them is today's unbounded wait, which is exactly what the background
// callers want (the delegation pool and the schedule fire pool yield or requeue
// instead of parking a user in front of a socket).
//
// Only the PARKING path is bounded. A free key always acquires: the target
// locks register a free key synchronously and the pool's claim loop depends on
// that, so a give-up must never be able to leave a registered key with no
// holder.

import { VynelError } from '@vynel/errors'

/** The wire code the interactive streams put on the give-up frame. */
export const LOCK_WAIT_EXPIRED_ERROR_CODE = 'lock-wait-exceeded'

/** The queue bound was spent before the lock came free — the caller's turn
 *  never started. User-facing wording: the conversation stayed busy. */
export class LockWaitExpiredError extends VynelError {
  readonly code = 'lock_wait_expired'
  readonly httpStatus = 409

  constructor(public readonly maxWaitMs: number) {
    super(
      `the conversation stayed busy for ${formatMinutes(maxWaitMs)} minutes — the turn was not started`,
    )
  }
}

/** The caller went away while queued (an SSE client disconnected), so the
 *  waiter left the queue instead of acquiring and running for nobody. */
export class LockWaitAbandonedError extends VynelError {
  readonly code = 'lock_wait_abandoned'
  readonly httpStatus = 499

  constructor() {
    super('the client disconnected while its turn was queued — the turn was not started')
  }
}

/** How often a still-parked waiter re-announces itself. Modest on purpose: the
 *  frame exists so the composer reads "waiting", not "frozen" — a long park is
 *  a handful of frames, not a stream. */
export const LOCK_WAIT_STILL_WAITING_INTERVAL_MS = 15_000

export interface LockWaitOptions {
  /** The queue bound in ms. Omit = wait as long as it takes (background callers). */
  maxWaitMs?: number
  /** Leave the queue when the caller is gone — the SSE request's signal. */
  signal?: AbortSignal
  /** Fired the moment the waiter parks and every `stillWaitingIntervalMs`
   *  after (the `turn-queued` sentinel's re-announce). MUST NOT throw. */
  onStillWaiting?: () => void
  stillWaitingIntervalMs?: number
}

/** What a lock hands the primitive: the parked promise, how to leave the queue,
 *  and (for a lock that resolves a hold) how to hand a late arrival back. */
export interface LockQueueWaiter<T> {
  /** Resolves when the queue hands this waiter the lock. */
  parked: Promise<T>
  /** Remove this waiter from the queue. Called SYNCHRONOUSLY the instant it
   *  gives up, so the holder's release skips it. */
  leaveQueue: () => void
  /** The hand-over won the race: the abandoned waiter owns the lock and must
   *  hand it straight back, or the key leaks. Omit when there is no hold. */
  handBack?: (acquired: T) => void
}

/**
 * Park in a lock queue under a bound + a cancel, re-announcing while it waits.
 * Resolves with what the queue handed over, or rejects with
 * `LockWaitExpiredError` / `LockWaitAbandonedError` — in which case the waiter
 * is already out of the queue and the lock was never taken.
 */
export async function waitInLockQueue<T>(
  waiter: LockQueueWaiter<T>,
  options: LockWaitOptions,
): Promise<T> {
  let gaveUp = false
  let rejectWait: (err: Error) => void = () => {}
  const giveUp = new Promise<never>((_resolve, reject) => {
    rejectWait = reject
  })
  // Flips the flag SYNCHRONOUSLY inside the timer / abort callback — a
  // microtask-late flag would let a hand-over that raced the bound slip past
  // the leak guard below and strand the key.
  const abandon = (err: Error): void => {
    if (gaveUp) return
    gaveUp = true
    waiter.leaveQueue()
    rejectWait(err)
  }

  const maxWaitMs = options.maxWaitMs
  const bound =
    maxWaitMs === undefined
      ? null
      : setTimeout(() => abandon(new LockWaitExpiredError(maxWaitMs)), maxWaitMs)
  const onAbort = (): void => abandon(new LockWaitAbandonedError())
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted === true) onAbort()

  // The leak guard: a release that landed between the bound firing and this
  // promise settling handed the lock to a waiter that is already gone.
  void waiter.parked.then(
    (acquired) => {
      if (gaveUp) waiter.handBack?.(acquired)
    },
    () => {},
  )

  const announce = options.onStillWaiting
  const heartbeat =
    announce === undefined
      ? null
      : setInterval(announce, options.stillWaitingIntervalMs ?? LOCK_WAIT_STILL_WAITING_INTERVAL_MS)
  announce?.()

  try {
    return await Promise.race([waiter.parked, giveUp])
  } finally {
    if (bound !== null) clearTimeout(bound)
    if (heartbeat !== null) clearInterval(heartbeat)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

function formatMinutes(ms: number): string {
  const minutes = ms / 60_000
  return Number.isInteger(minutes) ? String(minutes) : String(Number(minutes.toPrecision(3)))
}

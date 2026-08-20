// A stream's wait in a LOCK QUEUE — ONE home for the three things every
// interactive stream needs while its turn is parked behind a holder (audit
// R2-J): the budget, the "my client is gone" signal, and the `turn-queued`
// sentinel. Before this the sentinel was hand-written in three streams and
// fired exactly once, so a turn behind a wedged holder looked frozen after the
// first frame, waited with no bound, and — if its client had closed the tab —
// still took the lock and ran a turn for nobody.
//
// Every write goes through `writeSseSafely`: the re-announce fires off a timer,
// and a rejected write from a timer callback is the unhandled-rejection class
// the audit flagged elsewhere.

import type { Context } from 'hono'
import type { SSEStreamingApi } from 'hono/streaming'
import type { Logger } from 'pino'
import {
  LOCK_WAIT_EXPIRED_ERROR_CODE,
  LockWaitExpiredError,
  type LockWaitOptions,
} from '@vynel/session/runtime'
import { writeSseSafely } from './write-sse-safely.js'

/** WHY the turn is waiting — the composer says "patching context" or
 *  "working on a task" instead of showing a frozen thread. */
export type TurnQueuedReason = 'busy' | 'context-patching'

export interface TurnLockWaitInput {
  stream: SSEStreamingApi
  /** The request's own signal (`c.req.raw.signal`). */
  requestSignal: AbortSignal
  /** `resolveLockWaitMaxMs(env)` — the queue budget. */
  maxWaitMs: number
  /** Resolved PER FRAME, so a context swap that starts (or ends) mid-wait is
   *  reported as it actually is. */
  resolveReason: () => TurnQueuedReason
  logger: Logger
}

/**
 * The wait options a stream hands its lock. The client-gone signal is fed from
 * BOTH the request signal and the stream's own abort: which of the two fires on
 * a real disconnect depends on the runtime adapter (on the node path a
 * cancelled response body reaches the stream, not the request), and a bound
 * that only ever fires in a test is worse than no bound at all.
 */
export function buildTurnLockWait(input: TurnLockWaitInput): LockWaitOptions {
  const clientGone = new AbortController()
  const giveUp = (): void => clientGone.abort()
  if (input.requestSignal.aborted) giveUp()
  else input.requestSignal.addEventListener('abort', giveUp, { once: true })
  // Both halves, for the stream too: `onAbort` only appends a subscriber, so a
  // stream already aborted when the turn reaches its lock would never fire it
  // and the waiter would park for a client that is provably gone.
  if (input.stream.aborted) giveUp()
  else input.stream.onAbort(giveUp)
  return {
    maxWaitMs: input.maxWaitMs,
    signal: clientGone.signal,
    onStillWaiting: () => {
      // The announce MUST NOT throw (`LockWaitOptions`) and nothing upstream
      // enforces it: the first announce runs OUTSIDE `waitInLockQueue`'s try,
      // so a throw here — `resolveReason` reading a swap registry, a
      // circular payload — would skip `leaveQueue` and leak the lock key for
      // the process lifetime. A missing "still waiting" frame is a cosmetic
      // loss; a leaked key silently wedges the conversation forever.
      try {
        void writeSseSafely(
          input.stream,
          'turn-queued',
          JSON.stringify({ reason: input.resolveReason() }),
          input.logger,
        )
      } catch (err) {
        input.logger.warn({ err }, 'the turn-queued announce threw — the turn keeps waiting')
      }
    },
  }
}

/** `c.req.raw.signal` without the raw-request reach in every stream. */
export function requestAbortSignal(c: Context): AbortSignal {
  return c.req.raw.signal
}

/**
 * The give-up ending: a clean typed failure frame so the composer folds "the
 * conversation stayed busy" instead of waiting on a close that reads as a
 * completed turn. Returns false when `err` is not a spent-bound give-up (a
 * disconnect needs no frame — nobody is reading — and anything else is the
 * caller's own error to route).
 */
export async function writeLockWaitGiveUp(
  stream: SSEStreamingApi,
  err: unknown,
  context: { sessionId: string | null; logger: Logger },
): Promise<boolean> {
  if (!(err instanceof LockWaitExpiredError)) return false
  context.logger.warn(
    { maxWaitMs: err.maxWaitMs },
    'turn gave up in the lock queue — the conversation stayed busy for its whole budget',
  )
  await writeSseSafely(
    stream,
    'session-errored',
    JSON.stringify({
      kind: 'session-errored',
      sessionId: context.sessionId ?? '',
      errorCode: LOCK_WAIT_EXPIRED_ERROR_CODE,
      errorMessage: err.message,
      isRecoverable: false,
    }),
    context.logger,
  )
  return true
}

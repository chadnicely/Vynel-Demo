// The INTERACTIVE turn's wall clock — ONE home for the bound every user-facing
// stream (global / voice, workspace chat, spawned-session DM) puts on a turn it
// holds a lock for (session-hardening arc, decision D5: "every wait has a bound
// and an owner"). Built on `startPausableTimeout` + an `ApprovalWaitGate`, so
// the clock measures WORKING time only: it suspends while the turn is parked
// on a human decision (an approval card, an `ask_user` form) and resumes with
// its remaining budget when the decision lands. Every background path already
// had a budget; the interactive paths had none, and the interactive global
// path holds the lock the background paths queue on — one hung provider await
// wedged channels + deliveries for the process lifetime (audit G1/S11).
//
// The clock STARTS when the turn holds its lock (queue time is the holder's
// budget, not this turn's) and is CLEARED in the stream's finally. On expiry
// the stream fails the turn through `failTurnOnWallClock` below: the live
// session is interrupted (the provider ends the stream, so every lock the
// stream holds releases through its own finally) and the honest failure row
// persists — the same "turn died, say so on the thread" rule the consumer
// applies to a provider error.

import { startPausableTimeout, type ApprovalWaitGate } from '@vynel/orchestration'
import type { ChatTurnEvent, StructuralLogger } from '@vynel/chat'
import { interruptChatSession, persistTurnFailureRow } from '@vynel/chat'
import type { Database } from '@vynel/db'
import { DEFAULT_PROVIDER_ID, type AiAgentProviderId } from '@vynel/providers'

export const TURN_WALL_CLOCK_ERROR_CODE = 'turn-wall-clock-exceeded'

export interface StartTurnWallClockInput {
  /** The working-time budget (`VYNEL_INTERACTIVE_TURN_MAX_MS` at the composition site). */
  maxMs: number
  /** The gate the stream marks parked/resolved from its own approval events and
   *  its ask waiters — parked time never counts. */
  waitGate: ApprovalWaitGate
  /** Fired ONCE when the budget is spent; never after `clear()`. */
  onExpire: () => void | Promise<void>
  logger: StructuralLogger
}

export interface TurnWallClock {
  /** True from the moment the budget fired. */
  readonly isExpired: boolean
  /** Stop the clock for good — the normal end of a turn. Idempotent. */
  clear: () => void
}

export function startTurnWallClock(input: StartTurnWallClockInput): TurnWallClock {
  let expired = false
  const timeout = startPausableTimeout(input.maxMs, input.waitGate)
  // The pausable promise never rejects; a throwing expiry callback is logged
  // here so it never becomes an unhandled rejection off a timer.
  void timeout.promise
    .then(async () => {
      expired = true
      await input.onExpire()
    })
    .catch((err: unknown) => {
      input.logger.error({ err }, 'turn wall clock expiry callback failed')
    })
  return {
    get isExpired() {
      return expired
    },
    clear: timeout.cancel,
  }
}

/**
 * Marks the wait gate from a turn's approval events — parked on
 * `approval-requested`, released on the matching `approval-resolved`. Only the
 * cards THIS tracker parked release it (the routed handler's rule: an
 * auto-approved card never parks, so its resolution must not release someone
 * else's suspension). One tracker per turn.
 */
export function trackApprovalParks(waitGate: ApprovalWaitGate): {
  onTurnEvent: (event: ChatTurnEvent) => void
} {
  const parkedApprovalIds = new Set<string>()
  return {
    onTurnEvent: (event) => {
      if (event.kind === 'approval-requested') {
        parkedApprovalIds.add(event.approvalRequestId)
        waitGate.markParked()
      } else if (event.kind === 'approval-resolved') {
        if (parkedApprovalIds.delete(event.approvalRequestId)) waitGate.markResolved()
      }
    },
  }
}

export interface FailTurnOnWallClockInput {
  /** The SDK session the turn is running on — undefined when the clock fired
   *  before the runtime resolved one (defensive: the clock starts inside the
   *  lock and provider startup is itself bounded, so a live turn always has
   *  its id here). */
  sessionId: string | undefined
  maxMs: number
  providerId?: AiAgentProviderId
}

export interface TurnWallClockFailure {
  errorCode: string
  errorMessage: string
}

/**
 * What every interactive stream does when its wall clock fires: persist the
 * honest failure row on the turn's session (the status ladder's `problem`
 * fact + what a reload shows), then interrupt the live session so the provider
 * ends the stream and the stream's own finally releases its locks. Returns the
 * frame shape the stream writes to its client. Best-effort throughout — an
 * expiry must never itself throw off a timer.
 */
export async function failTurnOnWallClock(
  deps: { db: Database; logger: StructuralLogger },
  input: FailTurnOnWallClockInput,
): Promise<TurnWallClockFailure> {
  const failure: TurnWallClockFailure = {
    errorCode: TURN_WALL_CLOCK_ERROR_CODE,
    errorMessage: `turn exceeded the ${formatMinutes(input.maxMs)}-minute limit`,
  }
  deps.logger.warn(
    { sessionId: input.sessionId ?? null, maxMs: input.maxMs },
    'interactive turn wall clock exceeded — interrupting the turn',
  )
  if (input.sessionId === undefined) return failure
  try {
    persistTurnFailureRow({
      db: deps.db,
      sessionId: input.sessionId,
      errorCode: failure.errorCode,
      errorMessage: failure.errorMessage,
      erroredAt: new Date(),
    })
  } catch (err) {
    deps.logger.warn({ err, sessionId: input.sessionId }, 'wall-clock failure row not persisted')
  }
  try {
    await interruptChatSession(input.providerId ?? DEFAULT_PROVIDER_ID, input.sessionId)
  } catch (err) {
    deps.logger.warn({ err, sessionId: input.sessionId }, 'wall-clock interrupt failed')
  }
  return failure
}

function formatMinutes(ms: number): string {
  const minutes = ms / 60_000
  return Number.isInteger(minutes) ? String(minutes) : String(Number(minutes.toPrecision(3)))
}

// The lease sweeper's SUSPEND GUARD (audit R2-L). The delegation sweeper reaps
// a claim whose lease lapsed — the run stopped heartbeating, so it is gone. On
// a laptop that SLEPT longer than the lease that reasoning is wrong: timers do
// not fire while the machine is suspended, but the wall clock keeps moving, so
// the first tick after wake sees every live run's heartbeat three minutes stale
// and settles them all — a false "interrupted" for work kinds, a duplicate
// notify turn for message kinds. The CAS on the claim keeps the data correct;
// it cannot make the settle true.
//
// The tell is the sweeper's OWN cadence: a tick that arrives far later than its
// interval means time passed that this process did not run through. That one
// tick skips reaping and re-arms — every genuinely live run heartbeats again
// within seconds of wake, so the next tick reaps exactly what is really dead
// and nothing else. Costs one skipped sweep; an NTP step trips it the same way,
// for the same cheap price.
//
// Wall clock on purpose (`Date.now()`, not a monotonic source): the jump we are
// detecting IS the wall clock moving while the process was frozen.

import type { Logger } from 'pino'

/** How much later than its interval a tick may arrive before the gap reads as
 *  a suspend rather than ordinary timer drift. */
const SUSPEND_JUMP_INTERVALS = 2

export interface SuspendAwareSweepInput {
  /** The sweeper's own cadence (ms) — the interval its timer is armed with. */
  intervalMs: number
  /** The reap this guard fronts. */
  sweep: () => void
  logger: Logger
}

export interface SuspendAwareSweep {
  /** Run one tick: reaps, or skips this one because the machine slept. */
  tick: () => void
}

export function createSuspendAwareSweep(input: SuspendAwareSweepInput): SuspendAwareSweep {
  let lastTickAt = Date.now()
  return {
    tick: () => {
      const now = Date.now()
      const sinceLastTick = now - lastTickAt
      lastTickAt = now
      if (sinceLastTick > input.intervalMs * SUSPEND_JUMP_INTERVALS) {
        input.logger.warn(
          { sinceLastTick, intervalMs: input.intervalMs },
          'delegation lease sweep skipped one tick — the clock jumped (machine suspend or a time step); live runs get a beat to heartbeat before anything is reaped',
        )
        return
      }
      input.sweep()
    },
  }
}

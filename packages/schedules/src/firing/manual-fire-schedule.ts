// Core op — "Run now". Fires a schedule immediately with triggerKind
// 'manual'. Owner-scoped. Does NOT advance `nextScheduledFireAt` (fireSchedule
// never touches it; only the poll claim does — D12), so a manual fire never
// skips the next scheduled run. async.
//
// A manual fire goes through the SAME process-wide `ScheduleFirePool` the poll
// tick uses (background-turns BT3): "Run now" is a fire like any other, so it
// waits for a slot instead of stacking past the bound, and the pool's
// one-fire-per-schedule rule turns a double-click (or a Run-now on a schedule
// the tick just claimed) into an honest 409 rather than a second live turn.
//
// Spec: `docs/blueprints/schedules/blueprint.md §5.3`.

import * as schedulesRepository from '../repositories/index.js'
import { NotFoundError, ConflictError } from '@vynel/errors'
import { fireSchedule } from './fire-schedule.js'
import type { Database } from '@vynel/db'
import type { ScheduleRun } from '../repositories/index.js'
import type { FireScheduleDeps } from '../schedules-types.js'
import type { ScheduleFirePool } from './schedule-fire-pool.js'

export async function manualFireSchedule(
  db: Database,
  input: { scheduleId: string; userId: string },
  deps: FireScheduleDeps,
  /** The caller's process-wide pool. REQUIRED so a surface that forgets to
   *  share it fails typecheck instead of silently firing unbounded. */
  pool: ScheduleFirePool,
): Promise<ScheduleRun> {
  const schedule = schedulesRepository.findScheduleById(db, input.scheduleId)
  // Same response for not-found and not-owned — no enumeration leak.
  if (!schedule || schedule.userId !== input.userId) {
    throw new NotFoundError('schedule', input.scheduleId)
  }
  // A paused schedule cannot be fired (the blueprint's fireSchedule guard
  // rejects disabled rows — Gate-3 C1). Translate that to a typed 409 HERE so
  // the plain-Error guard in fireSchedule stays an unreachable internal
  // backstop (the poll already pre-filters isEnabled). The UI also disables
  // the "Run now" button when paused.
  if (!schedule.isEnabled) {
    throw new ConflictError('This schedule is paused. Resume it before running it manually.')
  }
  // Admitted only AFTER the guards: a missing or paused schedule must answer
  // immediately, never hold a slot for a fire that can't happen. And a person
  // clicking Run now is never parked behind the poll's fires — no free slot
  // answers 409 at once instead of an open-ended wait on the request.
  if (pool.holds(schedule.id)) {
    throw new ConflictError(
      'This schedule is already queued or running. Wait for it to finish, then run it again.',
    )
  }
  if (!pool.hasFreeSlot) {
    throw new ConflictError(
      'Vynel is busy running other schedules right now. Try again in a moment.',
    )
  }
  const queued = pool.admit(schedule.id, () =>
    fireSchedule(
      db,
      { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'manual' },
      deps,
    ),
  )
  // Unreachable after the `holds` guard above — kept as the typed backstop.
  if (queued === null) {
    throw new ConflictError(
      'This schedule is already queued or running. Wait for it to finish, then run it again.',
    )
  }
  return queued
}

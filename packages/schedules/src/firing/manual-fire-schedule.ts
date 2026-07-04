// Core op — "Run now". Fires a schedule immediately with triggerKind
// 'manual'. Owner-scoped. Does NOT advance `nextScheduledFireAt` (fireSchedule
// never touches it; only the poll claim does — D12), so a manual fire never
// skips the next scheduled run. async.
//
// Spec: `docs/blueprints/schedules/blueprint.md §5.3`.

import * as schedulesRepository from '../repositories/index.js'
import { NotFoundError, ConflictError } from '@vynel/errors'
import { fireSchedule } from './fire-schedule.js'
import type { Database } from '@vynel/db'
import type { ScheduleRun } from '../repositories/index.js'
import type { FireScheduleDeps } from '../schedules-types.js'

export async function manualFireSchedule(
  db: Database,
  input: { scheduleId: string; userId: string },
  deps: FireScheduleDeps,
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
  return fireSchedule(
    db,
    { scheduleId: schedule.id, scheduledFireAt: new Date(), triggerKind: 'manual' },
    deps,
  )
}

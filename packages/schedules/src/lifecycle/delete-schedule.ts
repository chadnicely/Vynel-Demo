// Core op — hard-delete a schedule (cascades to schedule_runs). sync,
// owner-scoped. No soft-delete (D11).
//
// Spec: `docs/blueprints/schedules/blueprint.md §5` + coding.md §5.

import * as schedulesRepository from '../repositories/index.js'
import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'

export function deleteSchedule(
  db: Database,
  input: { scheduleId: string; userId: string },
): void {
  const schedule = schedulesRepository.findScheduleById(db, input.scheduleId)
  if (!schedule || schedule.userId !== input.userId) {
    throw new NotFoundError('schedule', input.scheduleId)
  }
  schedulesRepository.hardDeleteSchedule(db, input.scheduleId)
}

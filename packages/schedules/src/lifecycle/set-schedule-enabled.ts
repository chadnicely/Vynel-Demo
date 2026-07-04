// Core op — toggle a schedule's `isEnabled` flag (disabled schedules are
// skipped by the poll). sync, owner-scoped.
//
// Spec: `docs/blueprints/schedules/blueprint.md §5` + coding.md §5.

import * as schedulesRepository from '../repositories/index.js'
import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { Schedule } from '../repositories/index.js'

export function setScheduleEnabled(
  db: Database,
  input: { scheduleId: string; userId: string; isEnabled: boolean },
): Schedule {
  const schedule = schedulesRepository.findScheduleById(db, input.scheduleId)
  // Same response for not-found and not-owned — no enumeration leak.
  if (!schedule || schedule.userId !== input.userId) {
    throw new NotFoundError('schedule', input.scheduleId)
  }
  return schedulesRepository.updateSchedule(db, input.scheduleId, {
    isEnabled: input.isEnabled,
    updatedAt: new Date(),
  })
}

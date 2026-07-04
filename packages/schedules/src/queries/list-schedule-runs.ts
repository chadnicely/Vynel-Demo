// Core op — list a schedule's run history (owner-scoped, keyset-paginated).
// sync. Assembles the keyset cursor from the flat cursorStartedAt/cursorId
// query params and delegates to the repo.
//
// Spec: `docs/blueprints/schedules/blueprint.md §5` + coding.md §5.

import * as schedulesRepository from '../repositories/index.js'
import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { ScheduleRun } from '../repositories/index.js'

export interface ListScheduleRunsInput {
  scheduleId: string
  userId: string
  limit?: number
  cursorStartedAt?: string // ISO-8601
  cursorId?: string
}

export function listScheduleRuns(db: Database, input: ListScheduleRunsInput): ScheduleRun[] {
  const schedule = schedulesRepository.findScheduleById(db, input.scheduleId)
  if (!schedule || schedule.userId !== input.userId) {
    throw new NotFoundError('schedule', input.scheduleId)
  }

  const options: { limit?: number; cursor?: { startedAt: Date; id: string } } = {}
  if (input.limit !== undefined) options.limit = input.limit
  if (input.cursorStartedAt !== undefined && input.cursorId !== undefined) {
    options.cursor = { startedAt: new Date(input.cursorStartedAt), id: input.cursorId }
  }

  return schedulesRepository.listScheduleRunsForSchedule(db, input.scheduleId, options)
}

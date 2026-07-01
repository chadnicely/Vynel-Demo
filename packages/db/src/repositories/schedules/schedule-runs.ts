// Functional repository for the `schedule_runs` table. `db` first; Phase 1
// SYNC returns. Includes the one growth-scaling history list
// (`listScheduleRunsForSchedule`) — keyset-paginated on
// (startedAt DESC, id DESC) so the unbounded list is safe without a purge job
// (D11).
//
// Spec: `docs/blueprints/schedules/blueprint.md §4` + coding.md §6.

import { and, desc, eq, lt, or } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  scheduleRuns,
  type ScheduleRun,
  type NewScheduleRun,
} from '../../schema/schedules/schedule-runs.js'

export type {
  ScheduleRun,
  NewScheduleRun,
  ScheduleRunStatus,
  ScheduleRunTriggerKind,
} from '../../schema/schedules/schedule-runs.js'

const DEFAULT_RUNS_LIMIT = 50
const MAX_RUNS_LIMIT = 100

export function insertScheduleRun(db: Database, row: NewScheduleRun): ScheduleRun {
  const [inserted] = db.insert(scheduleRuns).values(row).returning().all()
  if (!inserted) throw new Error('insertScheduleRun: no row returned')
  return inserted
}

export function updateScheduleRun(
  db: Database,
  id: string,
  patch: Partial<NewScheduleRun>,
): ScheduleRun {
  const [updated] = db.update(scheduleRuns).set(patch).where(eq(scheduleRuns.id, id)).returning().all()
  if (!updated) throw new Error(`updateScheduleRun: no row for ${id}`)
  return updated
}

export function getScheduleRunByIdOrThrow(db: Database, id: string): ScheduleRun {
  const [row] = db.select().from(scheduleRuns).where(eq(scheduleRuns.id, id)).limit(1).all()
  if (!row) throw new Error(`getScheduleRunByIdOrThrow: no row for ${id}`)
  return row
}

// Keyset cursor history (the one growth-scaling list). Cursor on
// (startedAt DESC, id DESC) — uses drizzle operators (NOT raw-sql tuple
// interpolation) so the Date is encoded through the timestamp_ms column type
// (the channels `listInboundMessagesForChannel` precedent; the blueprint
// coding.md §6 raw-sql tuple is superseded by it — a Date can't bind into a
// raw sql template in better-sqlite3).
export function listScheduleRunsForSchedule(
  db: Database,
  scheduleId: string,
  options: { limit?: number; cursor?: { startedAt: Date; id: string } } = {},
): ScheduleRun[] {
  const limit = Math.min(options.limit ?? DEFAULT_RUNS_LIMIT, MAX_RUNS_LIMIT)
  const filters = [eq(scheduleRuns.scheduleId, scheduleId)]
  if (options.cursor) {
    filters.push(
      or(
        lt(scheduleRuns.startedAt, options.cursor.startedAt),
        and(
          eq(scheduleRuns.startedAt, options.cursor.startedAt),
          lt(scheduleRuns.id, options.cursor.id),
        ),
      )!,
    )
  }
  return db
    .select()
    .from(scheduleRuns)
    .where(and(...filters))
    .orderBy(desc(scheduleRuns.startedAt), desc(scheduleRuns.id))
    .limit(limit)
    .all()
}

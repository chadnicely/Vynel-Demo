// Functional repository for the `schedules` table. `db` is the first
// argument (per `docs/foundation.md §2 row 3`); Phase 1 SYNC returns per
// `.claude/memory/decisions/phase-1-sync-transactions.md`. No raw SQL or
// Drizzle queries outside this repo.
//
// Spec: `docs/blueprints/schedules/blueprint.md §4` + coding.md §6.

import { and, asc, eq, lte } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  schedules,
  type Schedule,
  type NewSchedule,
} from '../schema/schedules.js'

// Re-export row + union types so `@vynel/core/schedules` imports them via
// `@vynel/db/repositories/schedules` (the channels/chat repo precedent).
export type {
  Schedule,
  NewSchedule,
  ScheduleTemplateKind,
  ScheduleDestinationKind,
  ScheduleKind,
} from '../schema/schedules.js'

// Bounded list (a user's schedules per workspace in Phase 1) but capped
// defensively per coding-standard.md "Structure / patterns".
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100

// isEnabled AND nextScheduledFireAt <= now — the per-minute poll's input.
export function listDueSchedules(db: Database, input: { now: Date }): Schedule[] {
  return db
    .select()
    .from(schedules)
    .where(and(eq(schedules.isEnabled, true), lte(schedules.nextScheduledFireAt, input.now)))
    .all()
}

export function listSchedulesForWorkspace(
  db: Database,
  input: { userId: string; workspaceId: string; limit?: number },
): Schedule[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  return db
    .select()
    .from(schedules)
    .where(and(eq(schedules.userId, input.userId), eq(schedules.workspaceId, input.workspaceId)))
    .orderBy(asc(schedules.createdAt))
    .limit(limit)
    .all()
}

// All of a user's schedules across every workspace + the global (null-workspace)
// scope — the user-scoped `/schedules` surface. Filters by userId only (the
// tenant boundary); workspace scope is not narrowed.
export function listSchedulesForUser(
  db: Database,
  input: { userId: string; limit?: number },
): Schedule[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  return db
    .select()
    .from(schedules)
    .where(eq(schedules.userId, input.userId))
    .orderBy(asc(schedules.createdAt))
    .limit(limit)
    .all()
}

// Guarded UPDATE: advance nextScheduledFireAt to the next slot ONLY if it
// still equals the value the caller observed. Returns true if THIS caller won
// the claim (better-sqlite3 reports affected-row count on .run(); >0 means we
// won). The equality WHERE makes the claim atomic without an explicit
// transaction — exactly channels' claimPendingInboundMessage shape. This is
// the ONLY writer that advances nextScheduledFireAt (never fireSchedule).
export function claimDueSchedule(
  db: Database,
  input: { id: string; observedNextFireAt: Date; nextFireAt: Date | null },
): boolean {
  const updated = db
    .update(schedules)
    .set({ nextScheduledFireAt: input.nextFireAt, updatedAt: new Date() })
    .where(
      and(eq(schedules.id, input.id), eq(schedules.nextScheduledFireAt, input.observedNextFireAt)),
    )
    .run()
  return updated.changes > 0
}

export function findScheduleById(db: Database, id: string): Schedule | null {
  const [row] = db.select().from(schedules).where(eq(schedules.id, id)).limit(1).all()
  return row ?? null
}

export function insertSchedule(db: Database, row: NewSchedule): Schedule {
  const [inserted] = db.insert(schedules).values(row).returning().all()
  if (!inserted) throw new Error('insertSchedule: no row returned')
  return inserted
}

export function updateSchedule(db: Database, id: string, patch: Partial<NewSchedule>): Schedule {
  const [updated] = db.update(schedules).set(patch).where(eq(schedules.id, id)).returning().all()
  if (!updated) throw new Error(`updateSchedule: no row for ${id}`)
  return updated
}

export function hardDeleteSchedule(db: Database, id: string): void {
  db.delete(schedules).where(eq(schedules.id, id)).run() // cascades to schedule_runs
}

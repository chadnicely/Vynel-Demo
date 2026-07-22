// Functional repository for the `plans` table. `db` is the first argument;
// Phase 1 SYNC returns. No raw SQL or Drizzle queries outside this repo.

import { and, desc, eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { plans, type Plan, type NewPlan, type PlanStatus } from '../schema/plans.js'

// Re-export row + union types so `@vynel/plans` surfaces them via the
// package barrel (the tasks repo precedent).
export type { Plan, NewPlan, PlanStatus, PlanSource } from '../schema/plans.js'

// A plan list is small per scope, but cap defensively.
const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 200

export function listPlansForWorkspace(
  db: Database,
  input: {
    userId: string
    workspaceId: string
    status?: PlanStatus
    planDate?: string
    limit?: number
  },
): Plan[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [eq(plans.userId, input.userId), eq(plans.workspaceId, input.workspaceId)]
  if (input.status) filters.push(eq(plans.status, input.status))
  if (input.planDate) filters.push(eq(plans.planDate, input.planDate))
  return db
    .select()
    .from(plans)
    .where(and(...filters))
    .orderBy(desc(plans.planDate), desc(plans.createdAt))
    .limit(limit)
    .all()
}

// All of a user's plans across every workspace + the global (null-workspace)
// scope — the user-scoped `/plans` surface. Filters by userId only (the
// tenant boundary); workspace scope is not narrowed.
export function listPlansForUser(
  db: Database,
  input: { userId: string; status?: PlanStatus; planDate?: string; limit?: number },
): Plan[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [eq(plans.userId, input.userId)]
  if (input.status) filters.push(eq(plans.status, input.status))
  if (input.planDate) filters.push(eq(plans.planDate, input.planDate))
  return db
    .select()
    .from(plans)
    .where(and(...filters))
    .orderBy(desc(plans.planDate), desc(plans.createdAt))
    .limit(limit)
    .all()
}

export function findPlanById(db: Database, id: string): Plan | null {
  const [row] = db.select().from(plans).where(eq(plans.id, id)).limit(1).all()
  return row ?? null
}

export function insertPlan(db: Database, row: NewPlan): Plan {
  const [inserted] = db.insert(plans).values(row).returning().all()
  if (!inserted) throw new Error('insertPlan: no row returned')
  return inserted
}

export function updatePlan(db: Database, id: string, patch: Partial<NewPlan>): Plan {
  const [updated] = db.update(plans).set(patch).where(eq(plans.id, id)).returning().all()
  if (!updated) throw new Error(`updatePlan: no row for ${id}`)
  return updated
}

export function hardDeletePlan(db: Database, id: string): void {
  db.delete(plans).where(eq(plans.id, id)).run()
}

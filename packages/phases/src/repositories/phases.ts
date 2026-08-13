// Functional repository for the `phases` table. `db` is the first argument;
// Phase 1 SYNC returns. No raw SQL or Drizzle queries outside this repo.

import { and, asc, desc, eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { phases, type Phase, type NewPhase, type PhaseStatus } from '../schema/phases.js'

// Re-export row + union types so `@vynel/phases` surfaces them via the
// package barrel (the plans repo precedent).
export type { Phase, NewPhase, PhaseStatus } from '../schema/phases.js'

// A build plan is a handful of phases, but cap defensively.
const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 200

export function listPhasesForWorkspace(
  db: Database,
  input: { userId: string; workspaceId: string; status?: PhaseStatus; limit?: number },
): Phase[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [eq(phases.userId, input.userId), eq(phases.workspaceId, input.workspaceId)]
  if (input.status) filters.push(eq(phases.status, input.status))
  return db
    .select()
    .from(phases)
    .where(and(...filters))
    .orderBy(asc(phases.orderIndex), asc(phases.createdAt))
    .limit(limit)
    .all()
}

export function findPhaseById(db: Database, id: string): Phase | null {
  const [row] = db.select().from(phases).where(eq(phases.id, id)).limit(1).all()
  return row ?? null
}

// The append position for a new phase — null when the workspace has none yet.
export function findMaxOrderIndexForWorkspace(db: Database, workspaceId: string): number | null {
  const [row] = db
    .select({ orderIndex: phases.orderIndex })
    .from(phases)
    .where(eq(phases.workspaceId, workspaceId))
    .orderBy(desc(phases.orderIndex))
    .limit(1)
    .all()
  return row?.orderIndex ?? null
}

export function insertPhase(db: Database, row: NewPhase): Phase {
  const [inserted] = db.insert(phases).values(row).returning().all()
  if (!inserted) throw new Error('insertPhase: no row returned')
  return inserted
}

export function updatePhase(db: Database, id: string, patch: Partial<NewPhase>): Phase {
  const [updated] = db.update(phases).set(patch).where(eq(phases.id, id)).returning().all()
  if (!updated) throw new Error(`updatePhase: no row for ${id}`)
  return updated
}

export function hardDeletePhase(db: Database, id: string): void {
  db.delete(phases).where(eq(phases.id, id)).run()
}

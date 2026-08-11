// Functional repository for the `features` table. `db` is the first
// argument; Phase 1 SYNC returns. No raw SQL or Drizzle queries outside this
// repo.

import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { features, type Feature, type NewFeature, type FeatureStatus } from '../schema/features.js'

// Re-export row + union types so `@vynel/features` surfaces them via the
// package barrel (the phases repo precedent).
export type { Feature, NewFeature, FeatureStatus } from '../schema/features.js'

// A feature catalog stays modest per workspace, but cap defensively.
const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 200

export function listFeaturesForWorkspace(
  db: Database,
  input: {
    userId: string
    workspaceId: string
    status?: FeatureStatus
    phaseId?: string
    limit?: number
  },
): Feature[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [eq(features.userId, input.userId), eq(features.workspaceId, input.workspaceId)]
  if (input.status) filters.push(eq(features.status, input.status))
  if (input.phaseId) filters.push(eq(features.phaseId, input.phaseId))
  return db
    .select()
    .from(features)
    .where(and(...filters))
    .orderBy(asc(features.createdAt))
    .limit(limit)
    .all()
}

export function findFeatureById(db: Database, id: string): Feature | null {
  const [row] = db.select().from(features).where(eq(features.id, id)).limit(1).all()
  return row ?? null
}

export function insertFeature(db: Database, row: NewFeature): Feature {
  const [inserted] = db.insert(features).values(row).returning().all()
  if (!inserted) throw new Error('insertFeature: no row returned')
  return inserted
}

export function updateFeature(db: Database, id: string, patch: Partial<NewFeature>): Feature {
  const [updated] = db.update(features).set(patch).where(eq(features.id, id)).returning().all()
  if (!updated) throw new Error(`updateFeature: no row for ${id}`)
  return updated
}

export function hardDeleteFeature(db: Database, id: string): void {
  db.delete(features).where(eq(features.id, id)).run()
}

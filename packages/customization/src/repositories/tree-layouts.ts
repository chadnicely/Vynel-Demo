// Functional repository for `tree_layouts`. `db` first; Phase 1 SYNC returns.

import { eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { treeLayouts, type TreeLayoutRow, type NewTreeLayoutRow } from '../schema/tree-layouts.js'

export type { TreeLayoutRow, NewTreeLayoutRow } from '../schema/tree-layouts.js'

export function findTreeLayoutForUser(db: Database, userId: string): TreeLayoutRow | null {
  const [row] = db.select().from(treeLayouts).where(eq(treeLayouts.userId, userId)).limit(1).all()
  return row ?? null
}

/** Insert or replace the user's row — the whole layout, every drop. */
export function upsertTreeLayout(db: Database, row: NewTreeLayoutRow): TreeLayoutRow {
  const { id: _id, createdAt: _createdAt, ...replaced } = row
  const [saved] = db
    .insert(treeLayouts)
    .values(row)
    .onConflictDoUpdate({ target: treeLayouts.userId, set: replaced })
    .returning()
    .all()
  if (!saved) throw new Error('upsertTreeLayout: no row returned')
  return saved
}

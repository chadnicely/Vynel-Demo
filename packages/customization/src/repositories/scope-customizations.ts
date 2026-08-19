// Functional repository for `scope_customizations`. `db` first; Phase 1 SYNC
// returns. No raw SQL or Drizzle queries outside this repo.

import { and, eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  scopeCustomizations,
  type ScopeCustomization,
  type NewScopeCustomization,
} from '../schema/scope-customizations.js'

export type { ScopeCustomization, NewScopeCustomization } from '../schema/scope-customizations.js'

export function listScopeCustomizationsForUser(db: Database, userId: string): ScopeCustomization[] {
  return db.select().from(scopeCustomizations).where(eq(scopeCustomizations.userId, userId)).all()
}

export function findScopeCustomization(
  db: Database,
  userId: string,
  scopeKey: string,
): ScopeCustomization | null {
  const [row] = db
    .select()
    .from(scopeCustomizations)
    .where(and(eq(scopeCustomizations.userId, userId), eq(scopeCustomizations.scopeKey, scopeKey)))
    .limit(1)
    .all()
  return row ?? null
}

/** Insert or replace the (user, scope) row — the whole customization, every time. */
export function upsertScopeCustomization(
  db: Database,
  row: NewScopeCustomization,
): ScopeCustomization {
  const { id: _id, createdAt: _createdAt, ...replaced } = row
  const [saved] = db
    .insert(scopeCustomizations)
    .values(row)
    .onConflictDoUpdate({
      target: [scopeCustomizations.userId, scopeCustomizations.scopeKey],
      set: replaced,
    })
    .returning()
    .all()
  if (!saved) throw new Error('upsertScopeCustomization: no row returned')
  return saved
}

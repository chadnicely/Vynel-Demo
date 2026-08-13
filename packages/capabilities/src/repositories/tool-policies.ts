// Functional repository for the `tool_policies` table. `db` is the first
// argument; Phase 1 SYNC returns. No raw SQL or Drizzle queries outside this
// repo.

import { and, eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { toolPolicies, type NewToolPolicyRow, type ToolPolicyRow } from '../schema/tool-policies.js'

export type { NewToolPolicyRow, ToolPolicyRow, ToolCardClass } from '../schema/tool-policies.js'

export function insertToolPolicy(db: Database, row: NewToolPolicyRow): ToolPolicyRow {
  const [inserted] = db.insert(toolPolicies).values(row).returning().all()
  if (!inserted) throw new Error('insertToolPolicy: no row returned')
  return inserted
}

export function findToolPolicy(
  db: Database,
  scope: { userId: string; toolName: string },
): ToolPolicyRow | null {
  const [row] = db
    .select()
    .from(toolPolicies)
    .where(and(eq(toolPolicies.userId, scope.userId), eq(toolPolicies.toolName, scope.toolName)))
    .limit(1)
    .all()
  return row ?? null
}

export function listToolPolicies(db: Database, userId: string): ToolPolicyRow[] {
  return db.select().from(toolPolicies).where(eq(toolPolicies.userId, userId)).all()
}

/** Full-override replace on the existing row (the PUT semantics — the row IS
 *  the override set, so a save writes every policy column). Tenant-filtered. */
export function updateToolPolicy(
  db: Database,
  id: string,
  userId: string,
  patch: Pick<
    ToolPolicyRow,
    'enabled' | 'cardClass' | 'surfacesJson' | 'featureKey' | 'capabilityId'
  > & { updatedAt: Date },
): ToolPolicyRow | null {
  const [updated] = db
    .update(toolPolicies)
    .set(patch)
    .where(and(eq(toolPolicies.id, id), eq(toolPolicies.userId, userId)))
    .returning()
    .all()
  return updated ?? null
}

/** Reset-to-default: the row's absence IS the default. */
export function deleteToolPolicy(
  db: Database,
  scope: { userId: string; toolName: string },
): boolean {
  const deleted = db
    .delete(toolPolicies)
    .where(and(eq(toolPolicies.userId, scope.userId), eq(toolPolicies.toolName, scope.toolName)))
    .returning()
    .all()
  return deleted.length > 0
}

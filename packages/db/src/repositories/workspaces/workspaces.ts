// Functional repository for the `workspaces` table. `db` is the first
// argument (per `docs/foundation.md §2 row 3` + `.claude/rules/
// coding-standard.md`). Spec: `docs/blueprints/workspaces/blueprint.md §5`.
//
// Phase 1 SYNC return values — required by the better-sqlite3 transaction
// contract per `.claude/memory/decisions/phase-1-sync-transactions.md`.
// Phase 2 Postgres flips signatures to async; call sites already use
// `await` which is harmless on sync return values.

import { and, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  workspaces,
  type Workspace,
  type NewWorkspace,
  type WorkspaceKind,
} from '../../schema/workspaces/workspaces.js'

export type {
  Workspace,
  NewWorkspace,
  WorkspaceKind,
  WorkspaceStatusKind,
} from '../../schema/workspaces/workspaces.js'

// Defensive cap on listWorkspacesForUser per coding-standard.md
// "Structure / patterns" — every list* whose result set scales with
// tenant data is capped at the repo layer too (Zod schema clamps the
// HTTP boundary independently).
const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 500

export function findWorkspaceById(db: Database, workspaceId: string): Workspace | null {
  const [row] = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1).all()
  return row ?? null
}

export function findWorkspaceByPath(db: Database, path: string): Workspace | null {
  const [row] = db.select().from(workspaces).where(eq(workspaces.path, path)).limit(1).all()
  return row ?? null
}

// Case-insensitive path match for a single user (D3 — catches Windows /
// case-insensitive-APFS duplicates a plain `eq()` would miss). The caller passes
// a realpath-canonical path; existing-directory-model rows store canonical paths
// too, so a `lower()` compare catches the same folder entered with different
// casing. Spans archived rows (they still own their folder). A full scan over
// the user's intrinsically-bounded workspaces — no functional index, consistent
// with D3's "no DB constraint on path".
export function findWorkspaceByNormalizedPath(
  db: Database,
  userId: string,
  canonicalPath: string,
): Workspace | null {
  const [row] = db
    .select()
    .from(workspaces)
    .where(
      and(eq(workspaces.userId, userId), sql`lower(${workspaces.path}) = lower(${canonicalPath})`),
    )
    .limit(1)
    .all()
  return row ?? null
}

export function listWorkspacesForUser(
  db: Database,
  userId: string,
  options: { includeArchived?: boolean; limit?: number } = {},
): Workspace[] {
  const whereClause = options.includeArchived
    ? eq(workspaces.userId, userId)
    : and(eq(workspaces.userId, userId), eq(workspaces.isArchived, false))

  const cap = Math.min(options.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)

  return db
    .select()
    .from(workspaces)
    .where(whereClause)
    .orderBy(desc(workspaces.lastAccessedAt))
    .limit(cap)
    .all()
}

export function insertWorkspace(db: Database, newWorkspace: NewWorkspace): Workspace {
  const [inserted] = db.insert(workspaces).values(newWorkspace).returning().all()
  if (!inserted) {
    throw new Error('insertWorkspace: no row returned')
  }
  return inserted
}

export function updateWorkspace(
  db: Database,
  workspaceId: string,
  patch: Partial<
    Omit<
      Workspace,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'path' | 'kind' | 'lastAccessedAt'
    >
  >,
): Workspace | null {
  const [updated] = db
    .update(workspaces)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .returning()
    .all()
  return updated ?? null
}

export function touchWorkspaceLastAccessedAt(db: Database, workspaceId: string): void {
  db.update(workspaces)
    .set({ lastAccessedAt: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .run()
}

export function hardDeleteWorkspace(db: Database, workspaceId: string): boolean {
  const result = db.delete(workspaces).where(eq(workspaces.id, workspaceId)).run()
  return (result.changes ?? 0) > 0
}

// Bulk-detach for group deletion (workspace redesign Arc 2b): `groupId` is a
// LOOSE ref with no DB FK, so the delete op clears members explicitly inside
// its transaction. Returns how many workspaces moved back to the tree root.
export function detachWorkspacesFromGroup(db: Database, groupId: string): number {
  const result = db
    .update(workspaces)
    .set({ groupId: null, updatedAt: new Date() })
    .where(eq(workspaces.groupId, groupId))
    .run()
  return result.changes ?? 0
}

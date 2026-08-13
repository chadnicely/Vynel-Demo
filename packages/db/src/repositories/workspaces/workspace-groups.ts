// Functional repository for the `workspace_groups` table (menu-tree folders,
// workspace redesign Arc 2b). `db` is the first argument per
// `.claude/rules/coding-standard.md`. Membership is the LOOSE
// `workspaces.groupId` ref — the detach helper lives in `workspaces.ts`
// beside the column it updates.
//
// Phase 1 SYNC return values — required by the better-sqlite3 transaction
// contract per `.claude/memory/decisions/phase-1-sync-transactions.md`.

import { asc, eq } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  workspaceGroups,
  type WorkspaceGroup,
  type NewWorkspaceGroup,
} from '../../schema/workspaces/workspace-groups.js'

export type { WorkspaceGroup, NewWorkspaceGroup } from '../../schema/workspaces/workspace-groups.js'

// Defensive cap per coding-standard.md "Structure / patterns" — folders are
// few in practice, but every tenant-scaling list* is capped at the repo layer.
const MAX_GROUP_LIST_LIMIT = 200

export function insertWorkspaceGroup(db: Database, group: NewWorkspaceGroup): WorkspaceGroup {
  const [inserted] = db.insert(workspaceGroups).values(group).returning().all()
  if (!inserted) {
    throw new Error('insertWorkspaceGroup: no row returned')
  }
  return inserted
}

export function findWorkspaceGroupById(db: Database, groupId: string): WorkspaceGroup | null {
  const [row] = db
    .select()
    .from(workspaceGroups)
    .where(eq(workspaceGroups.id, groupId))
    .limit(1)
    .all()
  return row ?? null
}

// Creation order — the tree lists folders the way the user made them.
export function listWorkspaceGroupsForUser(db: Database, userId: string): WorkspaceGroup[] {
  return db
    .select()
    .from(workspaceGroups)
    .where(eq(workspaceGroups.userId, userId))
    .orderBy(asc(workspaceGroups.createdAt), asc(workspaceGroups.id))
    .limit(MAX_GROUP_LIST_LIMIT)
    .all()
}

export function updateWorkspaceGroup(
  db: Database,
  groupId: string,
  patch: Partial<Omit<WorkspaceGroup, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>,
): WorkspaceGroup | null {
  const [updated] = db
    .update(workspaceGroups)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(workspaceGroups.id, groupId))
    .returning()
    .all()
  return updated ?? null
}

export function deleteWorkspaceGroup(db: Database, groupId: string): boolean {
  const deleted = db
    .delete(workspaceGroups)
    .where(eq(workspaceGroups.id, groupId))
    .returning({ id: workspaceGroups.id })
    .all()
  return deleted.length > 0
}

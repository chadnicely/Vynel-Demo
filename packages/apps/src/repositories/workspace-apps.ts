// Functional repository for the `workspace_apps` table. `db` first arg;
// Phase 1 SYNC returns. No raw SQL or Drizzle queries outside this repo.

import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { workspaceApps, type WorkspaceApp, type NewWorkspaceApp } from '../schema/workspace-apps.js'

export type { WorkspaceApp, NewWorkspaceApp } from '../schema/workspace-apps.js'

// A workspace's app list is small (a monorepo has a handful); cap defensively.
const LIST_LIMIT = 50

export function listAppsForWorkspace(
  db: Database,
  input: { userId: string; workspaceId: string },
): WorkspaceApp[] {
  return db
    .select()
    .from(workspaceApps)
    .where(
      and(eq(workspaceApps.userId, input.userId), eq(workspaceApps.workspaceId, input.workspaceId)),
    )
    .orderBy(asc(workspaceApps.createdAt))
    .limit(LIST_LIMIT)
    .all()
}

// The unique-name-per-workspace guard's read (case-insensitive).
export function findAppByName(
  db: Database,
  input: { workspaceId: string; name: string },
): WorkspaceApp | null {
  const [row] = db
    .select()
    .from(workspaceApps)
    .where(
      and(
        eq(workspaceApps.workspaceId, input.workspaceId),
        sql`lower(${workspaceApps.name}) = lower(${input.name})`,
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

export function findAppById(db: Database, id: string): WorkspaceApp | null {
  const [row] = db.select().from(workspaceApps).where(eq(workspaceApps.id, id)).limit(1).all()
  return row ?? null
}

export function insertApp(db: Database, row: NewWorkspaceApp): WorkspaceApp {
  const [inserted] = db.insert(workspaceApps).values(row).returning().all()
  if (!inserted) throw new Error('insertApp: no row returned')
  return inserted
}

export function updateApp(
  db: Database,
  id: string,
  patch: Partial<NewWorkspaceApp>,
): WorkspaceApp {
  const [updated] = db
    .update(workspaceApps)
    .set(patch)
    .where(eq(workspaceApps.id, id))
    .returning()
    .all()
  if (!updated) throw new Error(`updateApp: no row for ${id}`)
  return updated
}

export function hardDeleteApp(db: Database, id: string): void {
  db.delete(workspaceApps).where(eq(workspaceApps.id, id)).run()
}

// Functional repository for the `workspace_briefs` table — `db` first, sync
// (Phase 1 better-sqlite3), one row per workspace. `answers` / `plan` ride
// through as opaque JSON; the `workspaces` leaf types them at its boundary.

import { eq } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  workspaceBriefs,
  type WorkspaceBriefRow,
  type NewWorkspaceBriefRow,
} from '../../schema/workspaces/workspace-briefs.js'

export type { WorkspaceBriefRow, NewWorkspaceBriefRow } from '../../schema/workspaces/workspace-briefs.js'

export function insertWorkspaceBrief(db: Database, row: NewWorkspaceBriefRow): WorkspaceBriefRow {
  const [inserted] = db.insert(workspaceBriefs).values(row).returning().all()
  if (!inserted) {
    throw new Error('insertWorkspaceBrief: no row returned')
  }
  return inserted
}

export function findWorkspaceBriefByWorkspaceId(
  db: Database,
  workspaceId: string,
): WorkspaceBriefRow | null {
  const [row] = db
    .select()
    .from(workspaceBriefs)
    .where(eq(workspaceBriefs.workspaceId, workspaceId))
    .limit(1)
    .all()
  return row ?? null
}

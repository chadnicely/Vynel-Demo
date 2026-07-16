// Read op — a workspace's registered apps (the route merges live supervisor
// status on top; the leaf stays runtime-free here).

import * as appsRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { WorkspaceApp } from '../repositories/index.js'

export function listApps(
  db: Database,
  input: { userId: string; workspaceId: string },
): WorkspaceApp[] {
  return appsRepository.listAppsForWorkspace(db, input)
}

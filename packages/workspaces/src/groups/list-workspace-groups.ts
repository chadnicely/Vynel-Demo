// List the user's menu-tree folders, creation order (the tree shows them
// the way the user made them).

import * as workspaceGroupsRepository from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { WorkspaceGroup } from '@vynel/db/repositories/workspaces'

export async function listWorkspaceGroups(
  db: Database,
  userId: string,
): Promise<WorkspaceGroup[]> {
  return workspaceGroupsRepository.listWorkspaceGroupsForUser(db, userId)
}

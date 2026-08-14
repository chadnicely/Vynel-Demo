// Owner-scoped group lookup — the one home for the "exists AND is yours"
// check every group op needs. NotFoundError on missing OR foreign rows
// alike (no enumeration leak — the get_workspace 404 semantics).

import * as workspaceGroupsRepository from '@vynel/db/repositories/workspaces'
import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { WorkspaceGroup } from '@vynel/db/repositories/workspaces'

export function getWorkspaceGroupForUserOrThrow(
  db: Database,
  userId: string,
  groupId: string,
): WorkspaceGroup {
  const group = workspaceGroupsRepository.findWorkspaceGroupById(db, groupId)
  if (!group || group.userId !== userId) {
    throw new NotFoundError('workspace-group', groupId)
  }
  return group
}

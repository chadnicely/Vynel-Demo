// Rename a menu-tree folder. Event-less metadata update (the
// updateWorkspaceMetadata precedent); owner-scoped via the shared lookup.

import * as workspaceGroupsRepository from '@vynel/db/repositories/workspaces'
import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { WorkspaceGroup } from '@vynel/db/repositories/workspaces'
import { getWorkspaceGroupForUserOrThrow } from './get-workspace-group-for-user.js'
import { normalizeWorkspaceGroupName } from './workspace-group-name.js'

export type RenameWorkspaceGroupInput = {
  userId: string
  groupId: string
  name: string
}

export async function renameWorkspaceGroup(
  db: Database,
  input: RenameWorkspaceGroupInput,
): Promise<WorkspaceGroup> {
  const name = normalizeWorkspaceGroupName(input.name)
  getWorkspaceGroupForUserOrThrow(db, input.userId, input.groupId)
  const renamed = workspaceGroupsRepository.updateWorkspaceGroup(db, input.groupId, { name })
  if (!renamed) {
    throw new NotFoundError('workspace-group', input.groupId)
  }
  return renamed
}

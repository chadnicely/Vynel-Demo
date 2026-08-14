// Delete a menu-tree folder. One transaction: owner-check, detach every
// member workspace back to the tree root (the loose `workspaces.groupId`
// ref has no DB FK — THIS is where membership consistency is enforced),
// delete the row, publish workspace-group.deleted. Workspaces themselves
// are never touched beyond the detach — deleting a folder is always safe.

import * as workspacesRepository from '@vynel/db/repositories/workspaces'
import * as outboxRepository from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import { WORKSPACE_GROUP_DELETED_EVENT } from '../workspaces-events.js'
import { getWorkspaceGroupForUserOrThrow } from './get-workspace-group-for-user.js'

export type DeleteWorkspaceGroupInput = {
  userId: string
  groupId: string
}

export async function deleteWorkspaceGroup(
  db: Database,
  input: DeleteWorkspaceGroupInput,
): Promise<void> {
  const now = new Date()

  withTransaction(db, (tx) => {
    const group = getWorkspaceGroupForUserOrThrow(tx, input.userId, input.groupId)

    const detachedWorkspaceCount = workspacesRepository.detachWorkspacesFromGroup(tx, group.id)
    const deleted = workspacesRepository.deleteWorkspaceGroup(tx, group.id)
    if (!deleted) {
      throw new NotFoundError('workspace-group', group.id)
    }

    outboxRepository.insertOutboxEvent(tx, {
      id: crypto.randomUUID(),
      type: WORKSPACE_GROUP_DELETED_EVENT,
      payload: {
        groupId: group.id,
        userId: group.userId,
        name: group.name,
        detachedWorkspaceCount,
        deletedAt: now.toISOString(),
      },
      createdAt: now,
    })
  })
}

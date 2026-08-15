// Create a menu-tree folder (workspace redesign Arc 2b). One transaction:
// insert the row, publish workspace-group.created — the created/deleted
// event pair mirrors the workspace vocabulary (D14 selectivity: rename and
// membership moves are event-less metadata).

import * as workspaceGroupsRepository from '@vynel/db/repositories/workspaces'
import * as outboxRepository from '@vynel/db/repositories/_shared'
import { withTransaction, type Database } from '@vynel/db'
import type { WorkspaceGroup } from '@vynel/db/repositories/workspaces'
import { WORKSPACE_GROUP_CREATED_EVENT } from '../workspaces-events.js'
import { normalizeWorkspaceGroupName } from './workspace-group-name.js'

export type CreateWorkspaceGroupInput = {
  userId: string
  name: string
}

export async function createWorkspaceGroup(
  db: Database,
  input: CreateWorkspaceGroupInput,
): Promise<WorkspaceGroup> {
  const name = normalizeWorkspaceGroupName(input.name)
  const now = new Date()

  return withTransaction(db, (tx) => {
    const group = workspaceGroupsRepository.insertWorkspaceGroup(tx, {
      id: crypto.randomUUID(),
      userId: input.userId,
      name,
      createdAt: now,
      updatedAt: now,
    })

    outboxRepository.insertOutboxEvent(tx, {
      id: crypto.randomUUID(),
      type: WORKSPACE_GROUP_CREATED_EVENT,
      payload: {
        groupId: group.id,
        userId: group.userId,
        name: group.name,
        createdAt: group.createdAt.toISOString(),
      },
      createdAt: now,
    })

    return group
  })
}

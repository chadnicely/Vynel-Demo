// Archive / unarchive a workspace. Archive sets isArchived=true AND
// publishes a workspace.archived outbox event atomically (same tx).
// Unarchive sets isArchived=false; deliberately publishes NO event
// per D14 (no Phase 1 consumer needs a "back-in-the-list" signal).
// Per blueprint §6.5.
//
// Phase 1 sync transaction callback per
// .claude/memory/decisions/phase-1-sync-transactions.md.

import * as workspacesRepository from '@vynel/db/repositories/workspaces'
import * as outboxRepository from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import type { Workspace } from '@vynel/db/repositories/workspaces'
import { WORKSPACE_ARCHIVED_EVENT } from '../workspaces-events.js'

export async function archiveWorkspace(db: Database, workspaceId: string): Promise<Workspace> {
  return withTransaction(db, (tx) => {
    const updated = workspacesRepository.updateWorkspace(tx, workspaceId, {
      isArchived: true,
    })
    if (!updated) {
      throw new NotFoundError('workspace', workspaceId)
    }
    outboxRepository.insertOutboxEvent(tx, {
      id: crypto.randomUUID(),
      type: WORKSPACE_ARCHIVED_EVENT,
      payload: {
        workspaceId: updated.id,
        userId: updated.userId,
        archivedAt: updated.updatedAt.toISOString(),
      },
      createdAt: new Date(),
    })
    return updated
  })
}

export async function unarchiveWorkspace(db: Database, workspaceId: string): Promise<Workspace> {
  const updated = workspacesRepository.updateWorkspace(db, workspaceId, {
    isArchived: false,
  })
  if (!updated) {
    throw new NotFoundError('workspace', workspaceId)
  }
  return updated
}

// Hard-delete a workspace. Atomic: removes the DB row + publishes the
// workspace.deleted outbox event in the same transaction. The on-disk
// folder removal (if requested via deleteFilesFromDisk) happens AFTER
// commit — a failed rm produces an orphan folder (logged warning), not
// an orphan row. Per blueprint §6.6 + decisions.md D10.
//
// Phase 1 sync transaction callback per
// .claude/memory/decisions/phase-1-sync-transactions.md.

import { rm } from 'node:fs/promises'
import * as workspacesRepository from '@vynel/db/repositories/workspaces'
import * as outboxRepository from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/core/errors'
import { withTransaction, type Database } from '@vynel/db'
import { WORKSPACE_DELETED_EVENT } from './workspaces-events.js'

export type HardDeleteWorkspaceInput = {
  workspaceId: string
  deleteFilesFromDisk: boolean
}

// Structural logger shape — avoids the @vynel/logger dep at the core
// layer (matches the users domain precedent in get-or-create-local-user).
// Apps wire pino via the Hono context; tests pass an object or omit.
export type HardDeleteWorkspaceDependencies = {
  readonly logger?: {
    info: (obj: object, msg: string) => void
    warn: (obj: object, msg: string) => void
  }
}

export async function hardDeleteWorkspace(
  db: Database,
  input: HardDeleteWorkspaceInput,
  deps: HardDeleteWorkspaceDependencies = {},
): Promise<void> {
  const workspace = workspacesRepository.findWorkspaceById(db, input.workspaceId)
  if (!workspace) {
    throw new NotFoundError('workspace', input.workspaceId)
  }

  withTransaction(db, (tx) => {
    const removed = workspacesRepository.hardDeleteWorkspace(tx, input.workspaceId)
    if (!removed) {
      throw new NotFoundError('workspace', input.workspaceId)
    }
    outboxRepository.insertOutboxEvent(tx, {
      id: crypto.randomUUID(),
      type: WORKSPACE_DELETED_EVENT,
      payload: {
        workspaceId: workspace.id,
        userId: workspace.userId,
        path: workspace.path,
        deleteFilesFromDisk: input.deleteFilesFromDisk,
        deletedAt: new Date().toISOString(),
      },
      createdAt: new Date(),
    })
  })

  if (input.deleteFilesFromDisk) {
    try {
      await rm(workspace.path, { recursive: true, force: true })
      deps.logger?.info(
        { workspaceId: input.workspaceId, path: workspace.path },
        'workspace files deleted',
      )
    } catch (err) {
      deps.logger?.warn(
        { workspaceId: input.workspaceId, path: workspace.path, err },
        'workspace row deleted but files could not be removed (orphaned)',
      )
    }
  } else {
    deps.logger?.info(
      { workspaceId: input.workspaceId, path: workspace.path },
      'workspace row deleted; files preserved on disk',
    )
  }
}

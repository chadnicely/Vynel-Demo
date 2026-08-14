// Set the assistant's workspace status (redesign Arc 5b, "one status one
// colour"): completed / problem / needs_input, with an optional one-line note.
// The row is a FACT ("the assistant set X at T"), never cleared by a write —
// any turn that starts after `statusSetAt` supersedes it at read time, which
// is exactly the product semantics ("completed shows until the next message").
// Owner-scoped: a foreign workspace 404s like a missing one.
//
// Phase 1 sync transaction callback per
// .claude/memory/decisions/phase-1-sync-transactions.md.

import * as workspacesRepository from '@vynel/db/repositories/workspaces'
import * as outboxRepository from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import type { Workspace, WorkspaceStatusKind } from '@vynel/db/repositories/workspaces'
import { WORKSPACE_STATUS_SET_EVENT } from '../workspaces-events.js'

export type SetWorkspaceStatusInput = {
  userId: string
  workspaceId: string
  status: WorkspaceStatusKind
  /** The assistant's one-line why — surfaced on the rail card + chat header. */
  note?: string | null
}

export async function setWorkspaceStatus(
  db: Database,
  input: SetWorkspaceStatusInput,
): Promise<Workspace> {
  return withTransaction(db, (tx) => {
    const existing = workspacesRepository.findWorkspaceById(tx, input.workspaceId)
    if (!existing || existing.userId !== input.userId) {
      throw new NotFoundError('workspace', input.workspaceId)
    }
    const setAt = new Date()
    const updated = workspacesRepository.updateWorkspace(tx, input.workspaceId, {
      status: input.status,
      statusNote: input.note ?? null,
      statusSetAt: setAt,
    })
    if (!updated) {
      throw new NotFoundError('workspace', input.workspaceId)
    }
    outboxRepository.insertOutboxEvent(tx, {
      id: crypto.randomUUID(),
      type: WORKSPACE_STATUS_SET_EVENT,
      payload: {
        workspaceId: updated.id,
        userId: updated.userId,
        status: input.status,
        note: input.note ?? null,
        setAt: setAt.toISOString(),
      },
      createdAt: new Date(),
    })
    return updated
  })
}

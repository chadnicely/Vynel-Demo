// Stamp a project as SET UP — the "Finish setting up" dialog's Done (Chad,
// 2026-08-25). Until this runs, `setupCompletedAt` is null and the project
// lists under NEEDS SETUP; after it, the project leaves that section and
// becomes an ordinary Not-running project until something actually runs in it.
//
// One-way and idempotent: the human answered the questions once, so re-clicking
// Done never moves the date, and nothing un-stamps it. Removing a project and
// pulling it back in starts a fresh row, which is the honest way back to NEEDS
// SETUP.
//
// The client supplies no time — the stamp is ours, so a wrong clock on the
// machine cannot backdate it.

import * as workspacesRepository from '@vynel/db/repositories/workspaces'
import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { Workspace } from '@vynel/db/repositories/workspaces'

export function markWorkspaceSetupComplete(db: Database, workspaceId: string): Workspace {
  const existing = workspacesRepository.findWorkspaceById(db, workspaceId)
  if (!existing) throw new NotFoundError('workspace', workspaceId)
  if (existing.setupCompletedAt !== null) return existing

  const updated = workspacesRepository.updateWorkspace(db, workspaceId, {
    setupCompletedAt: new Date(),
  })
  if (!updated) throw new NotFoundError('workspace', workspaceId)
  return updated
}

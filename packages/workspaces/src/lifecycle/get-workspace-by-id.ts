// Get a workspace by id with ownership check. Used by the workspace-
// resolver middleware and by any core op that needs to confirm a
// workspace before acting on it. Returns the same NotFoundError for
// both not-found and not-owned — no enumeration leak (D17 + D18).
// Per blueprint §6.3.

import * as workspacesRepository from '@vynel/db/repositories/workspaces'
import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { Workspace } from '@vynel/db/repositories/workspaces'

export async function getWorkspaceById(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<Workspace> {
  const workspace = workspacesRepository.findWorkspaceById(db, workspaceId)
  if (!workspace || workspace.userId !== userId) {
    // Same response for not-found and not-owned to avoid enumeration leak.
    throw new NotFoundError('workspace', workspaceId)
  }
  return workspace
}

// Move a workspace into a folder (or back to the tree root with null).
// Event-less metadata update (the updateWorkspaceMetadata precedent). The
// route layer owner-checks the WORKSPACE (workspaceScoped); this op
// owner-checks the target GROUP — a foreign group id 404s exactly like a
// missing one (no enumeration leak).

import * as workspacesRepository from '@vynel/db/repositories/workspaces'
import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { Workspace } from '@vynel/db/repositories/workspaces'
import { getWorkspaceGroupForUserOrThrow } from './get-workspace-group-for-user.js'

export type SetWorkspaceGroupInput = {
  userId: string
  workspaceId: string
  /** The target folder, or null for the tree root. */
  groupId: string | null
}

export async function setWorkspaceGroup(
  db: Database,
  input: SetWorkspaceGroupInput,
): Promise<Workspace> {
  if (input.groupId !== null) {
    getWorkspaceGroupForUserOrThrow(db, input.userId, input.groupId)
  }
  const updated = workspacesRepository.updateWorkspace(db, input.workspaceId, {
    groupId: input.groupId,
  })
  if (!updated) {
    throw new NotFoundError('workspace', input.workspaceId)
  }
  return updated
}

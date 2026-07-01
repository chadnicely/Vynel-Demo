// Update a workspace's metadata. `name`, `managerName` (the Ch5 manager persona),
// and `continueEnabled` (the Slice-2 continue-mode toggle) are mutable; `path` and
// `kind` are immutable after creation per D4 (the repo patch type excludes them too —
// defense in depth). Throws NotFoundError on missing. Per blueprint §6.4.

import * as workspacesRepository from '@vynel/db/repositories/workspaces'
import { NotFoundError } from '@vynel/core/errors'
import type { Database } from '@vynel/db'
import type { Workspace } from '@vynel/db/repositories/workspaces'

export type UpdateWorkspaceMetadataInput = {
  name?: string
  /** The workspace manager's persona name (brain-tree Ch5) — renames "Mark". */
  managerName?: string
  /** Continue-mode toggle (Slice 2). True = the landing conversation follows the
   *  root + swaps invisibly; false = classic per-topic sessions. */
  continueEnabled?: boolean
}

export async function updateWorkspaceMetadata(
  db: Database,
  workspaceId: string,
  input: UpdateWorkspaceMetadataInput,
): Promise<Workspace> {
  const updated = workspacesRepository.updateWorkspace(db, workspaceId, input)
  if (!updated) {
    throw new NotFoundError('workspace', workspaceId)
  }
  return updated
}

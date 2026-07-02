// Published read surface — find a workspace by id (null when absent). The
// null-safe sibling of `getWorkspaceById` (which throws). Lets ANOTHER domain
// read a workspace through the workspaces core (not its repo) per the
// data-standard cross-domain rule — used by the schedules prompt renderer, which
// tolerates a missing row.

import type { Database } from '@vynel/db'
import { findWorkspaceById as findWorkspaceByIdRepo } from '@vynel/db/repositories/workspaces'

export function findWorkspaceById(db: Database, workspaceId: string) {
  return findWorkspaceByIdRepo(db, workspaceId)
}

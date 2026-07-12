// Published read surface — the raw installed-skill rows for a (user, workspace).
// Lets ANOTHER domain read installed skills through the skills core (not its
// repo) per the data-standard cross-domain rule. The marketplace's
// install-status annotation needs the RAW rows (`listInstalledSkillsForContext`
// returns the enriched definition+settings shape, which is more than it needs).

import type { Database } from '@vynel/db'
import { listInstalledSkillsForUserAndWorkspace as listInstalledSkillsForUserAndWorkspaceRepo } from '../repositories/index.js'

export type ListInstalledSkillsForUserAndWorkspaceInput = {
  userId: string
  // null = user-scope rows only — the GLOBAL marketplace surface
  // annotates against user-scoped installs, never a workspace's.
  workspaceId: string | null
}

export function listInstalledSkillsForUserAndWorkspace(
  db: Database,
  input: ListInstalledSkillsForUserAndWorkspaceInput,
) {
  return listInstalledSkillsForUserAndWorkspaceRepo(db, input)
}

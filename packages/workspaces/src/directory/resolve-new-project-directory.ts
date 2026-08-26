// Where a NEW project's folder is created (Chad, 2026-08-24).
//
// The rule, in his words: "new projects go in this folder; existing projects
// are just listed." So this answers exactly one question — where does a
// brand-new project's folder get made — and says nothing about where projects
// already on disk live. Pulling in an existing project never consults this and
// never moves anything.
//
// The home is the user's own `projectsDirectory` once a Settings field lets
// them set one; until then it is the shared default, created on the spot (a
// mkdir cannot land under a parent that was never made). `projectsDirectory`
// is the durable seam — a per-user home writes to it with no further schema.

import { findUserById } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { ensureDefaultWorkspaceParentDirectory } from './ensure-default-workspace-parent-directory.js'

export async function resolveNewProjectDirectory(db: Database, userId: string): Promise<string> {
  const user = findUserById(db, userId)
  const directory = user?.projectsDirectory
  if (directory) return directory
  return ensureDefaultWorkspaceParentDirectory()
}

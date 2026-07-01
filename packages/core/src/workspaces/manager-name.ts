// Manager persona naming (brain-tree Ch5). Each workspace's manager has a NAME —
// "Mark is handling vynel". `workspaces.managerName` is auto-assigned a default on
// create + is renameable; pre-existing rows (null) resolve a DEFAULT here,
// deterministically by workspace id so the fallback is STABLE across reads.

import type { Workspace } from '@vynel/db/repositories/workspaces'

// A curated set of friendly first names. The pick is deterministic (by workspace id),
// so a workspace always shows the same default; the user can rename. Collisions across
// workspaces are fine — the workspace half of the label ("Mark · vynel") disambiguates.
const MANAGER_NAMES = [
  'Mark', 'Sarah', 'James', 'Emma', 'David', 'Olivia', 'Daniel', 'Sophia',
  'Michael', 'Grace', 'Ethan', 'Maya', 'Lucas', 'Chloe', 'Noah', 'Ava',
  'Leo', 'Mia', 'Owen', 'Zoe', 'Ryan', 'Lily', 'Adam', 'Nora',
] as const

/** A stable default manager name for a workspace — deterministic by id, so a null
 *  `managerName` resolves to the SAME name on every read (the fallback must not drift). */
export function deriveDefaultManagerName(workspaceId: string): string {
  let index = 0
  for (let i = 0; i < workspaceId.length; i += 1) {
    index = (index + workspaceId.charCodeAt(i)) % MANAGER_NAMES.length
  }
  return MANAGER_NAMES[index]!
}

/** The workspace's manager name — the explicit `managerName` if set, else a stable default. */
export function resolveManagerName(workspace: Pick<Workspace, 'id' | 'managerName'>): string {
  return workspace.managerName ?? deriveDefaultManagerName(workspace.id)
}

// Manager persona naming (brain-tree Ch5) — the ONE home for the derivation.
// Moved here from `@vynel/workspaces` (which re-exports it) so the composer's
// @-persona picker can derive the SAME names in the browser: contracts is
// dependency-free and bundle-safe, and the server's persona resolution and the
// client's roster must agree character-for-character (resolution is a
// case-sensitive match on the resolved name).
//
// Each workspace's manager has a NAME — "Mark is handling vynel".
// `workspaces.managerName` is auto-assigned a default on create + is
// renameable; pre-existing rows (null) resolve a DEFAULT here,
// deterministically by workspace id so the fallback is STABLE across reads.

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

/** The workspace's manager name — the explicit `managerName` if set, else a stable
 *  default. Structural param (id + managerName) so any workspace-shaped row fits. */
export function resolveManagerName(workspace: { id: string; managerName: string | null }): string {
  return workspace.managerName ?? deriveDefaultManagerName(workspace.id)
}

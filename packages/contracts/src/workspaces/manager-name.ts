// Manager persona naming (brain-tree Ch5) — the ONE home for the rule.
// Lives in contracts (dependency-free, bundle-safe) because the server's
// persona resolution and the composer's @-persona roster must agree
// character-for-character (resolution is a case-sensitive match on the
// resolved name).
//
// Each workspace's manager has a NAME — "vynel is handling vynel". By default
// it IS the workspace name (Kafi, 2026-08-19): a new workspace is created with
// `managerName = name`, and a row with no explicit persona resolves to its
// workspace name too. Renaming the persona later is what makes it distinct
// ("Mark · vynel").

/** The workspace's manager name — the explicit `managerName` if set, else the
 *  workspace's own name. Structural param so any workspace-shaped row fits. */
export function resolveManagerName(workspace: { name: string; managerName: string | null }): string {
  return workspace.managerName ?? workspace.name
}

/** True when the persona has a name of its own — "Mark" on "vynel" — as
 *  opposed to the default of simply being the workspace. */
export function hasDistinctManagerName(workspace: {
  name: string
  managerName: string | null
}): boolean {
  return !namesMatch(resolveManagerName(workspace), workspace.name)
}

/** The "persona · workspace" attribution label ("Mark · vynel"). When the
 *  persona is just the workspace's own name the label collapses to the
 *  workspace alone — "vynel · vynel" says nothing twice. Consumers that parse
 *  the label take the LAST ` · ` segment as the workspace, which still holds. */
export function formatManagerLabel(managerName: string, workspaceName: string): string {
  return namesMatch(managerName, workspaceName) ? workspaceName : `${managerName} · ${workspaceName}`
}

function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

// `composeManagerSourceLabel` — the attribution label for a workspace-manager message
// (brain-tree Ch5). With a persona it reads "Mark · vynel"; without one (undefined), it's
// just the workspace name (the pre-persona behavior — additive). The single home of the
// "persona · workspace" format; both delegation taggers compose through it.

export function composeManagerSourceLabel(workspaceName: string, managerName?: string): string {
  return managerName ? `${managerName} · ${workspaceName}` : workspaceName
}

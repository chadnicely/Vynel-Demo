// `composeManagerSourceLabel` — the attribution label for a workspace-manager message
// (brain-tree Ch5). With a distinct persona it reads "Mark · vynel"; without one
// (undefined, or the persona is just the workspace's own name) it's the workspace
// name alone. Both delegation taggers compose through it; the format itself is
// the shared `formatManagerLabel` so the UI's labels read identically.

import { formatManagerLabel } from '@vynel/contracts/workspaces/manager-name'

export function composeManagerSourceLabel(workspaceName: string, managerName?: string): string {
  return managerName ? formatManagerLabel(managerName, workspaceName) : workspaceName
}

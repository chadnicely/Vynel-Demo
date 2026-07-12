// Both installers accept a null workspace binding (a USER-scope install
// from the global marketplace has no workspace) — but a WORKSPACE-scope
// install cannot proceed without one. One home for that boundary check
// (error-handling rule: validate inputs at entry points, fail fast).

import { ValidationError } from '@vynel/errors'

export type WorkspaceInstallBinding = {
  workspaceId: string
  workspacePath: string
}

export function requireWorkspaceInstallBinding(input: {
  workspaceId: string | null
  workspacePath: string | null
}): WorkspaceInstallBinding {
  if (input.workspaceId === null || input.workspacePath === null) {
    throw new ValidationError(
      'A workspace-scope skill install needs its workspace id and path — pass both, or install at user scope.',
    )
  }
  return { workspaceId: input.workspaceId, workspacePath: input.workspacePath }
}

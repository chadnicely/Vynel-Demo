// Returns the default parent directory for new workspaces:
//   ~/Documents/Vynel/ on every supported OS (per D11).
// Pure factory — never throws (os.homedir() is infallible at the API
// level). Read by the `onboarding` domain when populating the workspace
// location picker. Per blueprint §9 + naming-reference.md `make*` verb.

import os from 'node:os'
import path from 'node:path'

export function makeDefaultWorkspaceParentDirectory(): string {
  return path.join(os.homedir(), 'Documents', 'Vynel')
}

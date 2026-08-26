// The ONE home for projects on this machine — `~/Documents/Vynel` (D11),
// created if it isn't there yet.
//
// `makeDefaultWorkspaceParentDirectory` is the pure factory that names the
// place; this is the op that makes sure it EXISTS. The distinction matters
// because a new project's folder is minted inside it — a mkdir under a parent
// that was never made would fail.
//
// Idempotent (`recursive: true`); creating an empty folder is the whole side
// effect, nothing is written inside it. `resolveDirectory` is injectable so
// tests never mkdir into the real `~/Documents`.

import { mkdir } from 'node:fs/promises'
import { makeDefaultWorkspaceParentDirectory } from './make-default-workspace-parent-directory.js'

export async function ensureDefaultWorkspaceParentDirectory(
  resolveDirectory: () => string = makeDefaultWorkspaceParentDirectory,
): Promise<string> {
  const directory = resolveDirectory()
  await mkdir(directory, { recursive: true })
  return directory
}

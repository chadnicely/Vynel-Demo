// Deletes one slash-command file from a scope's `.claude/commands/` folder
// on the user's explicit say-so — the Commands view's delete and the
// `delete_command` tool. A missing file is a 404, not a silent no-op. A
// namespace folder left empty by the delete is removed too, up to (never
// including) the commands root — the folder existed only to name the
// command, and an empty one would keep a stale `git:` group in the view.

import { rm, rmdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { NotFoundError } from '@vynel/errors'
import type { SkillScope } from '../repositories/index.js'
import { resolveCommandFilePath, resolveCommandsRoot } from './resolve-commands-root.js'

export type DeleteOwnCommandFileForScopeInput = {
  scope: SkillScope
  workspacePath?: string
  commandName: string
}

export async function deleteOwnCommandFileForScope(
  input: DeleteOwnCommandFileForScopeInput,
): Promise<void> {
  const filePath = resolveCommandFilePath(input.scope, input.commandName, input.workspacePath)
  try {
    await stat(filePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NotFoundError('command', input.commandName)
    }
    throw err
  }
  await rm(filePath, { force: true })
  await removeEmptyNamespaceFolders(
    path.dirname(filePath),
    resolveCommandsRoot(input.scope, input.workspacePath),
  )
}

// `rmdir` refuses a non-empty directory, which is exactly the stop we want —
// any other failure (a sibling still being written, a permission) is not
// worth failing the delete the user asked for.
async function removeEmptyNamespaceFolders(folder: string, root: string): Promise<void> {
  let current = folder
  while (current !== root && current.startsWith(root)) {
    try {
      await rmdir(current)
    } catch {
      return
    }
    current = path.dirname(current)
  }
}

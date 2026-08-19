// Create one new folder inside an existing directory — the filesystem
// browser's "New folder" button. A webview can't touch the disk, so the local
// API does it and the browser re-lists. The name is ONE path segment: no
// separators, no `.`/`..`, none of the characters Windows forbids (the
// strictest OS wins, so a folder made here opens everywhere). Every fs call
// surfaces as a typed error (ValidationError → 400, ConflictError → 409),
// never a bare 500.

import { mkdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { ConflictError, ValidationError } from '@vynel/errors'
import { sanitizeFolderName } from './sanitize-folder-name.js'
import type { DirectoryEntry } from './list-child-directories.js'

// Windows silently strips a trailing dot/space (`mkdir "foo."` makes `foo`) and
// refuses device names outright; refusing them here keeps the returned path
// equal to the folder that actually appears.
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export async function createChildDirectory(
  parentPath: string,
  requestedName: string,
): Promise<DirectoryEntry> {
  const name = requestedName.trim()
  if (name.length === 0) {
    throw new ValidationError('Give the new folder a name.')
  }
  if (name === '.' || name === '..' || sanitizeFolderName(name) !== name) {
    throw new ValidationError(
      `"${name}" can't be a folder name — leave out < > : " / \\ | ? * and control characters.`,
    )
  }
  if (/[. ]$/.test(name) || WINDOWS_RESERVED_NAME.test(name)) {
    throw new ValidationError(
      `"${name}" can't be a folder name — no trailing dot or space, and not a reserved name like CON or NUL.`,
    )
  }

  let parent: string
  try {
    parent = await realpath(parentPath)
  } catch {
    throw new ValidationError(`Folder not found: ${parentPath}. Pick a folder that exists.`)
  }
  let parentStats
  try {
    parentStats = await stat(parent)
  } catch {
    throw new ValidationError(`${parent} is no longer accessible.`)
  }
  if (!parentStats.isDirectory()) {
    throw new ValidationError(`${parent} is not a directory.`)
  }

  const target = path.join(parent, name)
  try {
    await mkdir(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ConflictError(`A folder named "${name}" is already here. Pick another name.`)
    }
    throw new ValidationError(
      `Couldn't create "${name}" in ${parent} — the folder may be read-only. Try another location.`,
    )
  }
  return { name, path: target }
}

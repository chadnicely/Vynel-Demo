// Path safety for user-registered knowledge source directories. A source can point
// at ANY directory the user chooses (workspace or global scope), so validate before
// indexing: it must be an absolute, existing, readable directory — and never a
// filesystem root or the home-directory root (indexing those would be a runaway).

import { statSync, accessSync, constants } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ValidationError } from '@vynel/errors'

export function assertIndexableDirectory(absolutePath: string): void {
  if (!path.isAbsolute(absolutePath)) {
    throw new ValidationError('A knowledge source path must be absolute.')
  }
  const normalized = path.resolve(absolutePath)
  if (normalized === path.parse(normalized).root) {
    throw new ValidationError('Refusing to index a filesystem root as a knowledge source.')
  }
  if (normalized === path.resolve(os.homedir())) {
    throw new ValidationError('Refusing to index the home-directory root as a knowledge source.')
  }
  let stats
  try {
    stats = statSync(normalized)
  } catch {
    throw new ValidationError(`Knowledge source directory does not exist: ${absolutePath}`)
  }
  if (!stats.isDirectory()) {
    throw new ValidationError(`Knowledge source path is not a directory: ${absolutePath}`)
  }
  try {
    accessSync(normalized, constants.R_OK)
  } catch {
    throw new ValidationError(`Knowledge source directory is not readable: ${absolutePath}`)
  }
}

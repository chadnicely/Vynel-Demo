// Resolve a user-supplied path to the canonical, existing directory it names
// — the one check every op that takes a folder from the UI runs first (the
// browser's listing, the workspace wizard's dispatch folder). `realpath`
// resolves symlinks + on-disk casing AND proves existence; the `stat` proves
// it is a directory. Both failures surface as a typed ValidationError → 400,
// never a bare 500 (error-handling.md).

import { realpath, stat } from 'node:fs/promises'
import { ValidationError } from '@vynel/errors'

export async function resolveExistingDirectory(requested: string): Promise<string> {
  let resolved: string
  try {
    resolved = await realpath(requested)
  } catch {
    throw new ValidationError(`Directory not found: ${requested}. Pick a folder that exists.`)
  }

  let stats
  try {
    stats = await stat(resolved)
  } catch {
    throw new ValidationError(`${resolved} is no longer accessible.`)
  }
  if (!stats.isDirectory()) {
    throw new ValidationError(`${resolved} is not a directory.`)
  }
  return resolved
}

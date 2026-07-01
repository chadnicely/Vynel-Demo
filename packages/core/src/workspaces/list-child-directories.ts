// List the subdirectories of a path on the local machine — backs the
// workspace folder-picker (apps/web DirectoryPickerModal). A browser can't
// expose absolute filesystem paths, but the local API can, so the picker reads
// directories through this op. Phase 1 is localhost-bound single-user; Phase 2
// auth gates who may browse.
//
// Returns directories only (files + dot-hidden entries are filtered out), each
// with its absolute path, plus the parent for "up" navigation. The listed path
// is realpath-canonical so it matches what `createWorkspace` will store + dedup.
//
// Every fs call is guarded so a TOCTOU race (path removed / perms revoked
// between calls) surfaces as a typed ValidationError → 400, never a plain Error
// → 500 (error-handling.md). Async (`node:fs/promises`) per coding-standard
// "core ops are async" — it isn't inside a Phase-1 sync transaction.

import { readdir, stat, realpath, access } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import path from 'node:path'
import { ValidationError } from '@vynel/core/errors'

export type DirectoryEntry = {
  name: string
  path: string
}

export type DirectoryListing = {
  /** The canonical absolute path being listed. */
  path: string
  /** The parent directory for "up" navigation, or null at the filesystem root. */
  parent: string | null
  /** Immediate subdirectories, sorted by name. */
  entries: DirectoryEntry[]
  /** Drive/volume roots the user can jump to (Windows drive letters; POSIX root). */
  drives: string[]
}

export async function listChildDirectories(targetPath?: string): Promise<DirectoryListing> {
  const requested = targetPath && targetPath.trim().length > 0 ? targetPath : homedir()

  let resolved: string
  try {
    // realpath resolves symlinks + canonical casing AND validates existence.
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

  let dirents
  try {
    dirents = await readdir(resolved, { withFileTypes: true })
  } catch {
    throw new ValidationError(`${resolved} is not readable.`)
  }

  const entries = dirents
    .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('.'))
    .map((dirent) => ({ name: dirent.name, path: path.join(resolved, dirent.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const parent = path.dirname(resolved)
  return {
    path: resolved,
    // dirname of the filesystem root is the root itself → no further "up".
    parent: parent === resolved ? null : parent,
    entries,
    drives: await listDriveRoots(),
  }
}

// The drive/volume roots the picker can jump to. Windows: every mounted drive
// letter (A–Z probed in parallel) so the user can switch off C:. POSIX: the
// single filesystem root — everything else is reachable by navigating.
async function listDriveRoots(): Promise<string[]> {
  if (platform() !== 'win32') return ['/']
  const candidates = Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:\\`)
  const probed = await Promise.all(
    candidates.map(async (root) => {
      try {
        await access(root)
        return root
      } catch {
        return null
      }
    }),
  )
  return probed.filter((root): root is string => root !== null)
}

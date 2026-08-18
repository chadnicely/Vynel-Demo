// List the subdirectories of a path on the local machine — backs the
// filesystem browser every picker shares (workspace folder, knowledge source,
// memory file import). A browser can't expose absolute filesystem paths, but
// the local API can, so the picker reads directories through this op. Phase 1
// is localhost-bound single-user; Phase 2 auth gates who may browse.
//
// Returns directories (dot-hidden + Windows' own system folders filtered out,
// the way Explorer's default view hides them), each with its
// absolute path, plus the parent for "up" navigation. Callers that pick FILES
// too (the knowledge add-source picker) opt in via `includeFiles` — the
// listing then also carries the folder's visible files. Every listing also
// carries the browser's fixed rails — the drives ("This PC") and the user's
// known places (Desktop, Documents, …) — so one read paints the whole
// Explorer-style window. The listed path is realpath-canonical so it matches
// what `createWorkspace` will store + dedup.
//
// Every fs call is guarded so a TOCTOU race (path removed / perms revoked
// between calls) surfaces as a typed ValidationError → 400, never a plain Error
// → 500 (error-handling.md). Async (`node:fs/promises`) per coding-standard
// "core ops are async" — it isn't inside a Phase-1 sync transaction.

import { readdir, stat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { ValidationError } from '@vynel/errors'
import { isExplorerHiddenDirectory, isExplorerHiddenFile } from './explorer-hidden-names.js'
import { listDriveRoots, type DriveRoot, type DriveRootsLogger } from './list-drive-roots.js'
import { listKnownPlaces, type KnownPlace } from './list-known-places.js'

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
  /** Immediate visible files, sorted by name — only when `includeFiles` was asked for. */
  files?: DirectoryEntry[]
  /** Drive/volume roots the user can jump to (Windows drive letters; POSIX root). */
  drives: DriveRoot[]
  /** The user's home + standard folders (Desktop, Documents, …) that exist. */
  places: KnownPlace[]
}

export async function listChildDirectories(
  targetPath?: string,
  options: { includeFiles?: boolean; logger?: DriveRootsLogger } = {},
): Promise<DirectoryListing> {
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
    .filter((dirent) => dirent.isDirectory() && !isExplorerHiddenDirectory(dirent.name))
    .map((dirent) => ({ name: dirent.name, path: path.join(resolved, dirent.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const files = options.includeFiles
    ? dirents
        .filter((dirent) => dirent.isFile() && !isExplorerHiddenFile(dirent.name))
        .map((dirent) => ({ name: dirent.name, path: path.join(resolved, dirent.name) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : undefined

  const parent = path.dirname(resolved)
  const [drives, places] = await Promise.all([listDriveRoots(options.logger), listKnownPlaces()])
  return {
    path: resolved,
    // dirname of the filesystem root is the root itself → no further "up".
    parent: parent === resolved ? null : parent,
    entries,
    ...(files !== undefined ? { files } : {}),
    drives,
    places,
  }
}

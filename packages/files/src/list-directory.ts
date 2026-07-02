// `listDirectory` — one level of the workspace folder, lazy expansion in
// the UI. Reads from disk every time (D1 — the disk is the source of
// truth; no DB mirror). Applies the hidden-entry filter by default.
//
// Returns directory entries sorted dirs-first then alphabetical (a
// Finder/Explorer convention). Empty workspace root resolves to an
// empty array, not a thrown error.

import path from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { NotFoundError } from '@vynel/errors'
import { assertRealpathContained } from './assert-realpath-contained.js'
import { isHiddenEntry } from './path-safety.js'
import { resolveWorkspaceRelativePath } from './resolve-workspace-relative-path.js'

export type DirectoryEntryKind = 'file' | 'directory'

export interface DirectoryEntry {
  name: string
  kind: DirectoryEntryKind
  // Forward-slash, workspace-relative — the DB + wire convention.
  relativePath: string
  // null for directories.
  fileSizeBytes: number | null
  modifiedAt: Date
  // Immediate-child count for directories (same hidden filter as the
  // listing, so it matches what the user sees on drill-in); null for
  // files and for directories whose contents can't be read.
  childCount: number | null
}

export type ListDirectoryInput = {
  workspacePath: string
  // Workspace-relative path of the directory to list. '' = workspace root.
  relativePath: string
  includeHidden?: boolean
}

export async function listDirectory(input: ListDirectoryInput): Promise<DirectoryEntry[]> {
  const { absolutePath, normalizedRelativePath } = resolveWorkspaceRelativePath(
    input.workspacePath,
    input.relativePath,
  )
  await assertRealpathContained(input.workspacePath, absolutePath)

  let dirents
  try {
    dirents = await readdir(absolutePath, { withFileTypes: true })
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new NotFoundError('directory', normalizedRelativePath)
    }
    throw cause
  }

  const includeHidden = input.includeHidden ?? false

  const entries: DirectoryEntry[] = []
  for (const dirent of dirents) {
    if (!includeHidden && isHiddenEntry(dirent.name)) continue
    const childRelative =
      normalizedRelativePath === '' ? dirent.name : `${normalizedRelativePath}/${dirent.name}`
    const childAbsolute = path.join(absolutePath, dirent.name)
    // `stat` follows symlinks; we want the target's mtime/size so the
    // UI reflects the actual file. Symlink escape-out is rejected at
    // the route layer once read/write ops adopt it;
    // listing follows shipped-knowledge precedent (followSymlinks:false
    // at the watcher level, but `stat` here is per-entry metadata only,
    // not a write surface).
    let s
    try {
      s = await stat(childAbsolute)
    } catch {
      // Entry vanished between readdir and stat — skip silently rather
      // than fail the whole listing.
      continue
    }
    const kind: DirectoryEntryKind = s.isDirectory() ? 'directory' : 'file'
    const childCount =
      kind === 'directory' ? await countVisibleChildren(childAbsolute, includeHidden) : null
    entries.push({
      name: dirent.name,
      kind,
      relativePath: childRelative,
      fileSizeBytes: kind === 'file' ? s.size : null,
      modifiedAt: s.mtime,
      childCount,
    })
  }

  // Dirs-first then alpha (case-insensitive) — the Finder/Explorer
  // convention.
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })

  return entries
}

// Counts a directory's immediate children under the same hidden-entry
// filter as the listing, so the folder-row badge matches what the user
// sees after drilling in. Returns null when the directory can't be read
// (permissions, vanished) — the UI hides the count rather than show 0.
async function countVisibleChildren(
  absolutePath: string,
  includeHidden: boolean,
): Promise<number | null> {
  try {
    const dirents = await readdir(absolutePath, { withFileTypes: true })
    if (includeHidden) return dirents.length
    return dirents.reduce((count, dirent) => (isHiddenEntry(dirent.name) ? count : count + 1), 0)
  } catch {
    return null
  }
}

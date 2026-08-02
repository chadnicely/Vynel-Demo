// The `#workspace` study tools' LOGIC (chat-mentions) — plain functions the
// descriptor wraps into MCP handlers, kept separate so the guards are directly
// testable without an SDK server in the way.
//
// SECURITY POSTURE (read-only, tightly fenced):
//   - the legal workspace set is EXACTLY the #-mentioned workspaces this turn
//     (`resolveStudyWorkspace` gates every call by id — nothing else resolves);
//   - every path is contained to the workspace root: absolute paths, `..`
//     escapes, and null bytes are rejected BEFORE touching the disk, and the
//     resolved target is realpath-checked so a symlink inside the tree cannot
//     read outside it (the Task-1 symlink lesson);
//   - reads are size-capped and binary-refused; listings are depth/entry-capped
//     and skip dependency/build directories.

import fs from 'node:fs'
import path from 'node:path'

/** One #-mentioned workspace, resolved by the server BEFORE composition. */
export interface StudyWorkspace {
  id: string
  name: string
  path: string
  managerName: string
}

const MAX_READ_BYTES = 256_000
const MAX_LIST_ENTRIES = 400
const MAX_LIST_DEPTH = 6

// Dependency/build trees — noise that would blow the entry cap instantly.
const SKIPPED_DIRECTORY_NAMES = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo',
  '.cache', 'coverage', '__pycache__', '.venv', 'venv', 'target', '.idea', '.vscode',
])

/** Gate every tool call to the turn's allowed set — an unknown id names the
 *  legal workspaces so the model can self-correct without enumeration games. */
export function resolveStudyWorkspace(
  workspaces: readonly StudyWorkspace[],
  workspaceId: string,
): StudyWorkspace {
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId)
  if (workspace === undefined) {
    const allowed = workspaces
      .map((candidate) => `"${candidate.name}" (${candidate.id})`)
      .join(', ')
    throw new Error(
      `Workspace ${workspaceId} is not study-readable this turn. ` +
        `The user's # references granted: ${allowed}.`,
    )
  }
  return workspace
}

/** Contain `relativePath` to the workspace root, rejecting absolutes, `..`
 *  escapes, null bytes, and symlink escapes. Returns the absolute path. */
export function resolveContainedPath(workspaceRoot: string, relativePath: string): string {
  if (relativePath.includes('\0')) {
    throw new Error('Path contains a null byte — refusing.')
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error('Use a path relative to the workspace root, not an absolute path.')
  }
  const root = path.resolve(workspaceRoot)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path escapes the workspace root — refusing.')
  }
  // Symlink defense: the LINK may sit inside the tree while its target points
  // outside. Realpath both sides (existing paths only) and re-check.
  if (fs.existsSync(resolved)) {
    const realRoot = fs.realpathSync(root)
    const realResolved = fs.realpathSync(resolved)
    if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path.sep)) {
      throw new Error('Path resolves outside the workspace root (symlink) — refusing.')
    }
  }
  return resolved
}

export interface WorkspaceFileListing {
  /** Workspace-relative paths, directories suffixed `/`, sorted per directory. */
  entries: string[]
  /** True when the entry or depth cap cut the walk short. */
  truncated: boolean
}

/** A bounded recursive listing under `relativePath` (default: the root). */
export function listWorkspaceFilesForStudy(
  workspace: StudyWorkspace,
  relativePath = '.',
): WorkspaceFileListing {
  const start = resolveContainedPath(workspace.path, relativePath)
  if (!fs.existsSync(start) || !fs.statSync(start).isDirectory()) {
    throw new Error(`"${relativePath}" is not a directory in workspace "${workspace.name}".`)
  }
  const root = path.resolve(workspace.path)
  const entries: string[] = []
  let truncated = false

  const walk = (directory: string, depth: number): void => {
    if (entries.length >= MAX_LIST_ENTRIES) {
      truncated = true
      return
    }
    if (depth > MAX_LIST_DEPTH) {
      truncated = true
      return
    }
    const names = fs.readdirSync(directory, { withFileTypes: true })
    const sorted = [...names].sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const entry of sorted) {
      if (entries.length >= MAX_LIST_ENTRIES) {
        truncated = true
        return
      }
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue
        entries.push(`${relative}/`)
        // Never descend through a symlinked directory — its target may sit
        // anywhere on disk.
        if (!entry.isSymbolicLink()) walk(absolute, depth + 1)
      } else {
        entries.push(relative)
      }
    }
  }

  walk(start, 1)
  return { entries, truncated }
}

export interface WorkspaceFileContent {
  path: string
  content: string
  truncated: boolean
}

/** Read one file — contained, size-capped, binary-refused. */
export function readWorkspaceFileForStudy(
  workspace: StudyWorkspace,
  relativePath: string,
): WorkspaceFileContent {
  const absolute = resolveContainedPath(workspace.path, relativePath)
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`"${relativePath}" is not a file in workspace "${workspace.name}".`)
  }
  const fileSize = fs.statSync(absolute).size
  const buffer = Buffer.alloc(Math.min(fileSize, MAX_READ_BYTES))
  const descriptor = fs.openSync(absolute, 'r')
  try {
    fs.readSync(descriptor, buffer, 0, buffer.length, 0)
  } finally {
    fs.closeSync(descriptor)
  }
  if (buffer.subarray(0, 8192).includes(0)) {
    throw new Error(`"${relativePath}" looks binary — only text files are readable here.`)
  }
  return {
    path: relativePath,
    content: buffer.toString('utf8'),
    truncated: fileSize > MAX_READ_BYTES,
  }
}

export interface WorkspaceStudyOverview {
  name: string
  managerName: string
  path: string
  /** Top-level entries (directories suffixed `/`). */
  topLevelEntries: string[]
}

/** The cheap orientation read: identity + the top of the tree. */
export function getWorkspaceOverviewForStudy(workspace: StudyWorkspace): WorkspaceStudyOverview {
  const listing = fs.existsSync(workspace.path)
    ? fs
        .readdirSync(workspace.path, { withFileTypes: true })
        .filter((entry) => !SKIPPED_DIRECTORY_NAMES.has(entry.name) || !entry.isDirectory())
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    : []
  return {
    name: workspace.name,
    managerName: workspace.managerName,
    path: workspace.path,
    topLevelEntries: listing,
  }
}

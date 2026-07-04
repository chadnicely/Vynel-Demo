// The path-safety helper — the SINGLE chokepoint for every fs touch in
// the files domain. Rejects path-traversal inputs (NUL byte, absolute,
// `..` escape) BEFORE any fs op runs. code-reviewer treats a missing
// containment check as Critical-tier.
//
// resolve* = pure path computation; throws ValidationError on bad input
// (resolve* sits alongside compute/derive — synchronous, no side effects).
//
// Symlink containment (`realpath` re-check) is a separate concern at
// the fs boundary inside read/write/delete ops. This file is the
// syntactic guard.

import path from 'node:path'
import { ValidationError } from '@vynel/errors'
import type { ResolvedWorkspacePath } from '../files-types.js'

// NUL byte (U+0000). Node's `path.*` functions silently truncate at NUL
// on some platforms; `fs.*` calls throw on NUL but the error class varies.
// Reject upfront so the boundary is consistent.
const NUL = String.fromCharCode(0)

export function resolveWorkspaceRelativePath(
  workspacePath: string,
  relativePath: string,
): ResolvedWorkspacePath {
  if (relativePath.includes(NUL)) {
    throw new ValidationError('That file path is not valid.')
  }
  if (path.isAbsolute(relativePath)) {
    throw new ValidationError('Use a path inside the workspace, not an absolute path.')
  }
  // path.resolve normalizes `..`, `.`, trailing slashes, and on Windows
  // converts forward-slash separators in `relativePath` to backslash.
  const root = path.resolve(workspacePath)
  const absolutePath = path.resolve(root, relativePath)
  // Containment check: absolutePath must equal root OR begin with `root + sep`.
  // Without the sep guard, `${root}-sibling` would falsely pass via
  // startsWith(root). The `+ sep` is the safe predicate.
  const isInside = absolutePath === root || absolutePath.startsWith(root + path.sep)
  if (!isInside) {
    throw new ValidationError('That path is outside the workspace.')
  }
  // Forward-slash, workspace-relative — the DB + wire convention
  // (knowledge D3). path.relative returns OS-native; the split/join
  // normalizes on Windows.
  const normalizedRelativePath = path
    .relative(root, absolutePath)
    .split(path.sep)
    .join('/')
  return { absolutePath, normalizedRelativePath }
}

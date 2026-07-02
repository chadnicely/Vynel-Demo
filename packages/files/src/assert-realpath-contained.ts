// The fs-boundary half of D2's path-containment posture. The syntactic
// helper `resolveWorkspaceRelativePath` rejects `..` escapes etc. at
// the string level; this helper rejects **symlink escapes** at the fs
// level by resolving the real on-disk path (via `fs.realpath`) and
// re-applying the containment predicate.
//
// Why this matters: Vynel's product premise is that an AI agent
// writes/edits files inside the workspace. If the agent (or any
// external editor) creates a symlink at `workspace/escape -> /etc/
// passwd`, `fs.readFile` follows it transparently — the syntactic
// helper sees a contained relative path and the fs reads the wrong
// bytes. This is the Critical-tier gap D2 forbids.

import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { ValidationError } from '@vynel/errors'

/**
 * Asserts that `absolutePath` resolves (through any symlinks) to a
 * location inside `workspacePath`. Works for both existing and
 * not-yet-created paths.
 *
 * For an existing path: `realpath(absolutePath)` directly.
 * For a not-yet-created path: walk up to the nearest existing
 * ancestor, realpath THAT, then re-append the unresolved suffix
 * (which can't contain symlinks since those segments don't exist).
 *
 * The workspace root itself is also realpathed — if the workspace
 * directory IS a symlink (e.g. on macOS where `/tmp` is a symlink to
 * `/private/tmp`), both sides resolve consistently.
 */
export async function assertRealpathContained(
  workspacePath: string,
  absolutePath: string,
): Promise<void> {
  const realRoot = await safeRealpath(path.resolve(workspacePath))
  if (!realRoot) {
    // Workspace itself doesn't exist — caller's problem, surface as
    // a generic ValidationError so the route returns 400 rather than 500.
    throw new ValidationError('The workspace directory does not exist.')
  }

  const realTarget = await resolveRealOrAncestor(absolutePath)
  const isInside = realTarget === realRoot || realTarget.startsWith(realRoot + path.sep)
  if (!isInside) {
    throw new ValidationError('That path resolves outside the workspace via a symlink.')
  }
}

async function safeRealpath(p: string): Promise<string | null> {
  try {
    return await realpath(p)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/**
 * Resolve to a real on-disk path. If the target doesn't exist, walk
 * up the directory tree to the first existing ancestor, realpath it,
 * then re-join the unresolved portion. The unresolved suffix can't
 * contain symlinks (the segments don't exist on disk), so concatenation
 * gives the correct would-be real path.
 */
async function resolveRealOrAncestor(absolutePath: string): Promise<string> {
  const resolved = path.resolve(absolutePath)
  const direct = await safeRealpath(resolved)
  if (direct !== null) return direct

  // Walk up to find the nearest existing ancestor.
  const suffix: string[] = []
  let current = resolved
  while (true) {
    const parent = path.dirname(current)
    if (parent === current) {
      // Hit filesystem root without finding an existing ancestor —
      // pathological, fall back to the resolved path itself.
      return resolved
    }
    suffix.unshift(path.basename(current))
    const realParent = await safeRealpath(parent)
    if (realParent !== null) {
      return path.join(realParent, ...suffix)
    }
    current = parent
  }
}

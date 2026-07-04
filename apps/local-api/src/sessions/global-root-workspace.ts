// The global root (agent-base Slice 3b) has no workspace, but the SDK still needs
// a working directory to run in. We give it a HIDDEN, user-level data directory —
// like `.claude`: a real, user-scoped, hidden folder (NOT a workspace folder) that
// is the global root's SDK `cwd` / `workspacePath`. The global root needs a place
// to *work*; it does NOT need a `workspaceId`.
//
// The base is resolved from `VYNEL_USER_DATA_DIR` (env-configurable), defaulting to
// `<home>/.vynel`; the global root's cwd is `<userData>/global-root`.
//
// `os.homedir()` is host-OS state — accessed here in a single grep-able helper,
// the workspaces `makeDefaultWorkspaceParentDirectory` + skills `resolveHostHomeDir`
// carve-out precedent. The module-level override below is TEST-SUPPORT ONLY (never
// touched by production code); it lets tests isolate the dir to a tmpdir without
// writing to the real home — the `withHomeDir` seam mirrored. Vitest workers are
// separate processes, so the module-level value is isolated per-worker.

import os from 'node:os'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { loadEnv } from '../env.js'

let userDataDirOverride: string | undefined

function resolveUserDataDir(): string {
  if (userDataDirOverride !== undefined) return userDataDirOverride
  return loadEnv().VYNEL_USER_DATA_DIR ?? path.join(os.homedir(), '.vynel')
}

/** The global root's SDK working directory (the hidden user-data dir). Pure. */
export function resolveGlobalRootWorkspacePath(): string {
  return path.join(resolveUserDataDir(), 'global-root')
}

/** Ensure the global root's working directory exists; returns its path. */
export function ensureGlobalRootWorkspaceDir(): string {
  const dir = resolveGlobalRootWorkspacePath()
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Test-support: run `fn` with the user-data dir pinned to `dir`. */
export async function withVynelUserDataDir<T>(
  dir: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const previous = userDataDirOverride
  userDataDirOverride = dir
  try {
    return await fn()
  } finally {
    userDataDirOverride = previous
  }
}

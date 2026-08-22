// "Create from a repository" (Chad, 2026-08-11 — the second door under
// "bring in what you have"): clone a git address into a fresh folder inside
// the folder the user chose, then register that folder as a workspace through
// the same `createWorkspace` every workspace goes through. Nothing the user
// already has is touched; the clone is the history, so no scaffold.
//
// SHAPE: the folder is made by `createChildDirectory` (the one home for the
// folder-name rules — `git clone` is happy with an empty directory), git runs
// with fixed argument lists, `protocol.ext.allow=never` (blocks the
// command-executing ext:: transport) and a `--` guard so a hostile address can
// never be read as an option. Anything that fails after the folder exists
// takes the folder back with it, so the same name is free to retry. The git
// runner is injectable so tests never touch the network.

import { rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ValidationError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { Workspace } from '@vynel/db/repositories/workspaces'
import { createWorkspace, type CreateWorkspaceDependencies } from './create-workspace.js'
import { getWorkspaceGroupForUserOrThrow } from '../groups/get-workspace-group-for-user.js'
import { createChildDirectory } from '../directory/create-child-directory.js'
import { sanitizeFolderName } from '../directory/sanitize-folder-name.js'
import type { GitRunner } from './scaffold-workspace.js'

const run = promisify(execFile)
const GIT_CLONE_TIMEOUT_MS = 5 * 60 * 1000

// A repository address we will hand to `git clone`. Must look like a real
// remote — an https/http/ssh/git scheme, or the scp-style `user@host:path` —
// never a bare local path, an option (leading '-'), or a value with spaces.
// The `--` separator + `protocol.ext.allow=never` are the real backstop; this
// is the friendly up-front check that gives the form a clear message.
const REMOTE_URL = /^(https?:\/\/|ssh:\/\/|git:\/\/|[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:).+/

export type CloneRepositoryWorkspaceInput = {
  userId: string
  name: string
  /** The folder the user chose — the clone lands in a new folder inside it. */
  parentPath: string
  repositoryUrl: string
  /** Folder name; defaults to the workspace name. Sanitized either way. */
  folderName?: string
  /** The menu-tree group the door was opened from; omit for the tree root. */
  groupId?: string
}

export type CloneRepositoryWorkspaceDependencies = CreateWorkspaceDependencies & {
  readonly runGit?: GitRunner
  readonly logger?: {
    info: (obj: object, msg: string) => void
    warn: (obj: object, msg: string) => void
  }
}

const defaultGitRunner: GitRunner = async (args, cwd) => {
  await run('git', ['-c', 'protocol.ext.allow=never', ...args], {
    cwd,
    timeout: GIT_CLONE_TIMEOUT_MS,
    windowsHide: true,
  })
}

export async function cloneRepositoryWorkspace(
  db: Database,
  input: CloneRepositoryWorkspaceInput,
  deps: CloneRepositoryWorkspaceDependencies = {},
): Promise<{ workspace: Workspace }> {
  const runGit = deps.runGit ?? defaultGitRunner

  const url = input.repositoryUrl.trim()
  if (url === '' || url.startsWith('-') || url.includes(' ') || !REMOTE_URL.test(url)) {
    throw new ValidationError(
      'That does not look like a repository address — use an https or ssh git URL, e.g. https://github.com/you/project.git.',
    )
  }
  const name = input.name.trim()
  if (name === '') throw new ValidationError('Give the workspace a name.')
  if (input.groupId !== undefined) {
    getWorkspaceGroupForUserOrThrow(db, input.userId, input.groupId)
  }

  const folder = await createChildDirectory(input.parentPath, folderNameFor(input, name))
  try {
    try {
      await runGit(['clone', '--', url, folder.path], input.parentPath)
    } catch (error) {
      deps.logger?.warn({ err: error, directory: folder.path }, 'git clone failed')
      throw new ValidationError(`Could not clone that repository — ${describeGitFailure(error)}`)
    }
    const workspace = await createWorkspace(
      db,
      {
        userId: input.userId,
        name,
        directory: folder.path,
        ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
      },
      deps,
    )
    return { workspace }
  } catch (error) {
    // The folder is ours alone (just made) — take it and whatever git left
    // back, so the same name is free to retry.
    await rm(folder.path, { recursive: true, force: true })
    throw error
  }
}

function folderNameFor(input: CloneRepositoryWorkspaceInput, name: string): string {
  const requested = input.folderName?.trim() || name
  // `createChildDirectory` refuses a name it would have to change; sanitize
  // first so "Front: v2" becomes a folder, not a 400.
  return sanitizeFolderName(requested).replace(/[. ]+$/, '') || 'workspace'
}

// The reason a person can act on: git missing, the clone timing out, or
// git's own first meaningful line — never the raw command line (which would
// echo a pasted address, token and all).
function describeGitFailure(error: unknown): string {
  const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null
  if (failure?.code === 'ENOENT') return "git isn't installed on this computer (or isn't on PATH)"
  if (failure?.killed) return 'the clone took longer than five minutes and was stopped'
  return cleanGitError(failure?.message ?? '')
}

function cleanGitError(message: string): string {
  const lines = message
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith('Command failed'))
  const line =
    lines.find(
      (entry) =>
        entry.toLowerCase().includes('fatal:') || entry.toLowerCase().includes('error:'),
    ) ?? lines[0]
  const picked = (line ?? '').replace(/^fatal:\s*/i, '').trim()
  return picked === '' ? 'the clone failed' : picked
}

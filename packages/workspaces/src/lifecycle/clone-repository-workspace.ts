// "Create from a repository" (Chad, 2026-08-11 — the second door under
// "bring in what you have"): clone a git address INTO the folder the user
// chose (Kafi, 2026-08-23 — the chosen folder is the workspace, no child
// folder minted from the name), then register it through the same
// `createWorkspace` every workspace goes through. The folder must be empty —
// git's own rule, and the one thing that keeps a clone from landing on top
// of someone's files. The clone is the history, so no scaffold.
//
// SHAPE: git runs with fixed argument lists, `protocol.ext.allow=never`
// (blocks the command-executing ext:: transport) and a `--` guard so a
// hostile address can never be read as an option. A failed clone empties
// the folder again (what git left, nothing else) so it is free to retry.
// The git runner is injectable so tests never touch the network.

import path from 'node:path'
import { readdir, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ValidationError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type { Workspace } from '@vynel/db/repositories/workspaces'
import { createWorkspace, type CreateWorkspaceDependencies } from './create-workspace.js'
import { getWorkspaceGroupForUserOrThrow } from '../groups/get-workspace-group-for-user.js'
import { resolveExistingDirectory } from '../directory/resolve-existing-directory.js'
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
  /** The folder the user chose — the clone lands IN it; it must be empty. */
  directory: string
  repositoryUrl: string
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

  const directory = await resolveExistingDirectory(input.directory)
  if ((await readdir(directory)).length > 0) {
    throw new ValidationError(
      'That folder already has things in it — a repository can only be cloned into an empty folder. Use New folder to make one, or pick an empty one.',
    )
  }

  try {
    await runGit(['clone', '--', url, directory], directory)
  } catch (error) {
    deps.logger?.warn({ err: error, directory }, 'git clone failed')
    await emptyDirectory(directory, deps)
    throw new ValidationError(`Could not clone that repository — ${describeGitFailure(error)}`)
  }

  try {
    const workspace = await createWorkspace(
      db,
      {
        userId: input.userId,
        name,
        directory,
        ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
      },
      deps,
    )
    return { workspace }
  } catch (error) {
    await emptyDirectory(directory, deps)
    throw error
  }
}

// The folder was empty when we started — what is in it now is the clone's
// leftovers alone, so emptying it leaves exactly what the user had. A cleanup
// that fails on top of the real error (EBUSY from a still-running git on
// Windows) is logged, never thrown over it.
async function emptyDirectory(
  directory: string,
  deps: CloneRepositoryWorkspaceDependencies,
): Promise<void> {
  try {
    const entries = await readdir(directory)
    await Promise.all(
      entries.map((entry) => rm(path.join(directory, entry), { recursive: true, force: true })),
    )
  } catch (cleanupError) {
    deps.logger?.warn({ err: cleanupError, directory }, 'could not empty the folder after a failed clone')
  }
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

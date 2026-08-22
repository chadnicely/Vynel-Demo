// The new-workspace wizard's Finish: a brand-new workspace gets a real home.
// In order — the group is checked first so a bad pick never leaves a stray
// folder — the folder is made inside the folder the user chose (never the
// global space), a README records the name + the stack they picked, git is
// initialised with a first commit (best-effort: a machine without git still
// gets a healthy workspace, reported honestly), then the row + the approved
// plan (the brief) land in ONE transaction through the same
// `createWorkspaceWithin` every workspace goes through — invariant 5.
//
// What this deliberately does NOT do: start the build. The first session is
// the user pressing send on the brief seeded into the workspace's chat —
// building begins under their eyes, never as a side effect of Finish.
//
// SHAPE: fixed argument lists via execFile; the git step takes an injectable
// runner so tests never shell out.

import path from 'node:path'
import { rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { ValidationError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import type { Workspace } from '@vynel/db/repositories/workspaces'
import * as workspaceBriefsRepository from '@vynel/db/repositories/workspaces'
import {
  buildWorkspaceBrief,
  type WorkspaceBriefAnswers,
  type WorkspacePlan,
  type WorkspaceStack,
} from '@vynel/contracts/workspaces/workspace-brief'
import { createWorkspaceWithin, type CreateWorkspaceDependencies } from './create-workspace.js'
import { getWorkspaceGroupForUserOrThrow } from '../groups/get-workspace-group-for-user.js'
import { createChildDirectory } from '../directory/create-child-directory.js'
import { sanitizeFolderName } from '../directory/sanitize-folder-name.js'
import { toWorkspaceBrief, type WorkspaceBrief } from '../brief/workspace-brief.js'

const run = promisify(execFile)
const GIT_TIMEOUT_MS = 20_000

export type ScaffoldWorkspaceInput = {
  userId: string
  name: string
  /** The folder the user chose on screen 1 — the workspace folder is made inside it. */
  parentPath: string
  /** Folder name; defaults to the workspace name. Sanitized either way. */
  folderName?: string
  /** The menu-tree group the wizard was opened from; omit for the tree root. */
  groupId?: string
  /** The answers + the approved plan — stored as the workspace's brief. */
  answers: WorkspaceBriefAnswers
  plan: WorkspacePlan
}

export type ScaffoldGitOutcome =
  | { kind: 'initialized' }
  | { kind: 'skipped'; reason: string }

export type ScaffoldedWorkspace = {
  workspace: Workspace
  /** What actually happened with git — shown, never assumed. */
  git: ScaffoldGitOutcome
  brief: WorkspaceBrief
}

export type GitRunner = (args: string[], cwd: string) => Promise<void>

const defaultGitRunner: GitRunner = async (args, cwd) => {
  await run('git', args, { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true })
}

export type ScaffoldWorkspaceDependencies = CreateWorkspaceDependencies & {
  readonly runGit?: GitRunner
  readonly logger?: {
    info: (obj: object, msg: string) => void
    warn: (obj: object, msg: string) => void
  }
}

const GIT_SKIPPED_NOTE =
  "Git couldn't start a history in this folder — it may not be installed, or it refused the first commit. The workspace is fine; once git works here, the history starts from there."

// Vynel's own metadata (and the transcript images chat drops under it) never
// belongs in the project's history.
const GITIGNORE = '.vynel/\n'

export async function scaffoldWorkspace(
  db: Database,
  input: ScaffoldWorkspaceInput,
  deps: ScaffoldWorkspaceDependencies = {},
): Promise<ScaffoldedWorkspace> {
  const name = input.name.trim()
  if (name === '') throw new ValidationError('Give the workspace a name.')
  if (input.groupId !== undefined) {
    getWorkspaceGroupForUserOrThrow(db, input.userId, input.groupId)
  }

  const folder = await createChildDirectory(input.parentPath, folderNameFor(input, name))
  try {
    await writeFile(path.join(folder.path, 'README.md'), buildReadme(name, input.answers.stack), 'utf8')
    await writeFile(path.join(folder.path, '.gitignore'), GITIGNORE, 'utf8')
    const git = await initialiseGit(folder.path, deps)

    const { workspace, brief } = withTransaction(db, (tx) => {
      const workspace = createWorkspaceWithin(tx, {
        userId: input.userId,
        name,
        directory: folder.path,
        ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
      })
      const brief = workspaceBriefsRepository.insertWorkspaceBrief(tx, {
        id: randomUUID(),
        userId: input.userId,
        workspaceId: workspace.id,
        answers: input.answers,
        plan: input.plan,
        brief: buildWorkspaceBrief({
          name,
          answers: input.answers,
          plan: input.plan,
          note: git.kind === 'skipped' ? git.reason : null,
        }),
        createdAt: new Date(),
      })
      return { workspace, brief: toWorkspaceBrief(brief) }
    })
    deps.logger?.info(
      { workspaceId: workspace.id, path: workspace.path, git: git.kind },
      'workspace scaffolded',
    )
    return { workspace, git, brief }
  } catch (error) {
    // The folder is ours alone (just made, empty but for our README) — take
    // it back so a failed Finish leaves nothing behind to trip the next try.
    await rm(folder.path, { recursive: true, force: true })
    throw error
  }
}

function folderNameFor(input: ScaffoldWorkspaceInput, name: string): string {
  const requested = input.folderName?.trim() || name
  // `createChildDirectory` refuses a name it would have to change; sanitize
  // first so a title like "Front of House: v2" becomes a folder, not a 400.
  return sanitizeFolderName(requested).replace(/[. ]+$/, '') || 'workspace'
}

async function initialiseGit(
  directory: string,
  deps: ScaffoldWorkspaceDependencies,
): Promise<ScaffoldGitOutcome> {
  const runGit = deps.runGit ?? defaultGitRunner
  try {
    await runGit(['init'], directory)
    await runGit(['add', '.'], directory)
    // A fresh machine has no git identity; the first commit must not fail on
    // that, so the scaffold signs it itself.
    await runGit(
      ['-c', 'user.name=Vynel', '-c', 'user.email=vynel@localhost', 'commit', '-m', 'chore: new workspace scaffold'],
      directory,
    )
    return { kind: 'initialized' }
  } catch (error) {
    deps.logger?.warn({ err: error, directory }, 'git could not initialise the new workspace')
    return { kind: 'skipped', reason: GIT_SKIPPED_NOTE }
  }
}

function buildReadme(name: string, stack: WorkspaceStack): string {
  return `# ${name}\n\nCreated with Vynel.\n\n## Stack\n\n- Front end: ${stack.front}\n- Back end: ${stack.back}\n- Database: ${stack.database}\n`
}

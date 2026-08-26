// The new-workspace wizard's Finish: the folder the user chose IS the
// workspace (Kafi, 2026-08-23 — no child folder minted from the name; the
// browser's "New folder" makes an empty one when they want one). In order —
// the group is checked first so a bad pick writes nothing — a README records
// the name + the stack they picked, `.vynel/` is gitignored, git is
// initialised with a first commit (best-effort: a machine without git still
// gets a healthy workspace, reported honestly; a folder that already has a
// history keeps it), then the row + the approved plan (the brief) land in
// ONE transaction through the same `createWorkspaceWithin` every workspace
// goes through — invariant 5. Nothing the user already had is overwritten:
// an existing README or .gitignore is left alone.
//
// What this deliberately does NOT do: start the build. The first session is
// the user pressing send on the brief seeded into the workspace's chat —
// building begins under their eyes, never as a side effect of Finish.
//
// SHAPE: git runs through the package's one runner (`../git/run-git.ts`),
// injectable so tests never shell out.

import path from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
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
import { ensureWorkspaceMetadataDirectory } from '../directory/ensure-workspace-metadata-directory.js'
import { resolveExistingDirectory } from '../directory/resolve-existing-directory.js'
import { resolveNewProjectDirectory } from '../directory/resolve-new-project-directory.js'
import { sanitizeFolderName } from '../directory/sanitize-folder-name.js'
import { toWorkspaceBrief, type WorkspaceBrief } from '../brief/workspace-brief.js'
import { defaultGitRunner, type GitRunner } from '../git/run-git.js'

export type ScaffoldWorkspaceInput = {
  userId: string
  name: string
  /** Where the project goes. OMIT IT for a new project (Chad, 2026-08-24 —
   *  "reverse his rule... it's too hard for people"): the folder is minted
   *  from the name inside the user's projects folder, and the user never sees
   *  or picks a path. Supplying one is the pull-in path, where the user really
   *  is pointing at a folder that already exists. */
  directory?: string
  /** The menu-tree group the wizard was opened from; omit for the tree root. */
  groupId?: string
  /** The answers + the approved plan — stored as the workspace's brief. */
  answers: WorkspaceBriefAnswers
  plan: WorkspacePlan
}

export type ScaffoldGitOutcome =
  | { kind: 'initialized' }
  /** The folder already had a `.git` — its history is kept, untouched. */
  | { kind: 'existing' }
  | { kind: 'skipped'; reason: string }

export type ScaffoldedWorkspace = {
  workspace: Workspace
  /** What actually happened with git — shown, never assumed. */
  git: ScaffoldGitOutcome
  brief: WorkspaceBrief
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

// Two ways in, one folder out.
//
// NEW project (no `directory`): mint `<the user's projects folder>/<name>`.
// Picking a folder was the single hardest thing setup asked of a non-technical
// user, so the wizard stopped asking — the name IS the folder. `mkdir` is
// recursive and never touches what is already inside, so re-using a name lands
// in the existing folder rather than failing; `sanitizeFolderName` refuses a
// traversal, so the mint can never escape the parent.
//
// PULL-IN (`directory` given): the folder must already exist and is used
// exactly as handed over — nothing is created, nothing is moved. This is the
// half of Kafi's 2026-08-23 rule that survives, and the only path that ever
// shows a folder picker.
async function resolveScaffoldDirectory(
  db: Database,
  input: ScaffoldWorkspaceInput,
  name: string,
): Promise<string> {
  if (input.directory !== undefined) return resolveExistingDirectory(input.directory)

  const home = await resolveNewProjectDirectory(db, input.userId)
  const directory = path.join(home, sanitizeFolderName(name))
  await mkdir(directory, { recursive: true })
  return resolveExistingDirectory(directory)
}

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
  const directory = await resolveScaffoldDirectory(db, input, name)

  // Everything we add to the user's folder, so a failed Finish takes back
  // exactly that — never the folder, never what was already there.
  const written: string[] = []
  try {
    await writeIfAbsent(path.join(directory, 'README.md'), buildReadme(name, input.answers.stack), written)
    await writeIfAbsent(path.join(directory, '.gitignore'), GITIGNORE, written)
    const git = await initialiseGit(directory, deps, written)

    // Direct `createWorkspaceWithin` callers ensure `.vynel/` themselves —
    // async, before the transaction (see ensure-workspace-metadata-directory.ts).
    // Tracked like every other write: a refused Finish takes it back.
    const createdMetadataDirectory = await ensureWorkspaceMetadataDirectory(directory)
    if (createdMetadataDirectory !== null) written.push(createdMetadataDirectory)

    const { workspace, brief } = withTransaction(db, (tx) => {
      const workspace = createWorkspaceWithin(tx, {
        userId: input.userId,
        name,
        directory,
        ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
        // The wizard built and configured it — it is set up from birth, never
        // shown under NEEDS SETUP.
        setupCompletedAt: new Date(),
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
    // The user's error is the one that matters; a cleanup that fails on top
    // of it (EBUSY from a still-running git on Windows) is logged, not thrown.
    try {
      await Promise.all(written.map((entry) => rm(entry, { recursive: true, force: true })))
    } catch (cleanupError) {
      deps.logger?.warn({ err: cleanupError, directory }, 'could not take back the scaffold files')
    }
    throw error
  }
}

async function writeIfAbsent(file: string, content: string, written: string[]): Promise<void> {
  if (existsSync(file)) return
  try {
    await writeFile(file, content, 'utf8')
  } catch {
    throw new ValidationError(
      `Couldn't write in ${path.dirname(file)} — the folder may be read-only. Try another location.`,
    )
  }
  written.push(file)
}

async function initialiseGit(
  directory: string,
  deps: ScaffoldWorkspaceDependencies,
  written: string[],
): Promise<ScaffoldGitOutcome> {
  if (existsSync(path.join(directory, '.git'))) return { kind: 'existing' }
  const runGit = deps.runGit ?? defaultGitRunner
  try {
    await runGit(['init'], directory)
    written.push(path.join(directory, '.git'))
    // Only what the scaffold put there goes into the first commit — never a
    // sweep of whatever the user already kept in the folder (.env, photos,
    // node_modules). A folder that already had both files gets an empty
    // first commit: history starts, nothing is claimed.
    const added = written.filter((entry) => !entry.endsWith('.git')).map((entry) => path.basename(entry))
    if (added.length > 0) await runGit(['add', '--', ...added], directory)
    // A fresh machine has no git identity; the first commit must not fail on
    // that, so the scaffold signs it itself.
    await runGit(
      [
        '-c',
        'user.name=Vynel',
        '-c',
        'user.email=vynel@localhost',
        'commit',
        ...(added.length === 0 ? ['--allow-empty'] : []),
        '-m',
        'chore: new workspace scaffold',
      ],
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

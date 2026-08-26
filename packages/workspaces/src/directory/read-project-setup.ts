// Everything "Finish setting up" can answer BY LOOKING — read once, off the
// project's own folder.
//
// The screen's rule (Chad, 2026-08-10): Vynel is standing in the folder, so it
// should not ask what it can see. The repository, the .env and the database
// are all readable; the only genuine question is which AI account does the
// building, because that is a preference, not a fact.
//
// Every field carries what we found AND what we would do about it, so the UI
// never has to re-derive an intention from a bag of booleans.

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { ValidationError } from '@vynel/errors'
import type { GitFacts } from '@vynel/contracts/workspaces/workspace-git'
import { readGitFacts } from '../git/read-git-facts.js'

export type EnvPlan =
  /** A .env is already here — nothing to do. */
  | { kind: 'present'; keyNames: string[] }
  /** No .env, but a template to build one from. */
  | { kind: 'from-example'; keyNames: string[] }
  /** Nothing found, and nothing suggests it needs any. */
  | { kind: 'not-needed' }

export type RepositoryPlan =
  /** Already pushing somewhere — the answer is the remote. */
  | { kind: 'remote'; url: string }
  /** A repo with no remote: we would create one under this name. */
  | { kind: 'local-only'; suggestedName: string }
  /** No git at all: we would start one, then create the remote. */
  | { kind: 'none'; suggestedName: string }

export type ProjectSetup = {
  path: string
  git: GitFacts
  repository: RepositoryPlan
  env: EnvPlan
  /** Detected from the dependencies, or null when we cannot tell. */
  database: string | null
  /** True when the database sits in the folder itself (a SQLite file). */
  databaseIsLocal: boolean
  /** The one thing the folder cannot answer. */
  needsAccountChoice: true
}

export async function readProjectSetup(projectPath: string): Promise<ProjectSetup> {
  if (!projectPath || projectPath.trim().length === 0) {
    throw new ValidationError('A project path is required to read its setup.')
  }
  let stats
  try {
    stats = await stat(projectPath)
  } catch {
    throw new ValidationError(`${projectPath} is no longer accessible.`)
  }
  if (!stats.isDirectory()) {
    throw new ValidationError(`${projectPath} is not a directory.`)
  }

  const [git, env, database] = await Promise.all([
    readGitFacts(projectPath),
    readEnvPlan(projectPath),
    readDatabase(projectPath),
  ])

  return {
    path: projectPath,
    git,
    repository: planRepository(git, projectPath),
    env,
    database,
    databaseIsLocal: database === 'SQLite',
    needsAccountChoice: true,
  }
}

/** The folder's own name, slugged — what a new repository would be called. */
export function suggestRepositoryName(projectPath: string): string {
  const base = path.basename(projectPath)
  return base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Main types `GitFacts` as a tagged union (a folder can be missing, have no
// git, be unreadable, or be a real repository) where Chad's branch had flat
// `isRepository` / `remoteUrl` booleans. Same three answers, read off the
// union: it already pushes somewhere, it has a history but no remote, or it
// has no history at all.
function planRepository(git: GitFacts, projectPath: string): RepositoryPlan {
  const suggestedName = suggestRepositoryName(projectPath)
  if (git.kind !== 'repository') return { kind: 'none', suggestedName }
  if (git.remoteUrl !== null) return { kind: 'remote', url: git.remoteUrl }
  return { kind: 'local-only', suggestedName }
}

/** KEY NAMES only — the values are never read out of the file. */
function parseKeyNames(contents: string): string[] {
  return contents
    .split('\n')
    .map((line) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined)
}

async function readEnvPlan(projectPath: string): Promise<EnvPlan> {
  const present = await readIfPresent(path.join(projectPath, '.env'))
  if (present !== null) return { kind: 'present', keyNames: parseKeyNames(present) }

  for (const template of ['.env.example', '.env.sample', '.env.template']) {
    const contents = await readIfPresent(path.join(projectPath, template))
    if (contents !== null) {
      return { kind: 'from-example', keyNames: parseKeyNames(contents) }
    }
  }
  return { kind: 'not-needed' }
}

async function readIfPresent(candidate: string): Promise<string | null> {
  try {
    return await readFile(candidate, 'utf8')
  } catch {
    return null
  }
}

const DATABASE_BY_DEPENDENCY: Array<[string, string]> = [
  ['pg', 'Postgres'],
  ['postgres', 'Postgres'],
  ['@prisma/client', 'Prisma'],
  ['mongoose', 'MongoDB'],
  ['mongodb', 'MongoDB'],
  ['better-sqlite3', 'SQLite'],
  ['sqlite3', 'SQLite'],
  ['mysql2', 'MySQL'],
  ['mysql', 'MySQL'],
]

async function readDatabase(projectPath: string): Promise<string | null> {
  const raw = await readIfPresent(path.join(projectPath, 'package.json'))
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const names = new Set(
      Object.keys({ ...parsed.dependencies, ...parsed.devDependencies }),
    )
    for (const [dependency, label] of DATABASE_BY_DEPENDENCY) {
      if (names.has(dependency)) return label
    }
    return null
  } catch {
    return null
  }
}

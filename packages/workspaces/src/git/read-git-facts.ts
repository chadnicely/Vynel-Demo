// The facts a workspace header shows about its folder's git: branch, how far
// from the upstream, how much is uncommitted, where `origin` points. ONE
// `git status --porcelain=v2 --branch` carries all of it except the remote
// address. A plain folder, a missing folder and a machine without git are
// answers, not errors — only a repository that git itself cannot read comes
// back 'unreadable', with git's reason.

import { stat } from 'node:fs/promises'
import type { GitFacts, GitRepositoryFacts } from '@vynel/contracts/workspaces/workspace-git'
import { describeGitFailure } from './describe-git-failure.js'
import { defaultGitRunner, isGitMissing, isNotARepository, type GitRunner } from './run-git.js'

export async function readGitFacts(
  directory: string,
  runGit: GitRunner = defaultGitRunner,
): Promise<GitFacts> {
  // A vanished folder would make the spawn itself fail with ENOENT — the
  // same code a missing git binary gives — so the folder is checked first.
  if (!(await isDirectory(directory))) return { kind: 'folder-missing' }

  let status: string
  try {
    status = await runGit(['status', '--porcelain=v2', '--branch'], directory)
  } catch (error) {
    if (isGitMissing(error)) return { kind: 'no-git' }
    if (isNotARepository(error)) return { kind: 'not-a-repository' }
    return {
      kind: 'unreadable',
      reason: describeGitFailure(error, {
        timedOut: 'git took too long to answer',
        fallback: 'git could not read this folder',
      }),
    }
  }

  const facts = parseGitStatus(status)
  return { ...facts, remoteUrl: await readOriginUrl(directory, runGit) }
}

/** Exported for tests — the parsing is where the risk lives. */
export function parseGitStatus(status: string): Omit<GitRepositoryFacts, 'remoteUrl'> {
  const facts: Omit<GitRepositoryFacts, 'remoteUrl'> = {
    kind: 'repository',
    branch: null,
    upstream: null,
    ahead: null,
    behind: null,
    changedCount: 0,
    untrackedCount: 0,
  }
  for (const line of status.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim()
      facts.branch = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.upstream ')) {
      facts.upstream = line.slice('# branch.upstream '.length).trim()
    } else if (line.startsWith('# branch.ab ')) {
      const counts = /\+(\d+) -(\d+)/.exec(line)
      facts.ahead = Number(counts?.[1] ?? 0)
      facts.behind = Number(counts?.[2] ?? 0)
    } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      facts.changedCount += 1
    } else if (line.startsWith('? ')) {
      facts.untrackedCount += 1
    }
  }
  return facts
}

async function readOriginUrl(directory: string, runGit: GitRunner): Promise<string | null> {
  try {
    const url = (await runGit(['remote', 'get-url', 'origin'], directory)).trim()
    return url === '' ? null : redactCredentials(url)
  } catch {
    // "No such remote 'origin'" — a local-only repository, a normal state.
    return null
  }
}

// A pasted `https://token@github.com/...` is stored verbatim in .git/config and
// would otherwise ride into the response, the tool transcript and the header
// tooltip. scp-style `git@host:path` has no scheme and is left alone.
export function redactCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, '$1')
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory()
  } catch {
    return false
  }
}

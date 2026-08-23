// Every checkout of a workspace's repository — the main one plus every
// linked worktree, wherever it lives (the sessions' `.claude/worktrees/<slug>`
// among them). What git knows, read fresh; which SESSION is in which worktree
// is Vynel's own state (the session-worktrees slice), never inferred from here.

import type { GitWorktree } from '@vynel/contracts/workspaces/workspace-git'
import { defaultGitRunner, type GitRunner } from './run-git.js'

export async function listWorktrees(
  directory: string,
  runGit: GitRunner = defaultGitRunner,
): Promise<GitWorktree[]> {
  const output = await runGit(['worktree', 'list', '--porcelain'], directory)
  return parseWorktrees(output)
}

/** Exported for tests. Blocks are blank-line separated:
 *  `worktree <path>` / `HEAD <sha>` / `branch refs/heads/<name>` | `detached`. */
export function parseWorktrees(output: string): GitWorktree[] {
  const worktrees: GitWorktree[] = []
  for (const block of output.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((line) => line.trim())
    const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
    if (path === undefined || path === '') continue
    const branchRef = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length)
    worktrees.push({
      path,
      branch: branchRef === undefined ? null : branchRef.replace(/^refs\/heads\//, ''),
      isMain: worktrees.length === 0,
    })
  }
  return worktrees
}

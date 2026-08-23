// The local branches of a workspace's repository, current one marked. Only
// meaningful once `readGitFacts` said 'repository' — callers guard on that,
// so a failure here is git's own and propagates.

import type { GitBranch } from '@vynel/contracts/workspaces/workspace-git'
import { defaultGitRunner, type GitRunner } from './run-git.js'

// Tab-separated so a branch name can never be confused with its flags;
// `lstrip=2` (not `short`) so a tag of the same name cannot turn "main" into
// "heads/main".
const FORMAT = '%(refname:lstrip=2)%09%(HEAD)%09%(upstream:short)'

export async function listBranches(
  directory: string,
  runGit: GitRunner = defaultGitRunner,
): Promise<GitBranch[]> {
  const output = await runGit(['for-each-ref', `--format=${FORMAT}`, 'refs/heads/'], directory)
  return parseBranches(output)
}

/** Exported for tests. */
export function parseBranches(output: string): GitBranch[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name = '', head = '', upstream = ''] = line.split('\t')
      return { name, isCurrent: head.trim() === '*', upstream: upstream === '' ? null : upstream }
    })
}

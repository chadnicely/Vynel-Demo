// What Vynel knows about a workspace folder's git — the wire shape of
// `GET /workspaces/:id/git` and the `get_workspace_git_facts` tool. Every
// non-repository case is a normal answer, never an error: a workspace
// pulled in from a plain folder simply has no git yet.

export type GitRepositoryFacts = {
  kind: 'repository'
  /** null on a detached HEAD. */
  branch: string | null
  /** "origin/main" — null when the branch tracks nothing. */
  upstream: string | null
  /** Commits ahead of / behind the upstream — null without one. */
  ahead: number | null
  behind: number | null
  /** Tracked files with staged or unstaged changes (merge conflicts included). */
  changedCount: number
  untrackedCount: number
  /** The `origin` remote's address — null when there is none. */
  remoteUrl: string | null
}

export type GitFacts =
  | { kind: 'no-git' }
  | { kind: 'folder-missing' }
  | { kind: 'not-a-repository' }
  | { kind: 'unreadable'; reason: string }
  | GitRepositoryFacts

export type GitBranch = {
  name: string
  isCurrent: boolean
  upstream: string | null
}

export type GitWorktree = {
  path: string
  /** null when the worktree is on a detached HEAD. */
  branch: string | null
  /** The repository's own checkout — the first entry git lists. */
  isMain: boolean
}

export type WorkspaceGitResponse = {
  facts: GitFacts
  /** Empty unless `facts.kind` is 'repository'. */
  branches: GitBranch[]
  worktrees: GitWorktree[]
}

// Creating a GitHub repository for a workspace folder — the wire shape of
// `POST /workspaces/:id/github/repository`. The outcome is reported, never
// thrown: a repository that could not be created leaves the workspace fine.

export type RepositoryVisibility = 'private' | 'public'

export type CreateGitHubRepositoryRequest = {
  /** The repository name on GitHub — letters, digits, `.`, `_`, `-`. */
  name: string
  visibility: RepositoryVisibility
}

export type GitHubRepositoryOutcome =
  | { kind: 'created'; url: string | null }
  /** `reason` is gh's own last meaningful line, or the pre-flight that failed. */
  | { kind: 'failed'; reason: string }

export type CreateGitHubRepositoryResponse = {
  outcome: GitHubRepositoryOutcome
}

export const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/
export const REPOSITORY_NAME_RULE =
  'A repository name uses letters, digits, dots, dashes and underscores (up to 100), and cannot start with a dash.'

// `@vynel/github` — Vynel's one GitHub seam, entirely over the GitHub CLI
// (`gh`): the sign-in state, the in-app device-flow sign-in, the sign-out.
// No token handling and no API client of our own — `gh` keeps the credential
// and the sessions drive repositories, PRs and the rest of the API with
// `git`/`gh` on Bash (docs/module-notes/github-connection.md).

export { GitHubConnection, type GitHubConnectionDeps } from './github-connection.js'
export {
  readGitHubAuthStatus,
  parseGitHubAuthStatus,
  GH_NOT_INSTALLED_REASON,
  type GitHubAuthStatus,
  type CommandRunner,
} from './auth/github-auth-status.js'
export {
  GitHubSignInRelay,
  type GitHubSignInPhase,
  type GitHubSignInState,
  type GitHubSignInProcess,
} from './auth/github-sign-in-relay.js'
export { signGitHubOut } from './auth/sign-github-out.js'
export {
  createGitHubRepository,
  type CreateGitHubRepositoryInput,
} from './repository/create-github-repository.js'

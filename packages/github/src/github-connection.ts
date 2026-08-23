// The app's ONE GitHub connection — global, like the Claude account (Kafi,
// 2026-08-23: never per workspace). Composes the status read, the sign-in
// relay and the sign-out over `gh`; stateful only because the relay is
// (the sign-in process lives across HTTP round-trips). Constructed once at
// `createApp` — the real CLI in production, a fake in route tests (the
// `aiProvider` precedent).

import {
  defaultCommandRunner,
  readGitHubAuthStatus,
  type CommandRunner,
  type GitHubAuthStatus,
} from './auth/github-auth-status.js'
import {
  GitHubSignInRelay,
  type GitHubSignInRelayDeps,
  type GitHubSignInState,
} from './auth/github-sign-in-relay.js'
import { signGitHubOut } from './auth/sign-github-out.js'

export interface GitHubConnectionDeps extends GitHubSignInRelayDeps {
  runCommand?: CommandRunner
}

export class GitHubConnection {
  private readonly runCommand: CommandRunner
  private readonly relay: GitHubSignInRelay

  constructor(deps: GitHubConnectionDeps = {}) {
    this.runCommand = deps.runCommand ?? defaultCommandRunner
    this.relay = new GitHubSignInRelay(deps)
  }

  readStatus(): Promise<GitHubAuthStatus> {
    return readGitHubAuthStatus(this.runCommand)
  }

  beginSignIn(): Promise<GitHubSignInState> {
    return this.relay.begin()
  }

  getSignIn(loginId: string): GitHubSignInState {
    return this.relay.get(loginId)
  }

  cancelSignIn(loginId: string): void {
    this.relay.discard(loginId)
  }

  /** Signing out while already signed out (or with no CLI) is a no-op. */
  async signOut(): Promise<void> {
    const status = await this.readStatus()
    if (!status.isAuthenticated || status.accountLabel === null) return
    await signGitHubOut(status.accountLabel, this.runCommand)
  }
}

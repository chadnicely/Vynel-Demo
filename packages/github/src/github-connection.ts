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
import {
  createGitHubRepository,
  type CreateGitHubRepositoryInput,
} from './repository/create-github-repository.js'
import type { GitHubRepositoryOutcome } from '@vynel/contracts/github/github-repository'

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

  /** Make the repository + first push for a workspace folder. Not being signed
   *  in is a reported outcome, like every other way this can fail. */
  async createRepository(input: CreateGitHubRepositoryInput): Promise<GitHubRepositoryOutcome> {
    const status = await this.readStatus()
    if (!status.isAuthenticated) {
      return {
        kind: 'failed',
        reason: status.isInstalled
          ? 'Sign in to GitHub first (Settings → GitHub).'
          : (status.inactiveReason ?? 'The GitHub CLI is not available.'),
      }
    }
    return createGitHubRepository(input, this.runCommand)
  }

  /** Signing out while already signed out (or with no CLI) is a no-op. */
  async signOut(): Promise<void> {
    const status = await this.readStatus()
    if (!status.isAuthenticated || status.accountLabel === null) return
    await signGitHubOut(status.accountLabel, this.runCommand)
  }
}

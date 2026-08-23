// Signing the REMOTE engine in to Claude (Phase D4b). `claude auth login`
// prints an authorization URL and then blocks on stdin for the code the user
// gets from their browser, so the flow spans several HTTP round-trips and the
// PTY channel has to stay alive between them — hence a stateful registry
// (the AppProcessSupervisor precedent: classes only for real state).
//
// VYNEL NEVER SEES OR STORES THE CREDENTIAL. The CLI on the server writes its
// own `~/.claude` file; we relay the URL out and the pasted code in. That
// keeps decision D14 intact (Vynel detects auth, never holds it) and hands us
// the CLI's own format + token refresh for free.

import { ConflictError, NotFoundError, ValidationError } from '@vynel/errors'
import type { InteractiveSession, ServerConnection } from '../connecting/server-connection.js'
import type { StructuralLogger } from '../server-install-types.js'

/** The command that signs a machine in against the user's subscription. */
export const CLAUDE_LOGIN_COMMAND = 'claude auth login'
export const CLAUDE_STATUS_COMMAND = 'claude auth status'

// Abandoned sessions must not hold an SSH channel (or a half-finished login)
// forever — a user who closes the dialog just walks away.
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000

// The CLI paints its link as an OSC-8 terminal hyperlink (ESC ] 8 ; ; url
// BEL text ESC ] 8 ; ; BEL) — the href and the visible text sit back to
// back, separated only by control characters. Excluding those stops the
// match at the href instead of gluing both copies into one broken URL.
// eslint-disable-next-line no-control-regex -- stopping at terminal control characters is the point
const URL_PATTERN = /(https?:\/\/[^\s"'<>\x00-\x1f\x7f]+)/

export type ClaudeAuthPhase = 'awaiting-authorization' | 'finishing' | 'signed-in' | 'failed'

export interface ClaudeAuthState {
  phase: ClaudeAuthPhase
  /** The URL the user opens in their browser; null until the CLI prints it. */
  authorizationUrl: string | null
  /** Actionable when phase is 'failed'. */
  errorMessage: string | null
}

interface TrackedSession {
  connection: ServerConnection
  session: InteractiveSession
  state: ClaudeAuthState
  idleTimer: NodeJS.Timeout
}

export interface ClaudeAuthRelayDeps {
  /** How the relay reaches the server — the provisioning connection opener. */
  openConnection: () => Promise<ServerConnection>
  logger?: StructuralLogger
}

export class ClaudeAuthRelay {
  private readonly sessions = new Map<string, TrackedSession>()

  /** Begin (or restart) the sign-in for one install; resolves once the CLI has
   *  printed its authorization URL, so the caller can show it immediately. */
  async begin(installId: string, deps: ClaudeAuthRelayDeps): Promise<ClaudeAuthState> {
    this.discard(installId)
    const connection = await deps.openConnection()
    let session: InteractiveSession
    try {
      session = await connection.execInteractive(CLAUDE_LOGIN_COMMAND)
    } catch (error) {
      connection.close()
      throw error
    }

    const tracked: TrackedSession = {
      connection,
      session,
      state: { phase: 'awaiting-authorization', authorizationUrl: null, errorMessage: null },
      idleTimer: this.armIdleTimer(installId),
    }
    this.sessions.set(installId, tracked)

    // The CLI exiting on its own before a code arrives means it refused (no
    // subscription, already signed in, not installed) — surface its words.
    void session.finished.then((exitCode) => {
      const current = this.sessions.get(installId)
      if (current !== tracked) return
      if (current.state.phase === 'finishing' && exitCode === 0) {
        current.state.phase = 'signed-in'
        return
      }
      if (current.state.phase !== 'signed-in') {
        current.state.phase = 'failed'
        current.state.errorMessage = summarize(session.output(), exitCode)
      }
    })

    const url = await this.waitForUrl(session)
    if (url === null) {
      const exitCode = await Promise.race([session.finished, Promise.resolve<number | null>(null)])
      this.discard(installId)
      throw new ConflictError(
        `The server did not offer a sign-in link. ${summarize(session.output(), exitCode)}`,
      )
    }
    tracked.state.authorizationUrl = url
    deps.logger?.info({ installId }, 'claude auth: authorization url ready')
    return { ...tracked.state }
  }

  /** Hand the CLI the code the user copied from their browser. */
  submitCode(installId: string, code: string): ClaudeAuthState {
    const trimmed = code.trim()
    if (trimmed.length === 0) throw new ValidationError('Paste the code from your browser first.')
    const tracked = this.require(installId)
    tracked.session.writeLine(trimmed)
    tracked.state.phase = 'finishing'
    this.rearmIdleTimer(installId, tracked)
    return { ...tracked.state }
  }

  /** Where the flow stands (the UI polls this after submitting the code). */
  read(installId: string): ClaudeAuthState {
    return { ...this.require(installId).state }
  }

  /** Drop a session and its SSH channel — done, abandoned, or superseded. */
  discard(installId: string): void {
    const tracked = this.sessions.get(installId)
    if (tracked === undefined) return
    clearTimeout(tracked.idleTimer)
    tracked.session.close()
    tracked.connection.close()
    this.sessions.delete(installId)
  }

  /** Shutdown: never leave an SSH channel behind. */
  discardAll(): void {
    for (const installId of [...this.sessions.keys()]) this.discard(installId)
  }

  private require(installId: string): TrackedSession {
    const tracked = this.sessions.get(installId)
    if (tracked === undefined) throw new NotFoundError('claude-auth-session', installId)
    return tracked
  }

  private armIdleTimer(installId: string): NodeJS.Timeout {
    return setTimeout(() => this.discard(installId), SESSION_IDLE_TIMEOUT_MS).unref()
  }

  private rearmIdleTimer(installId: string, tracked: TrackedSession): void {
    clearTimeout(tracked.idleTimer)
    tracked.idleTimer = this.armIdleTimer(installId)
  }

  // The CLI paints its URL a moment after start; poll its accumulated output
  // rather than racing one 'data' event (the URL may arrive split).
  private async waitForUrl(session: InteractiveSession): Promise<string | null> {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const match = URL_PATTERN.exec(session.output())
      if (match?.[1] !== undefined) return match[1]
      const exited = await Promise.race([
        session.finished.then(() => true),
        new Promise<false>((resolveTick) => setTimeout(() => resolveTick(false), 250)),
      ])
      if (exited) return URL_PATTERN.exec(session.output())?.[1] ?? null
    }
    return null
  }
}

function summarize(output: string, exitCode: number | null): string {
  const tail = output.trim().split('\n').slice(-3).join(' ').trim().slice(-300)
  if (tail.length > 0) return tail
  return exitCode === null
    ? 'The connection dropped before it finished.'
    : `The sign-in command exited with code ${exitCode}.`
}

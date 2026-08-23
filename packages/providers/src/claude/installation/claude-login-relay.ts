// Signing THIS machine in to Claude — the local twin of server-install's
// `ClaudeAuthRelay`, over the SDK's BUNDLED `claude` binary (the engine the
// sessions run on; no host install needed). `claude auth login --claudeai`
// opens the user's default browser itself, listens on a localhost callback,
// and exits 0 once the browser's redirect lands — no code to paste (probed
// live on 2.1.235: `redirect_uri=http://localhost:<port>/callback`). It ALSO
// prints a fallback link — the manual variant that shows a code to paste —
// for a browser that didn't open, or a private window holding a different
// account. The flow spans several HTTP round-trips (begin, then reads until
// the verdict) and the child has to stay alive between them — hence a
// stateful registry (classes only for real state, the AppProcessSupervisor
// precedent; the GitHubSignInRelay shape).
//
// VYNEL NEVER SEES OR STORES THE CREDENTIAL. The CLI writes its own
// `~/.claude` file; we relay the fallback link out and a pasted code in
// (decision D14). Spawned directly — it is a real executable, not the
// `.cmd` shim a host install puts on PATH — with pipes, never a console.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { ConflictError, NotFoundError, ValidationError } from '@vynel/errors'
import { resolveBundledClaudeBinary } from './claude-plugin-cli.js'

// An abandoned dialog must not hold a half-finished login forever; every
// read re-arms it, so a user slow in the browser is never cut off while the
// dialog is still asking.
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000
const LOGIN_URL_TIMEOUT_MS = 30_000

// The CLI paints its link as an OSC-8 terminal hyperlink (ESC ] 8 ; ; url
// BEL text ESC ] 8 ; ; BEL) — the href and the visible text sit back to
// back, separated only by control characters. Excluding those stops the
// match at the href instead of gluing both copies into one broken URL; the
// lookahead insists on that terminator, so a URL cut at a pipe-chunk
// boundary is not taken for the whole.
// eslint-disable-next-line no-control-regex -- stopping at terminal control characters is the point
const URL_PATTERN = /(https?:\/\/[^\s"'<>\x00-\x1f\x7f]+)(?=[\s"'<>\x00-\x1f\x7f])/
const OSC8_LINK_OPENER = '\u001b]8;;'
// eslint-disable-next-line no-control-regex -- terminal escapes are control characters by definition
const TERMINAL_ESCAPE_PATTERN = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]/g

export type ClaudeLoginPhase = 'awaiting-browser' | 'finishing' | 'signed-in' | 'failed'

export interface ClaudeLoginState {
  loginId: string
  phase: ClaudeLoginPhase
  /** The fallback link (opens the code-to-paste variant of the sign-in);
   *  null until the CLI prints it. The browser itself was opened by the CLI. */
  authorizationUrl: string | null
  /** Actionable when phase is 'failed'. */
  errorMessage: string | null
}

/** The child the relay drives — structural, so tests feed a scripted fake. */
export interface ClaudeLoginProcess {
  output(): string
  writeLine(line: string): void
  kill(): void
  finished: Promise<number | null>
}

export interface ClaudeLoginRelayDeps {
  spawnLoginProcess?: () => ClaudeLoginProcess
}

function spawnClaudeLoginProcess(): ClaudeLoginProcess {
  const child = spawn(resolveBundledClaudeBinary(), ['auth', 'login', '--claudeai'], {
    windowsHide: true,
  })
  let output = ''
  child.stdout?.on('data', (chunk: Buffer | string) => {
    output += String(chunk)
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    output += String(chunk)
  })
  // A write racing the child's own exit lands as an async EPIPE on stdin —
  // unlistened, that's an uncaught exception that kills the whole process.
  // The relay's failed-phase guard makes this unreachable in practice; the
  // listener is the belt-and-braces.
  child.stdin?.on('error', () => {})
  const finished = new Promise<number | null>((resolve) => {
    // A spawn failure (EACCES, a binary that won't start) has no exit code;
    // its reason is the only thing worth showing.
    child.on('error', (error) => {
      output += `\n${error.message}\n`
      resolve(null)
    })
    child.on('close', (code) => resolve(code))
  })
  return {
    output: () => output,
    writeLine: (line) => {
      child.stdin?.write(`${line}\n`)
    },
    kill: () => {
      child.kill()
    },
    finished,
  }
}

interface TrackedLogin {
  process: ClaudeLoginProcess
  state: ClaudeLoginState
  idleTimer: NodeJS.Timeout
}

export class ClaudeLoginRelay {
  private readonly sessions = new Map<string, TrackedLogin>()

  /** Begin the sign-in: the CLI opens the browser; this resolves once it has
   *  printed its fallback link, so the caller can show it immediately. One
   *  login at a time — a new begin discards any pending one (the dialog was
   *  reopened). */
  async begin(deps: ClaudeLoginRelayDeps = {}): Promise<ClaudeLoginState> {
    this.discardAll()
    const loginId = randomUUID()
    const loginProcess = (deps.spawnLoginProcess ?? spawnClaudeLoginProcess)()

    const tracked: TrackedLogin = {
      process: loginProcess,
      state: { loginId, phase: 'awaiting-browser', authorizationUrl: null, errorMessage: null },
      idleTimer: this.armIdleTimer(loginId),
    }
    this.sessions.set(loginId, tracked)

    // The CLI's exit IS the verdict: 0 means it wrote its credential — after
    // the browser's callback landed or a pasted code was accepted; anything
    // else is a refusal (no subscription, the code rejected, its own auth
    // timeout) — surface its words.
    void loginProcess.finished.then((exitCode) => {
      const current = this.sessions.get(loginId)
      if (current !== tracked) return
      if (exitCode === 0) {
        current.state.phase = 'signed-in'
        return
      }
      current.state.phase = 'failed'
      current.state.errorMessage = summarize(loginProcess.output(), exitCode)
    })

    const url = await this.waitForUrl(loginProcess)
    if (url === null) {
      // Exit 0 with no link printed is still the CLI saying "done".
      if (tracked.state.phase === 'signed-in') return { ...tracked.state }
      const failure = tracked.state.errorMessage ?? summarize(loginProcess.output(), null)
      this.discard(loginId)
      throw new ConflictError(
        `Claude did not offer a sign-in link. ${failure || 'Is the Claude engine intact?'}`,
      )
    }
    tracked.state.authorizationUrl = url
    return { ...tracked.state }
  }

  /** The fallback: hand the CLI the code the user copied from the browser. */
  submitCode(loginId: string, code: string): ClaudeLoginState {
    const trimmed = code.trim()
    if (trimmed.length === 0) throw new ValidationError('Paste the code from your browser first.')
    const tracked = this.require(loginId)
    // The CLI can exit on its own between the link round-trip and the code
    // arriving (its own auth timeout, a crash). Writing to that dead child
    // would EPIPE, and re-stamping 'finishing' could never settle again —
    // surface the CLI's parting words instead.
    if (tracked.state.phase === 'failed') {
      const failure = tracked.state.errorMessage
      this.discard(loginId)
      throw new ConflictError(failure ?? 'The sign-in ended before the code arrived. Start again.')
    }
    // The browser's callback may already have landed — a late paste must
    // not regress a signed-in session to 'finishing'.
    if (tracked.state.phase === 'signed-in') return { ...tracked.state }
    tracked.process.writeLine(trimmed)
    tracked.state.phase = 'finishing'
    this.rearmIdleTimer(loginId, tracked)
    return { ...tracked.state }
  }

  /** Where the flow stands right now — the poll. Each read is a heartbeat
   *  from a dialog still asking, so it re-arms the idle timer. */
  read(loginId: string): ClaudeLoginState {
    const tracked = this.require(loginId)
    this.rearmIdleTimer(loginId, tracked)
    return { ...tracked.state }
  }

  /** Drop a session and its child — done, abandoned, or superseded. */
  discard(loginId: string): void {
    const tracked = this.sessions.get(loginId)
    if (tracked === undefined) return
    clearTimeout(tracked.idleTimer)
    tracked.process.kill()
    this.sessions.delete(loginId)
  }

  /** Shutdown: never leave a child process behind. */
  discardAll(): void {
    for (const loginId of [...this.sessions.keys()]) this.discard(loginId)
  }

  private require(loginId: string): TrackedLogin {
    const tracked = this.sessions.get(loginId)
    if (tracked === undefined) throw new NotFoundError('claude-login-session', loginId)
    return tracked
  }

  private armIdleTimer(loginId: string): NodeJS.Timeout {
    return setTimeout(() => this.discard(loginId), SESSION_IDLE_TIMEOUT_MS).unref()
  }

  private rearmIdleTimer(loginId: string, tracked: TrackedLogin): void {
    clearTimeout(tracked.idleTimer)
    tracked.idleTimer = this.armIdleTimer(loginId)
  }

  // The CLI paints its link a moment after start; poll its accumulated output
  // rather than racing one 'data' event (the URL may arrive split).
  private async waitForUrl(loginProcess: ClaudeLoginProcess): Promise<string | null> {
    const deadline = Date.now() + LOGIN_URL_TIMEOUT_MS
    while (Date.now() < deadline) {
      const match = URL_PATTERN.exec(loginProcess.output())
      if (match?.[1] !== undefined) return match[1]
      const exited = await Promise.race([
        loginProcess.finished.then(() => true),
        new Promise<false>((resolveTick) => setTimeout(() => resolveTick(false), 250)),
      ])
      if (exited) return URL_PATTERN.exec(`${loginProcess.output()}\n`)?.[1] ?? null
    }
    return null
  }
}

// The CLI's parting words, minus its terminal paint and the fallback-link
// line (a 400-character URL is noise next to "Invalid code"). Only the
// painted link line goes — a refusal that happens to cite a URL stays.
function summarize(output: string, exitCode: number | null): string {
  const tail = output
    .split(/\r?\n|\r/)
    .filter((line) => !line.includes(OSC8_LINK_OPENER))
    .map((line) => line.replace(TERMINAL_ESCAPE_PATTERN, '').trim())
    .filter((line) => line.length > 0)
    .slice(-3)
    .join(' ')
    .slice(-300)
  if (tail.length > 0) return tail
  return exitCode === null ? '' : `The sign-in command exited with code ${exitCode}.`
}

// Signing THIS machine in to Claude — the local twin of server-install's
// `ClaudeAuthRelay`. `claude auth login --claudeai` prints an authorization
// URL and then blocks on stdin for the code the user gets from their browser,
// so the flow spans several HTTP round-trips and the child process has to
// stay alive between them — hence a stateful registry (classes only for real
// state, the AppProcessSupervisor precedent).
//
// VYNEL NEVER SEES OR STORES THE CREDENTIAL. The CLI writes its own
// `~/.claude` file; we relay the URL out and the pasted code in (decision
// D14). Spawned through a shell because the CLI is a `.cmd` shim on Windows
// (a bare spawn fails with EINVAL) — with pipes, never a console window.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { ConflictError, NotFoundError, ValidationError } from '@vynel/errors'
import { resolveClaudeCodeExecutablePath } from './resolve-claude-code-executable-path.js'

// An abandoned dialog must not hold a half-finished login forever.
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000
const LOGIN_URL_TIMEOUT_MS = 30_000

const URL_PATTERN = /(https?:\/\/[^\s"'<>]+)/

export type ClaudeLoginPhase = 'awaiting-code' | 'finishing' | 'signed-in' | 'failed'

export interface ClaudeLoginState {
  loginId: string
  phase: ClaudeLoginPhase
  /** The URL the user opens in their browser; null until the CLI prints it. */
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
  const executable = resolveClaudeCodeExecutablePath()
  const child = spawn(`"${executable}" auth login --claudeai`, {
    shell: true,
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
    child.on('error', () => resolve(null))
    child.on('close', (code) => resolve(code))
  })
  return {
    output: () => output,
    writeLine: (line) => {
      child.stdin?.write(`${line}\n`)
    },
    kill: () => {
      // `shell: true` puts a cmd.exe shim between us and the CLI on Windows —
      // killing only the shim orphans the real child blocked on stdin, so an
      // abandoned login would linger as a zombie. taskkill fells the tree.
      if (process.platform === 'win32' && child.pid !== undefined) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on(
          'error',
          () => child.kill(),
        )
        return
      }
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

  /** Begin the sign-in; resolves once the CLI has printed its authorization
   *  URL, so the caller can show it immediately. One login at a time — a new
   *  begin discards any pending one (the dialog was reopened). */
  async begin(deps: ClaudeLoginRelayDeps = {}): Promise<ClaudeLoginState> {
    this.discardAll()
    const loginId = randomUUID()
    const loginProcess = (deps.spawnLoginProcess ?? spawnClaudeLoginProcess)()

    const tracked: TrackedLogin = {
      process: loginProcess,
      state: { loginId, phase: 'awaiting-code', authorizationUrl: null, errorMessage: null },
      idleTimer: this.armIdleTimer(loginId),
    }
    this.sessions.set(loginId, tracked)

    // The CLI exiting on its own before a code arrives means it refused
    // (already signed in, no browser, not installed) — surface its words.
    void loginProcess.finished.then((exitCode) => {
      const current = this.sessions.get(loginId)
      if (current !== tracked) return
      if (current.state.phase === 'finishing' && exitCode === 0) {
        current.state.phase = 'signed-in'
        return
      }
      if (current.state.phase !== 'signed-in') {
        current.state.phase = 'failed'
        current.state.errorMessage = summarize(loginProcess.output(), exitCode)
      }
    })

    const url = await this.waitForUrl(loginProcess)
    if (url === null) {
      const failure = summarize(loginProcess.output(), null)
      this.discard(loginId)
      throw new ConflictError(
        `Claude did not offer a sign-in link. ${failure || 'Is the Claude CLI installed?'}`,
      )
    }
    tracked.state.authorizationUrl = url
    return { ...tracked.state }
  }

  /** Hand the CLI the code the user copied from their browser. */
  submitCode(loginId: string, code: string): ClaudeLoginState {
    const trimmed = code.trim()
    if (trimmed.length === 0) throw new ValidationError('Paste the code from your browser first.')
    const tracked = this.require(loginId)
    // The CLI can exit on its own between the URL round-trip and the code
    // arriving (its own auth timeout, a crash). Writing to that dead child
    // would EPIPE, and re-stamping 'finishing' could never settle again —
    // surface the CLI's parting words instead.
    if (tracked.state.phase === 'failed') {
      const failure = tracked.state.errorMessage
      this.discard(loginId)
      throw new ConflictError(failure ?? 'The sign-in ended before the code arrived. Start again.')
    }
    tracked.process.writeLine(trimmed)
    tracked.state.phase = 'finishing'
    this.rearmIdleTimer(loginId, tracked)
    return { ...tracked.state }
  }

  /** Where the flow stands right now. */
  read(loginId: string): ClaudeLoginState {
    return { ...this.require(loginId).state }
  }

  /** Wait for a submitted code to settle — the CLI writes its credential and
   *  exits (signed-in) or refuses (failed); a timeout reports the pending
   *  state honestly instead of inventing an outcome. */
  async waitForOutcome(loginId: string, timeoutMs: number): Promise<ClaudeLoginState> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const state = this.read(loginId)
      if (state.phase === 'signed-in' || state.phase === 'failed') return state
      await new Promise((resolveTick) => setTimeout(resolveTick, 200))
    }
    return this.read(loginId)
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

  // The CLI paints its URL a moment after start; poll its accumulated output
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
      if (exited) return URL_PATTERN.exec(loginProcess.output())?.[1] ?? null
    }
    return null
  }
}

function summarize(output: string, exitCode: number | null): string {
  const tail = output.trim().split('\n').slice(-3).join(' ').trim().slice(-300)
  if (tail.length > 0) return tail
  return exitCode === null ? '' : `The sign-in command exited with code ${exitCode}.`
}

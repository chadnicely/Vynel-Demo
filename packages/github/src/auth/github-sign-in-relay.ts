// Signing THIS machine in to GitHub — the twin of the Claude login relay.
// `gh auth login --web` on a non-TTY spawn prints a one-time code and the
// device URL, opens the browser if it can, and then polls GitHub until the
// person approves; the process has to stay alive across several HTTP
// round-trips, hence a stateful registry (classes only for real state).
//
// VYNEL NEVER SEES OR STORES THE CREDENTIAL: `gh` writes it into the OS
// credential store itself. We relay the code + URL out and observe the exit.
// stdin is ignored so the CLI can never block on a prompt we cannot answer.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { NotFoundError } from '@vynel/errors'
import { GH_NOT_INSTALLED_REASON } from './github-auth-status.js'

// An abandoned dialog must not hold a half-finished sign-in forever; GitHub's
// own device code expires in 15 minutes.
const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000
const CODE_TIMEOUT_MS = 30_000
const CODE_POLL_MS = 100

const ONE_TIME_CODE = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i
const DEVICE_URL = /(https:\/\/github\.com\/login\/device\S*)/

export type GitHubSignInPhase = 'awaiting-browser' | 'signed-in' | 'failed'

export interface GitHubSignInState {
  loginId: string
  phase: GitHubSignInPhase
  /** The code the person types at the device URL — "ABCD-1234". */
  userCode: string | null
  verificationUrl: string | null
  /** Actionable when phase is 'failed'. */
  errorMessage: string | null
}

/** The child the relay drives — structural, so tests feed a scripted fake. */
export interface GitHubSignInProcess {
  output(): string
  kill(): void
  finished: Promise<number | null>
}

export interface GitHubSignInRelayDeps {
  spawnSignInProcess?: () => GitHubSignInProcess
}

const SIGN_IN_ARGS = [
  'auth',
  'login',
  '--web',
  '--hostname',
  'github.com',
  '--git-protocol',
  'https',
  '--scopes',
  'repo,read:org,workflow',
]

function spawnGitHubSignInProcess(): GitHubSignInProcess {
  // `gh` is a real executable (gh.exe on Windows) — no shell shim needed.
  const child = spawn('gh', SIGN_IN_ARGS, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  child.stdout?.on('data', (chunk: Buffer | string) => {
    output += String(chunk)
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    output += String(chunk)
  })
  const finished = new Promise<number | null>((resolve) => {
    child.on('error', (error: NodeJS.ErrnoException) => {
      output += `\n${error.code === 'ENOENT' ? GH_NOT_INSTALLED_REASON : error.message}\n`
      resolve(null)
    })
    child.on('close', (code) => resolve(code))
  })
  return {
    output: () => output,
    kill: () => {
      child.kill()
    },
    finished,
  }
}

type Entry = {
  state: GitHubSignInState
  process: GitHubSignInProcess
  idleTimer: NodeJS.Timeout
}

export class GitHubSignInRelay {
  private readonly entries = new Map<string, Entry>()
  private readonly spawnSignInProcess: () => GitHubSignInProcess

  constructor(deps: GitHubSignInRelayDeps = {}) {
    this.spawnSignInProcess = deps.spawnSignInProcess ?? spawnGitHubSignInProcess
  }

  /** Spawn the sign-in and resolve once the code + URL are on screen (or the
   *  CLI gave up first) — the caller shows them; the browser does the rest. */
  async begin(): Promise<GitHubSignInState> {
    // One sign-in at a time — a second press must not leave the first gh
    // polling GitHub in the background until its code expires.
    for (const [id, entry] of this.entries) {
      if (entry.state.phase === 'awaiting-browser') this.discard(id)
    }
    const loginId = randomUUID()
    const child = this.spawnSignInProcess()
    const state: GitHubSignInState = {
      loginId,
      phase: 'awaiting-browser',
      userCode: null,
      verificationUrl: null,
      errorMessage: null,
    }
    const entry: Entry = {
      state,
      process: child,
      idleTimer: setTimeout(() => this.discard(loginId), SESSION_IDLE_TIMEOUT_MS),
    }
    // A forgotten dialog must never keep the process alive on its own.
    entry.idleTimer.unref()
    this.entries.set(loginId, entry)

    let settled = false
    void child.finished.then((code) => {
      settled = true
      this.settle(entry, code)
    })

    const deadline = Date.now() + CODE_TIMEOUT_MS
    while (!settled && Date.now() < deadline) {
      const output = child.output()
      const code = ONE_TIME_CODE.exec(output)?.[1] ?? null
      if (code !== null) {
        state.userCode = code
        state.verificationUrl = DEVICE_URL.exec(output)?.[1] ?? 'https://github.com/login/device'
        return { ...state }
      }
      await new Promise((resolve) => setTimeout(resolve, CODE_POLL_MS))
    }
    if (!settled) {
      this.fail(entry, 'The GitHub CLI did not offer a sign-in code in time. Try again, or run `gh auth login` in a terminal.')
      child.kill()
    }
    return { ...state }
  }

  get(loginId: string): GitHubSignInState {
    const entry = this.entries.get(loginId)
    if (entry === undefined) throw new NotFoundError('github sign-in', loginId)
    return { ...entry.state }
  }

  discard(loginId: string): void {
    const entry = this.entries.get(loginId)
    if (entry === undefined) return
    clearTimeout(entry.idleTimer)
    if (entry.state.phase === 'awaiting-browser') entry.process.kill()
    this.entries.delete(loginId)
  }

  private settle(entry: Entry, code: number | null): void {
    if (entry.state.phase !== 'awaiting-browser') return
    if (code === 0) {
      entry.state.phase = 'signed-in'
      return
    }
    this.fail(entry, lastMeaningfulLine(entry.process.output()))
  }

  private fail(entry: Entry, message: string): void {
    entry.state.phase = 'failed'
    entry.state.errorMessage = message
  }
}

// gh's failure is usually one line among progress noise — keep the last one
// that says something, never the whole transcript.
function lastMeaningfulLine(output: string): string {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('!') && !/one-time code/i.test(line))
  return lines.at(-1) ?? 'The sign-in did not complete.'
}

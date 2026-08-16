// `AppProcessSupervisor` — the in-memory manager of running workspace apps.
// ONE per api process (DI'd like the ask waiter registry); a genuinely
// stateful service, hence a class. State does NOT survive a restart —
// `stopAll()` runs at shutdown so quitting Vynel never orphans dev servers,
// and there is deliberately no DB "running" column to go stale.
//
// SECURITY SHAPE (docs/module-notes/apps.md): the command runs `shell: true`
// — it is the user's/Claude's own dev command in their own workspace, the
// same trust domain as the agent's existing shell access there. What IS
// guarded is the working directory: `resolveContainedCwd` refuses any
// `cwdRelative` that escapes the workspace path (`..`, absolute paths,
// drive-letter tricks — resolved-path prefix check, not string games).

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { resolve, sep } from 'node:path'
import type { AppRunSnapshot, AppRunStatus, StructuralLogger } from '../apps-types.js'

const RING_BUFFER_MAX_LINES = 2000

// Grace between the polite kill and the forceful one on POSIX.
const SIGKILL_GRACE_MS = 3_000

export interface StartAppProcessInput {
  appId: string
  name: string
  command: string
  workspacePath: string
  cwdRelative: string
}

interface SupervisedApp {
  appId: string
  status: AppRunStatus
  child: ChildProcess | null
  pid: number | null
  startedAt: Date
  exitCode: number | null
  // We asked it to die — its exit is 'exited', never 'crashed'.
  stopRequested: boolean
  logLines: string[]
}

/** Resolve `cwdRelative` under the workspace path, refusing escapes. Exported
 *  for the ops-level validation to share (one home for the containment rule). */
export function resolveContainedCwd(workspacePath: string, cwdRelative: string): string | null {
  const base = resolve(workspacePath)
  const target = resolve(base, cwdRelative)
  if (target === base) return target
  return target.startsWith(base + sep) ? target : null
}

export class AppProcessSupervisor {
  private readonly appsByAppId = new Map<string, SupervisedApp>()

  constructor(
    private readonly deps: {
      logger?: StructuralLogger
      /** Fired when a running app exits on its own (never for a requested
       *  stop). The api edge binds this to publish `app.crashed`/`app.stopped`. */
      onExit?: (appId: string, outcome: { exitCode: number | null; crashed: boolean }) => void
    } = {},
  ) {}

  isRunning(appId: string): boolean {
    return this.appsByAppId.get(appId)?.status === 'running'
  }

  snapshotOf(appId: string): AppRunSnapshot | null {
    const entry = this.appsByAppId.get(appId)
    if (!entry) return null
    return {
      appId: entry.appId,
      status: entry.status,
      pid: entry.pid,
      startedAt: entry.startedAt,
      exitCode: entry.exitCode,
    }
  }

  logsOf(appId: string, tailLines = 200): string[] {
    const entry = this.appsByAppId.get(appId)
    if (!entry) return []
    return entry.logLines.slice(-Math.max(1, Math.min(tailLines, RING_BUFFER_MAX_LINES)))
  }

  /** Spawns the app. Throws on a second start of a running app or a cwd
   *  escaping the workspace — the ROUTE maps these to Conflict/Validation
   *  (the supervisor is DB-free and error-taxonomy-free by design). */
  start(input: StartAppProcessInput): AppRunSnapshot {
    const existing = this.appsByAppId.get(input.appId)
    if (existing?.status === 'running') {
      throw new Error(`app_already_running:${input.appId}`)
    }
    const cwd = resolveContainedCwd(input.workspacePath, input.cwdRelative)
    if (cwd === null) {
      throw new Error(`app_cwd_escapes_workspace:${input.appId}`)
    }

    const child = spawn(input.command, { cwd, shell: true })
    const entry: SupervisedApp = {
      appId: input.appId,
      status: 'running',
      child,
      pid: child.pid ?? null,
      startedAt: new Date(),
      exitCode: null,
      stopRequested: false,
      logLines: [],
    }
    this.appsByAppId.set(input.appId, entry)

    const append = (chunk: unknown): void => this.appendLogChunk(entry, String(chunk))
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    // Settle-once guard: a FAILED spawn (e.g. a registered folder that no
    // longer exists — containment is textual, never existence) emits 'error'
    // and NEVER 'exit'; only 'close' fires on both paths. Settling from
    // either event — first one wins — is what keeps a phantom app from
    // reading "running" forever and stop()/DELETE/shutdown from hanging on
    // an exit that will never come (reviewer must-fix, verified empirically).
    let settled = false
    const settle = (code: number | null): void => {
      if (settled) return
      settled = true
      entry.status = entry.stopRequested || code === 0 ? 'exited' : 'crashed'
      entry.exitCode = code
      entry.child = null
      this.appendLogChunk(entry, `[vynel] process exited (code ${code ?? 'unknown'})\n`)
      this.deps.logger?.info({ appId: entry.appId, code, status: entry.status }, 'app exited')
      if (!entry.stopRequested) {
        // A crashing dev app must never crash Vynel — the publish reaches a DB
        // handle from a child-process event callback (shutdown can race it).
        try {
          this.deps.onExit?.(entry.appId, { exitCode: code, crashed: entry.status === 'crashed' })
        } catch (err) {
          this.deps.logger?.error({ appId: entry.appId, err }, 'app onExit hook failed')
        }
      }
    }
    child.on('error', (err) => {
      this.appendLogChunk(entry, `[vynel] failed to start: ${err.message}\n`)
      settle(null)
    })
    child.on('close', (code) => settle(code))

    this.deps.logger?.info({ appId: input.appId, pid: entry.pid }, 'app started')
    return this.snapshotOf(input.appId)!
  }

  /** Requests a stop; resolves when the process has settled. Idempotent — a
   *  not-running app resolves immediately. */
  async stop(appId: string): Promise<void> {
    const entry = this.appsByAppId.get(appId)
    if (!entry || entry.status !== 'running' || entry.child === null) return
    entry.stopRequested = true

    const child = entry.child
    // 'close' fires on BOTH normal exit and spawn failure ('exit' does not) —
    // the same settlement signal `settle` keys on.
    const closed = new Promise<void>((resolveClosed) => {
      child.once('close', () => resolveClosed())
    })

    if (process.platform === 'win32' && child.pid !== undefined) {
      // Dev servers spawn children (esbuild, watchers) — kill the whole tree
      // or the port stays occupied by an orphan. taskkill reports failure via
      // the result (spawnSync never throws) — fall back to a direct kill so a
      // missing/failing taskkill can't leave stop() waiting.
      const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
      if (result.error !== undefined || result.status !== 0) {
        this.deps.logger?.warn(
          { appId, status: result.status },
          'taskkill failed; falling back to a direct kill',
        )
        child.kill('SIGKILL')
      }
    } else {
      child.kill('SIGTERM')
    }
    // Universal backstop (both platforms): if it still has not settled after
    // the grace, SIGKILL — stop() must never hang.
    const killTimer = setTimeout(() => {
      if (entry.status === 'running') child.kill('SIGKILL')
    }, SIGKILL_GRACE_MS)
    void closed.then(() => clearTimeout(killTimer))

    await closed
    this.deps.logger?.info({ appId }, 'app stopped')
  }

  /** Shutdown sweep — quitting Vynel never orphans a dev server. */
  async stopAll(): Promise<void> {
    const running = Array.from(this.appsByAppId.values()).filter((e) => e.status === 'running')
    await Promise.all(running.map((entry) => this.stop(entry.appId)))
  }

  private appendLogChunk(entry: SupervisedApp, chunk: string): void {
    for (const line of stripAnsi(chunk).split(/\r?\n/)) {
      if (line === '') continue
      entry.logLines.push(line)
    }
    if (entry.logLines.length > RING_BUFFER_MAX_LINES) {
      entry.logLines.splice(0, entry.logLines.length - RING_BUFFER_MAX_LINES)
    }
  }
}

// Terminal escape sequences stripped at CAPTURE (the processes runner's
// 2026-08-17 fix, swept here per the twin cross-reference rule):
// `get_app_logs` was serving raw ESC[36m color runs as garbage.
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;?]*[ -\/]*[@-~]|\u001b/g

function stripAnsi(chunk: string): string {
  return chunk.replace(ANSI_ESCAPE_PATTERN, '')
}

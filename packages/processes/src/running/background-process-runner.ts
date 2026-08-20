// `BackgroundProcessRunner` — the in-memory manager of live background
// commands. ONE per api process (DI'd like the app supervisor and the ask
// registry); a genuinely stateful service, hence a class. State does NOT
// survive a restart — the boot sweep settles rows a crash left `running`.
//
// MECHANICAL TWIN: `packages/apps/src/running/app-process-supervisor.ts`
// solved the same child-process hazards first (settle-once, Windows tree-kill,
// the SIGKILL grace) and its lessons are carried here verbatim — sibling
// leaves cannot import each other, and Kafi's call (2026-08-17) was package-
// per-feature over a shared process core. If you fix a process-mechanics bug
// in either file, sweep the other.
//
// SECURITY SHAPE (the supervisor's): the command runs `shell: true` — it is
// the agent's own command in its own ground, the same trust domain as its
// existing Bash access there; the tool cards like Bash does. What the RUNNER
// enforces is the deadline: every child gets a kill timer, because a
// background process nobody is waiting on is exactly the kind of wait the
// tool-hang audit banned unbounded.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { stripAnsi } from '@vynel/contracts/text/strip-ansi'
import type {
  ProcessExitOutcome,
  ProcessFailureReason,
  ProcessRunSnapshot,
  StructuralLogger,
} from '../processes-types.js'

const RING_BUFFER_MAX_LINES = 2000

// Grace between the polite kill and the forceful one on POSIX.
const SIGKILL_GRACE_MS = 3_000

/** How much tail the settle hands over — the persisted ceiling. The event
 *  payload trims further (`PROCESS_EVENT_TAIL_MAX_CHARS`). */
export const PROCESS_OUTPUT_TAIL_MAX_CHARS = 8_000

export interface StartBackgroundProcessRunInput {
  processId: string
  command: string
  cwdPath: string
  timeoutMs: number
}

interface RunningProcess {
  processId: string
  child: ChildProcess | null
  pid: number | null
  startedAt: Date
  // Someone asked it to die — carried into the settle as the failure reason.
  killReason: ProcessFailureReason | null
  killTimer: ReturnType<typeof setTimeout> | null
  logLines: string[]
}

export class BackgroundProcessRunner {
  private readonly processesById = new Map<string, RunningProcess>()

  constructor(
    private readonly deps: {
      logger?: StructuralLogger
      /** Fired exactly once per child, when it settles for ANY reason — the
       *  api edge binds this to `settleBackgroundProcess` (row + outbox). */
      onExit?: (processId: string, outcome: ProcessExitOutcome) => void
    } = {},
  ) {}

  isRunning(processId: string): boolean {
    return this.processesById.has(processId)
  }

  snapshotOf(processId: string): ProcessRunSnapshot | null {
    const entry = this.processesById.get(processId)
    if (!entry) return null
    return { processId: entry.processId, pid: entry.pid, startedAt: entry.startedAt }
  }

  /** The LIVE output tail — what `get_background_process` serves while the row
   *  still says `running`. Empty for a settled/unknown process (the row's
   *  persisted tail is the truth then). */
  tailOf(processId: string): string {
    const entry = this.processesById.get(processId)
    if (!entry) return ''
    return boundedTail(entry.logLines)
  }

  /** Spawns the command. Throws on a duplicate start — the ops layer mints a
   *  fresh id per run, so a collision is a programming error, not input. A
   *  FAILED spawn does not throw: it settles async through the same exit path
   *  ('error' fires, 'exit' never does — only 'close' is universal; the
   *  supervisor verified this empirically). */
  start(input: StartBackgroundProcessRunInput): ProcessRunSnapshot {
    if (this.processesById.has(input.processId)) {
      throw new Error(`background process already running: ${input.processId}`)
    }

    const child = spawn(input.command, { cwd: input.cwdPath, shell: true })
    const entry: RunningProcess = {
      processId: input.processId,
      child,
      pid: child.pid ?? null,
      startedAt: new Date(),
      killReason: null,
      killTimer: null,
      logLines: [],
    }
    this.processesById.set(input.processId, entry)

    const append = (chunk: unknown): void => this.appendLogChunk(entry, String(chunk))
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    // Settle-once guard (the supervisor's must-fix, carried): 'error' and
    // 'close' can both fire; the first one wins and the entry leaves the map
    // so nothing double-reports.
    let settled = false
    const settle = (code: number | null, spawnFailed: boolean): void => {
      if (settled) return
      settled = true
      if (entry.killTimer !== null) clearTimeout(entry.killTimer)
      this.processesById.delete(entry.processId)
      const failureReason: ProcessFailureReason | null = spawnFailed
        ? 'spawn-failed'
        : entry.killReason
      this.deps.logger?.info(
        { processId: entry.processId, code, failureReason },
        'background process settled',
      )
      // A settling child must never crash Vynel — the hook reaches a DB
      // handle from a child-process event callback (shutdown can race it).
      try {
        this.deps.onExit?.(entry.processId, {
          exitCode: code,
          ...(failureReason !== null ? { failureReason } : {}),
          outputTail: boundedTail(entry.logLines),
        })
      } catch (err) {
        this.deps.logger?.error({ processId: entry.processId, err }, 'process onExit hook failed')
      }
    }
    child.on('error', (err) => {
      this.appendLogChunk(entry, `[vynel] failed to start: ${err.message}\n`)
      settle(null, true)
    })
    child.on('close', (code) => settle(code, false))

    // The deadline — no background process outlives its ceiling.
    entry.killTimer = setTimeout(() => {
      this.kill(input.processId, 'timed-out')
    }, input.timeoutMs)

    this.deps.logger?.info(
      { processId: input.processId, pid: entry.pid, command: input.command.slice(0, 120) },
      'background process started',
    )
    return this.snapshotOf(input.processId)!
  }

  /** Requests death. Idempotent — an unknown/settled process is a no-op; the
   *  settle path reports the given reason. Fire-and-forget on purpose: the
   *  caller learns the outcome the same way every other observer does, from
   *  the settle. */
  kill(processId: string, reason: 'killed' | 'timed-out'): void {
    const entry = this.processesById.get(processId)
    if (!entry || entry.child === null) return
    if (entry.killReason === null) entry.killReason = reason

    const child = entry.child
    if (process.platform === 'win32' && child.pid !== undefined) {
      // Commands spawn children (pnpm → node → workers) — kill the whole tree
      // or the work keeps running headless. taskkill reports failure via the
      // result (spawnSync never throws) — fall back to a direct kill so a
      // missing/failing taskkill can't leave the child alive.
      const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
      if (result.error !== undefined || result.status !== 0) {
        this.deps.logger?.warn(
          { processId, status: result.status },
          'taskkill failed; falling back to a direct kill',
        )
        child.kill('SIGKILL')
      }
    } else {
      child.kill('SIGTERM')
    }
    // Universal backstop (BOTH platforms — the twin's shape, carried): if it
    // has not settled after the grace, SIGKILL. On win32 this covers the rare
    // taskkill-reports-success-but-the-child-survives shape, which would
    // otherwise leave the entry live and the row `running` until a restart.
    setTimeout(() => {
      if (this.processesById.has(processId)) child.kill('SIGKILL')
    }, SIGKILL_GRACE_MS)
  }

  /** Shutdown sweep — quitting Vynel never leaves headless children (Windows
   *  children do NOT die with their parent; taskkill runs SYNCHRONOUSLY, so
   *  the trees are dead before this returns). The settle callbacks are async
   *  and shutdown exits before they can run — the rows are settled by the
   *  NEXT boot's sweep (`restart`), which is also when their failure events
   *  fire. Honest, at the cost of one restart of latency on the wake. */
  killAll(): void {
    for (const processId of [...this.processesById.keys()]) {
      this.kill(processId, 'killed')
    }
  }

  // Stripped at CAPTURE (live smoke, 2026-08-17): the tail travels into outbox
  // payloads and monitor wake messages, where raw colour runs read as garbage.
  private appendLogChunk(entry: RunningProcess, chunk: string): void {
    for (const line of stripAnsi(chunk).split(/\r?\n/)) {
      if (line === '') continue
      entry.logLines.push(line)
    }
    if (entry.logLines.length > RING_BUFFER_MAX_LINES) {
      entry.logLines.splice(0, entry.logLines.length - RING_BUFFER_MAX_LINES)
    }
  }
}

function boundedTail(logLines: readonly string[]): string {
  const joined = logLines.join('\n')
  return joined.length > PROCESS_OUTPUT_TAIL_MAX_CHARS
    ? joined.slice(-PROCESS_OUTPUT_TAIL_MAX_CHARS)
    : joined
}

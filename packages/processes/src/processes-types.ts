// Domain-only types for the `processes` leaf.

// The subset of pino the core logs against (the monitors/plans/tasks
// StructuralLogger precedent — core never depends on the full pino type).
export interface StructuralLogger {
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

/** Why a process settled short of a clean exit. `exit` alone (with a non-zero
 *  code) is an ordinary failure; the rest name who ended it. */
export type ProcessFailureReason =
  | 'spawn-failed'
  | 'killed'
  | 'timed-out'
  | 'restart'

/** What the runner reports when a child settles — everything the settle op
 *  needs to finish the row and speak the outbox event. */
export interface ProcessExitOutcome {
  exitCode: number | null
  /** Absent = the process exited on its own (code decides success/failure). */
  failureReason?: ProcessFailureReason
  /** The bounded output tail at settle time. */
  outputTail: string
}

/** A live child as the runner sees it — the read `get_background_process`
 *  serves while the row still says `running`. */
export interface ProcessRunSnapshot {
  processId: string
  pid: number | null
  startedAt: Date
}

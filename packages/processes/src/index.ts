// Public surface of `@vynel/processes` — the background-process leaf (run a
// shell command past the turn that started it; the exit fires an outbox event
// the owner's monitor turns into a wake). Consumers reach the package only
// through this barrel; schema, repositories and the concern folders are
// internal.

export type {
  StructuralLogger,
  ProcessFailureReason,
  ProcessExitOutcome,
  ProcessRunSnapshot,
} from './processes-types.js'
export type {
  BackgroundProcess,
  BackgroundProcessStatus,
  BackgroundProcessOwnerKind,
} from './repositories/index.js'

export {
  PROCESS_STARTED,
  PROCESS_COMPLETED,
  PROCESS_FAILED,
  PROCESS_EVENT_TAIL_MAX_CHARS,
  type ProcessStartedPayload,
  type ProcessCompletedPayload,
  type ProcessFailedPayload,
} from './processes-events.js'

// The runner (one per api process, DI'd like the app supervisor).
export {
  BackgroundProcessRunner,
  PROCESS_OUTPUT_TAIL_MAX_CHARS,
  type StartBackgroundProcessRunInput,
} from './running/background-process-runner.js'

// Lifecycle ops (sync) + the reads.
export {
  startBackgroundProcess,
  type StartBackgroundProcessInput,
  PROCESS_COMMAND_MAX_LENGTH,
  PROCESS_DEFAULT_TIMEOUT_MS,
  PROCESS_MAX_TIMEOUT_MS,
  MAX_RUNNING_PROCESSES_PER_USER,
} from './lifecycle/start-background-process.js'
export {
  settleBackgroundProcess,
  type SettleBackgroundProcessInput,
} from './lifecycle/settle-background-process.js'
export { killBackgroundProcess } from './lifecycle/kill-background-process.js'
export { sweepOrphanedBackgroundProcesses } from './lifecycle/sweep-orphaned-processes.js'
export {
  listBackgroundProcesses,
  getBackgroundProcess,
} from './queries/list-background-processes.js'

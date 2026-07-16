// Domain-only types for the `apps` leaf.

// The subset of pino the core logs against (the tasks/asks precedent).
export interface StructuralLogger {
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

// A supervised app's live state. `exited` = clean exit (code 0 or a stop we
// requested); `crashed` = it died on its own with a non-zero code. Entries
// stick around after exit (with the ring buffer) until the next start — "it
// crashed, here's why" must survive the moment.
export type AppRunStatus = 'running' | 'exited' | 'crashed'

export interface AppRunSnapshot {
  appId: string
  status: AppRunStatus
  pid: number | null
  startedAt: Date
  exitCode: number | null
}

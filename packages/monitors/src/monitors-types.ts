// Domain-only types for the `monitors` leaf.

// The subset of pino the core logs against (the plans/tasks/channels
// StructuralLogger precedent — core never depends on the full pino type).
export interface StructuralLogger {
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

/** One outbox row as the matcher reads it — declared structurally so the
 *  matcher stays a pure function over data, testable without a database. */
export interface WatchableEvent {
  id: string
  type: string
  payload: Record<string, unknown>
  createdAt: Date
}

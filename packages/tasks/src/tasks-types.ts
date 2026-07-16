// Domain-only types for the `tasks` leaf.

// The subset of pino the core logs against (matches the chat/channels
// StructuralLogger precedent — core never depends on the full pino type).
export interface StructuralLogger {
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

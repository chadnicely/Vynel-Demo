// Domain-only types for the `features` leaf.

// The subset of pino the core logs against (matches the plans/phases
// StructuralLogger precedent — core never depends on the full pino type).
export interface StructuralLogger {
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

// `@vynel/logger` — structural logging contract + pino implementation.
//
// Phase 1: only the `StructuralLogger` type is published. Core ops
// accept this shape and apps wire pino at the boundary (handler
// bundle + factory injection). pino's runtime never reaches the core
// layer — type-only imports erase to nothing. The pino package is
// declared as a dep here so future implementation surface (a shared
// makeLogger factory, OpenTelemetry wiring, log-level config) lands
// alongside without churn at consumers.
//
// See docs/foundation.md §10 + .claude/rules/coding-standard.md
// "Discipline".

/**
 * Structural logger contract — what core ops, workers, and shared
 * library code accept for logging. Pino implements it; tests pass a
 * no-op or in-memory buffer. Three levels because that's all the
 * core layer needs; pino's full level set is available at the apps/
 * boundary where it's instantiated.
 */
export type StructuralLogger = {
  info(payload: object, message?: string): void
  warn(payload: object, message?: string): void
  error(payload: object, message?: string): void
}

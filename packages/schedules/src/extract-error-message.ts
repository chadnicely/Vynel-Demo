// Pull a human-readable message out of an unknown thrown value. Used by the
// fire path + the poll so a provider-stream failure is logged + recorded on
// the run row (never swallowed silently — error-handling.md).
//
// Spec: `docs/blueprints/schedules/coding.md §5`.

export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'Unknown error'
}

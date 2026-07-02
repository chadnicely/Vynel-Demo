// The structural logger shape the provider read-op inputs share (context
// report, session summary). A structural shape — NOT a `@vynel/logger` import —
// per the MEMORY "structural-logger pattern" precedent (a failed best-effort
// read is logged, not thrown). One home for the shape, consumed by
// `GetContextReportInput` + `SummarizeSessionInput`.

export type ProviderLogger = {
  info(payload: object, message?: string): void
  warn(payload: object, message?: string): void
}

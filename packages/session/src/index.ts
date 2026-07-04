// Public surface of `@vynel/session` — the WEB-SAFE barrel: only the session
// permission-mode model (ask/auto/bypass), which `apps/web` may import without
// dragging `@vynel/db`/providers into its bundle.
//
// The session-execution surface (the runners + `SessionSink`) is the `./runtime`
// subpath; the durable-session identity + swap machinery is `./continuity`. Both
// pull db/providers and must NEVER reach the web bundle — the split is the
// bundle-safety invariant (migration-plan hard constraint #1).
export * from './session-mode.js'

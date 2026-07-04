// Public surface of `@vynel/session` — the session domain (parent of chat; the
// turn service that returns a stream or a response). Slice 1 lands the
// `continuity` concern: durable-session identity (the `primary_sessions` table,
// renamed from `root_sessions` in Slice 1b) + renew-before-compaction.
//
// Slice 2 brings the runners (`./runtime` subpath) + the web-safe mode model,
// at which point this barrel narrows to the mode model and continuity/runtime
// move behind subpaths (the web-bundle-safety split).
export * from './continuity/index.js'

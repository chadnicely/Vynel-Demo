// Public barrel for the `session-continuity` domain's repository layer.
// Required by `@vynel/db`'s exports map (`./repositories/*` →
// `./src/repositories/*/index.ts`), so the barrel is mandatory.

export * from './root-sessions.js'

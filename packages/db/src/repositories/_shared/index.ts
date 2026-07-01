// Barrel for cross-cutting `_shared` repositories. Re-exports the outbox
// repo so consumers can `import * as outboxRepository from
// '@vynel/db/repositories/_shared'` per the `exports` map in
// `packages/db/package.json`.

export * from './outbox.js'

// Barrel for cross-cutting `_shared` schema. Re-exports the outbox
// events table so consumers can `import { outboxEvents } from
// '@vynel/db/schema/_shared'` per the `exports` map in
// `packages/db/package.json`. Per `.claude/rules/structure-standard.md`
// "packages/db/src/schema/".

export * from './outbox-events.js'

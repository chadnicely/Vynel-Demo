// Root schema barrel. Aggregates every domain's schema barrel so
// `drizzle.sqlite.config.ts` (and Phase 2's `drizzle.postgres.config.ts`)
// can pick up every table from a single glob, and the schema-parity
// guard can verify nothing is missed. Per
// `.claude/rules/structure-standard.md` "packages/db/src/schema/".

export * from './users/index.js'
export * from './workspaces/index.js'
export * from './providers/index.js'
export * from './files/index.js'
export * from './onboarding/index.js'
export * from './capabilities/index.js'
export * from './agents/index.js'
export * from './_shared/index.js'

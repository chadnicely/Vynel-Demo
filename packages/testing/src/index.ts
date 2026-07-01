// Public surface of @vynel/testing. Test fixtures, factories, the
// `withTestDatabase` helper (SQLite via os.tmpdir() in Phase 1;
// Testcontainers Postgres in Phase 2).
// Per docs/foundation.md §2 row 12 + .claude/rules/operating-rules.md
// "Quality gate" (no DB mocking ever).
// NOTE: @vynel/db's own tests use a local packages/db/src/test-support/
// helper to avoid a db↔testing workspace cycle.

export { withTestDatabase } from './with-test-database.js'
export type { WithTestDatabaseCallback } from './with-test-database.js'

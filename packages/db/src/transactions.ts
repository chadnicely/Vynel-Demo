// Transaction helper. **Phase 1: SYNC.** better-sqlite3 transactions
// reject callbacks that return a Promise — "Transaction function cannot
// return a promise". So in Phase 1:
//
//   - the callback is sync: (tx) => T (not Promise<T>)
//   - repos used inside must be sync (return T directly, not Promise<T>)
//   - the wrapper returns T synchronously
//
// Phase 2 Postgres swap (libpg/postgres-js is fully async) restores the
// async API at the same call sites — only the implementation flips.
//
// Per the technical workaround in `.claude/memory/MEMORY.md`
// "Technical workarounds" + `docs/blueprints/users/decisions.md §3` trail.

import type { Database } from './client.js'

export type TransactionCallback<T> = (tx: Database) => T

export function withTransaction<T>(db: Database, callback: TransactionCallback<T>): T {
  return db.transaction(callback)
}

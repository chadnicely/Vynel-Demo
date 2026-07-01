// Public surface of `@vynel/db`. Consumers import:
//   - `Database` + `createDatabase` from `@vynel/db`
//   - dialect helpers from `@vynel/db/dialect`
//   - per-domain schema barrels from `@vynel/db/schema/<d>`
//   - per-domain repository barrels from `@vynel/db/repositories/<d>`
// Per the `exports` map in `packages/db/package.json`.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type { Database, CreateDatabaseOptions } from './client.js'
export { createDatabase, createSqliteDatabase, closeDatabase } from './client.js'
export { withTransaction } from './transactions.js'
export { runMigrations } from './migrate.js'

// Absolute path to the SQLite migrations folder, resolved at module load.
// Callers (apps/api boot, apps/worker bootstrap if it ever migrates) pass
// this to `runMigrations` without having to compute the path themselves —
// keeps the migrations-folder location encapsulated inside @vynel/db. Phase
// 2 Postgres flips this (or adds a sibling) when the cloud branch lands.
const here = dirname(fileURLToPath(import.meta.url))
export const sqliteMigrationsFolder = resolve(here, 'migrations-sqlite')

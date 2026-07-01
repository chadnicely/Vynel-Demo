// Local test helper for repository tests INSIDE `packages/db`. Provides a
// fresh SQLite file (under `os.tmpdir()`) per test, runs the same migrations
// the production code uses, and closes/unlinks on teardown.
//
// Why local (not `@vynel/testing`):
// `@vynel/testing` depends on `@vynel/db`, so importing it from `packages/db`
// would form a workspace cycle that breaks turbo's build graph. Repo tests
// use THIS helper; core and route integration tests (in other packages) use
// `@vynel/testing`. Per `.claude/rules/structure-standard.md` "packages/db/src/"
// + `.claude/rules/operating-rules.md` "Gates & boundaries".

import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createSqliteDatabase, closeDatabase, type Database } from '../client.js'
import { runMigrations } from '../migrate.js'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = resolve(here, '../migrations-sqlite')

export type WithTestDatabaseCallback<T> = (db: Database) => T | Promise<T>

export async function withTestDatabase<T>(callback: WithTestDatabaseCallback<T>): Promise<T> {
  const tempDir = mkdtempSync(join(tmpdir(), 'vynel-db-test-'))
  const db = createSqliteDatabase({
    dialect: 'sqlite',
    path: join(tempDir, 'test.db'),
  })
  try {
    runMigrations(db, { migrationsFolder })
    return await callback(db)
  } finally {
    closeDatabase(db)
    rmSync(tempDir, { recursive: true, force: true })
  }
}

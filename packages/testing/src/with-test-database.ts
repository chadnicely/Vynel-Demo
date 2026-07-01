// `withTestDatabase` for cross-package consumers (core ops, route
// integration tests, etc.). Provides a fresh SQLite file under
// `os.tmpdir()` per call, runs the SQLite migrations from @vynel/db's
// migrations-sqlite folder, and closes/unlinks on teardown.
//
// `packages/db` has its OWN local helper at
// `packages/db/src/test-support/with-test-database.ts` for its own
// tests — that helper avoids the `packages/db ↔ packages/testing`
// workspace cycle that would otherwise form. Other packages
// (core, api, etc.) use THIS helper.
//
// Per `docs/foundation.md §2 row 12` + `.claude/rules/operating-rules.md`
// "Quality gate" (no DB mocking ever) + `.claude/rules/structure-
// standard.md` "Test colocation".

import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createSqliteDatabase, closeDatabase, runMigrations, type Database } from '@vynel/db'

const here = dirname(fileURLToPath(import.meta.url))
// From packages/testing/src/with-test-database.ts to
// packages/db/src/migrations-sqlite/
const migrationsFolder = resolve(here, '../../db/src/migrations-sqlite')

export type WithTestDatabaseCallback<T> = (db: Database) => T | Promise<T>

export async function withTestDatabase<T>(callback: WithTestDatabaseCallback<T>): Promise<T> {
  const tempDir = mkdtempSync(join(tmpdir(), 'vynel-test-'))
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

// The hub's `withTestDatabase` analogue: a REAL Postgres dialect via PGlite
// (in-process, in-memory, no Docker on the gate — cloud-api.md §2), migrated
// from the same committed folder production uses. Never mock the DB.
//
// Lives in cloud-db (not `@vynel/testing`) so the SQLite test substrate stays
// free of Postgres deps; consumers import `@vynel/cloud-db/testing`.

import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { CloudDatabase } from './client.js'
import { cloudMigrationsFolder } from './migrate.js'

export async function withTestCloudDatabase<T>(
  fn: (db: CloudDatabase) => Promise<T>,
): Promise<T> {
  const pglite = new PGlite()
  const db = drizzle(pglite, { casing: 'snake_case' })
  await migrate(db, { migrationsFolder: cloudMigrationsFolder })
  try {
    return await fn(db)
  } finally {
    await pglite.close()
  }
}

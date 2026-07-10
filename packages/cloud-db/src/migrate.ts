// Boot migrator for the hub's Postgres. Run against the DIRECT (non-pooled)
// connection with `maxConnections: 1` — DDL through a transaction-mode pooler
// misbehaves (postgres-phase2.md §1). The caller closes the db afterwards.

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

const here = dirname(fileURLToPath(import.meta.url))

// Resolved from this file so every caller (server boot, tests via
// `./testing.ts`) lands on the one committed folder regardless of cwd.
export const cloudMigrationsFolder = resolve(here, '..', 'migrations-postgres')

export async function runCloudMigrations(
  db: PostgresJsDatabase,
  options?: { readonly migrationsFolder?: string },
): Promise<void> {
  await migrate(db, { migrationsFolder: options?.migrationsFolder ?? cloudMigrationsFolder })
}

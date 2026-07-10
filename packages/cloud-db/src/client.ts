// The HUB's Postgres client factory + the `CloudDatabase` type every cloud
// repository takes as its first argument. This kernel is a SECOND system
// beside `@vynel/db` (the product's local SQLite kernel) — it holds OUR
// server-side truth (accounts, entitlements, the registry), never the user's
// local data, and it is Postgres-only by design: it never runs on a user
// machine, so no dialect seam (docs/module-notes/cloud-api.md §2).

import { drizzle } from 'drizzle-orm/postgres-js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import postgres from 'postgres'

// The driver-agnostic supertype: both the postgres-js production client and
// the PGlite test client (`./testing.ts`) satisfy it, so repositories accept
// either without casts.
export type CloudDatabase = PgDatabase<PgQueryResultHKT>

export interface CreateCloudDatabaseOptions {
  readonly url: string
  /** Pool size; keep 1 for the migrator's direct connection. */
  readonly maxConnections?: number
  /**
   * postgres-js prepares statements by default, which silently breaks behind
   * a transaction-mode pooler (PgBouncer/Neon :6543) — the letterman
   * cautionary tale (docs/module-notes/postgres-phase2.md §2). Default OFF:
   * safe under every deployment; flip on deliberately when the hub is known
   * to talk to Postgres directly.
   */
  readonly prepare?: boolean
}

const postgresClients = new WeakMap<PostgresJsDatabase, postgres.Sql>()

export function createCloudDatabase(options: CreateCloudDatabaseOptions): PostgresJsDatabase {
  const sql = postgres(options.url, {
    prepare: options.prepare ?? false,
    ...(options.maxConnections !== undefined ? { max: options.maxConnections } : {}),
  })
  // `casing: 'snake_case'` auto-converts camelCase schema properties to
  // snake_case columns — same convention as `@vynel/db`.
  const db = drizzle(sql, { casing: 'snake_case' })
  postgresClients.set(db, sql)
  return db
}

// An unclosed postgres.js pool keeps the event loop alive and hangs `&&`
// chains / CI — the migrator and the server shutdown path must call this
// (postgres-phase2.md §3).
export async function closeCloudDatabase(db: PostgresJsDatabase): Promise<void> {
  const sql = postgresClients.get(db)
  if (sql) {
    await sql.end()
    postgresClients.delete(db)
  }
}

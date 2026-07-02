// SQLite database client factory + the public `Database` type that every
// repository function accepts as its first argument. Per the foundation
// `docs/foundation.md §2 row 5` (SQLite via better-sqlite3, Phase 1) and
// `.claude/rules/data-standard.md` "Dialect parity" (same code serves both
// dialects via the dialect helpers in `./dialect.ts`).
//
// Every connection loads the sqlite-vec extension at construction so the
// `vec0` virtual table is available for the `memory` domain's semantic
// search (the `memory_entries_vec` table in the baseline). The extension binary
// ships via the `sqlite-vec` npm package's platform-specific subpackages
// (sqlite-vec-windows-x64, sqlite-vec-darwin-arm64, etc.). Memory is the
// first consumer; `knowledge` will reuse for document-chunk embeddings.

import BetterSqlite3 from 'better-sqlite3'
import type { Database as BetterSqlite3Instance } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as sqliteVec from 'sqlite-vec'

export type Database = BetterSQLite3Database

export interface CreateDatabaseOptions {
  readonly dialect: 'sqlite' | 'postgres'
  readonly path?: string
  readonly url?: string
}

// The underlying SQLite instance for each Drizzle Database. Tracked here
// so `closeDatabase` can shut down cleanly without changing the public
// `Database` return type. Tests + the server shutdown handler are the
// only intentional callers of close.
const sqliteClients = new WeakMap<Database, BetterSqlite3Instance>()

export function createSqliteDatabase(options: CreateDatabaseOptions): Database {
  if (options.dialect !== 'sqlite') {
    throw new Error(
      `createSqliteDatabase: expected dialect 'sqlite', got '${options.dialect}'. Postgres branch lands in Phase 2.`,
    )
  }
  if (!options.path) {
    throw new Error('createSqliteDatabase: path is required for SQLite databases.')
  }
  const sqlite = new BetterSqlite3(options.path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  // Load sqlite-vec for the `memory` domain's vec0 virtual table. Throws
  // if the platform binary isn't installed (e.g. running on FreeBSD —
  // sqlite-vec ships darwin/linux/windows x64+arm64 only). Fail-loud is
  // intentional: a missing extension means semantic search is broken;
  // catching silently would hide the failure until query time.
  sqliteVec.load(sqlite)
  // `casing: 'snake_case'` auto-converts JS camelCase property names to
  // snake_case SQL column names per `.claude/rules/data-standard.md`
  // "Schema". Schema files keep camelCase property names (TypeScript-
  // idiomatic), SQL keeps snake_case (DB-idiomatic).
  const db = drizzle(sqlite, { casing: 'snake_case' })
  sqliteClients.set(db, sqlite)
  return db
}

export function closeDatabase(db: Database): void {
  const sqlite = sqliteClients.get(db)
  if (sqlite) {
    sqlite.close()
    sqliteClients.delete(db)
  }
}

// The underlying better-sqlite3 instance behind a Database — needed by the
// migration runner to toggle connection-level pragmas (`foreign_keys`) OUTSIDE
// drizzle's per-migration transaction (see `runMigrations`). Every Database is
// created via this factory (api boot + both `withTestDatabase` helpers), so it
// is always tracked; throws otherwise.
export function getSqliteClient(db: Database): BetterSqlite3Instance {
  const sqlite = sqliteClients.get(db)
  if (!sqlite) {
    throw new Error(
      'getSqliteClient: no SQLite client tracked for this Database (create it via createSqliteDatabase).',
    )
  }
  return sqlite
}

// The dialect-conditional factory wraps this in Phase 2 when the Postgres
// branch lands. Phase 1 only ever hits the SQLite path.
export const createDatabase = createSqliteDatabase

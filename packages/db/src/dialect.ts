// Dialect-agnostic Drizzle column helpers. The contract lives in
// `.claude/rules/data-standard.md` "Helper contracts" + the spec table in
// `docs/blueprints/users/blueprint.md §3`. Schema files in every domain
// import from here and NEVER from `drizzle-orm/pg-core` or
// `drizzle-orm/sqlite-core` directly — that's the rule that lets the same
// `packages/db` code serve both dialects.
//
// Phase 1: resolved to SQLite (env.DB_DIALECT = 'sqlite').
// Phase 2: a Postgres branch lands here when cloud work begins.

import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  blob as sqliteBlob,
  primaryKey as sqlitePrimaryKey,
  index as sqliteIndex,
  uniqueIndex as sqliteUniqueIndex,
} from 'drizzle-orm/sqlite-core'

// Active dialect at module load. Phase 1: SQLite always. Phase 2: read from
// `env.DB_DIALECT`. Consumers branch on this when behavior genuinely differs
// between dialects (e.g. FTS5 vs tsvector in chat-search). Per
// `docs/coding-guideline.md §5.1` + chat D17. First consumer:
// `packages/db/src/repositories/chat/chat-search.ts`.
export type Dialect = 'sqlite' | 'postgres'
export const activeDialect: Dialect = 'sqlite'

export const table = sqliteTable

export const text = sqliteText

// Composite primary key constraint. Used in the second arg of `table(...)`
// when a table has more than one PK column. Re-exported so schema files
// stay clean of `drizzle-orm/sqlite-core` (or pg-core in Phase 2).
export const primaryKey = sqlitePrimaryKey

// Secondary index builder. Used in the third arg of `table(...)` to declare
// per-column or composite indexes. Re-exported so schema files stay clean
// of `drizzle-orm/sqlite-core` (or pg-core in Phase 2).
export const index = sqliteIndex

// Unique index builder. Used in the third arg of `table(...)` to declare a
// per-column or composite UNIQUE constraint. Re-exported so schema files stay
// clean of `drizzle-orm/sqlite-core` (or pg-core in Phase 2). Providers'
// `provider_preferences` is the first domain to need it — see
// `docs/blueprints/providers/blueprint.md §3.1`.
export const uniqueIndex = sqliteUniqueIndex

export function id() {
  // UUID-shaped text PK — NOT NULL, no DEFAULT clause. Caller supplies the
  // value via `crypto.randomUUID()` at the core layer. Chain `.primaryKey()`
  // or `.references(...)` in the schema file.
  return sqliteText().notNull()
}

export function timestamp() {
  // Returns `Date` objects via Drizzle's mode mapping.
  // Postgres branch (Phase 2): `pgTimestamp({ withTimezone: true, mode: 'date' })`.
  return sqliteInteger({ mode: 'timestamp_ms' })
}

export function boolean() {
  // Returns `boolean` via Drizzle's mode mapping.
  // Postgres branch (Phase 2): `pgBoolean()`.
  return sqliteInteger({ mode: 'boolean' })
}

export function integer() {
  // Plain numeric column — no mode mapping. Used for denormalized counters
  // (token totals, message counts) where SQL-side increment is the
  // streaming-safe update pattern. Added by `chat` (D18 in
  // `docs/blueprints/chat/decisions.md`); first domain to need plain
  // integer. Postgres branch (Phase 2): `pgInteger()`.
  return sqliteInteger()
}

export function json<T = unknown>() {
  // Opaque-never-filtered config only (per data-standard.md "Schema").
  // Postgres branch (Phase 2): `pgJsonb().$type<T>()`.
  return sqliteText({ mode: 'json' }).$type<T>()
}

export function bytes() {
  // Binary blob column — returns `Buffer` via Drizzle's mode mapping.
  // Added by `memory` (D18 in `docs/blueprints/memory/decisions.md`);
  // first domain to need binary storage (serialized 384-float32 MiniLM
  // embeddings = 1536 bytes per row). Knowledge will reuse for
  // document-chunk embeddings — precedent-twin to chat D18's
  // `integer()` helper. Postgres branch (Phase 2): `pgBytea()`.
  return sqliteBlob({ mode: 'buffer' })
}

// Standalone migration runner. Invoked at server boot in Phase 1
// (single process; `apps/api/src/server.ts` calls this before serving
// traffic). Moves to a CI pre-deploy step in Phase 2 (multi-pod cloud).
// Per `docs/foundation.md §2 row 11` + `.claude/rules/data-standard.md`
// "Migrations".

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { getSqliteClient, type Database } from './client.js'

export interface RunMigrationsOptions {
  readonly migrationsFolder: string
}

export function runMigrations(db: Database, options: RunMigrationsOptions): void {
  // Disable FK enforcement at the CONNECTION level for the migration run, then
  // restore it. WHY: a table-rebuild migration (create `__new_x` → copy → DROP
  // old `x` → rename; e.g. 0029's `chat_sessions` nullable-`workspaceId`
  // rebuild) DROPs the old table — and with `foreign_keys` ON, SQLite performs
  // an implicit cascade-delete into child tables (`chat_messages` is
  // `ON DELETE cascade`) DURING the DROP, which fires their FTS5 sync triggers
  // mid-DROP → `SQLITE_LOCKED: database table is locked` on a POPULATED db.
  // The migration's own `PRAGMA foreign_keys=OFF` (line 1 of the rebuild) is a
  // NO-OP because drizzle wraps each migration in a transaction and SQLite
  // ignores `PRAGMA foreign_keys` inside a tx — so it must be toggled HERE,
  // outside the tx. (Empty-db tests never hit this: a 0-row table has nothing
  // to cascade, which is why the suite stayed green while real data broke.)
  const sqlite = getSqliteClient(db)
  sqlite.pragma('foreign_keys = OFF')
  try {
    // better-sqlite3's migrate is sync (matches the Phase 1 sync-tx
    // contract in `.claude/memory/MEMORY.md` "Technical workarounds").
    migrate(db, { migrationsFolder: options.migrationsFolder })
  } catch (err) {
    throw toActionableMigrationError(err)
  } finally {
    sqlite.pragma('foreign_keys = ON')
  }
}

// Translate a locked-database migration failure into an actionable message.
// When another process holds the SQLite file (typically a stale `pnpm dev`
// still running), `migrate()` throws a cryptic DrizzleError wrapping
// `SqliteError: database is locked`. Surface a clear next step + keep the
// original error as `cause`. (This is the genuine concurrent-holder case — NOT
// the FK-cascade lock, which the connection-level FK toggle in `runMigrations`
// already fixes.)
export function toActionableMigrationError(err: unknown): Error {
  if (isDatabaseLockedError(err)) {
    return new Error(
      'Migration failed: the database is locked by another process. Stop any stale dev server (a prior `pnpm dev` still holding the SQLite file) and retry.',
      { cause: err },
    )
  }
  return err instanceof Error ? err : new Error(String(err))
}

// SQLite's lock signature can sit on the error OR its `cause` (drizzle wraps the
// underlying better-sqlite3 SqliteError). Walk the chain, checking both the
// `code` ('SQLITE_LOCKED' / 'SQLITE_BUSY') and the message.
function isDatabaseLockedError(err: unknown): boolean {
  for (let current: unknown = err; current instanceof Error; current = current.cause) {
    const code = (current as { readonly code?: unknown }).code
    if (code === 'SQLITE_LOCKED' || code === 'SQLITE_BUSY') return true
    if (/database (table )?is locked/i.test(current.message)) return true
  }
  return false
}

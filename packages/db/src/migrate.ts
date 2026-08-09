// Standalone migration runner. Invoked at server boot in Phase 1
// (single process; `apps/local-api/src/server.ts` calls this before serving
// traffic). Moves to a CI pre-deploy step in Phase 2 (multi-pod cloud).
// Per `docs/foundation.md §2 row 11` + `.claude/rules/data-standard.md`
// "Migrations".

import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { getSqliteClient, type Database } from './client.js'

export interface RunMigrationsOptions {
  readonly migrationsFolder: string
}

export interface BackupBeforePendingMigrationsOptions {
  readonly migrationsFolder: string
  /** The SQLite file's path — the backup lands beside it as `<path>.pre-migration.bak`. */
  readonly databasePath: string
}

/**
 * Snapshot the database before an app update's migrations touch it —
 * migrations are the one non-rollbackable step of an update, and the backup
 * is what "reinstall the previous version" restores from. Backs up ONLY when
 * a populated, previously-migrated database faces pending migrations: a fresh
 * install (nothing applied yet) and an ordinary boot (nothing pending) skip
 * the copy, so steady-state boot pays nothing. Keeps exactly one backup —
 * the state right before the most recent migration run.
 *
 * Returns the backup path, or null when no backup was taken.
 */
export function backupBeforePendingMigrations(
  db: Database,
  options: BackupBeforePendingMigrationsOptions,
): string | null {
  const journalPath = join(options.migrationsFolder, 'meta', '_journal.json')
  let journalCount: number
  try {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries?: readonly unknown[]
    }
    journalCount = journal.entries?.length ?? 0
  } catch {
    // No readable journal — migrate() itself will fail loudly right after;
    // a backup of an untouched database adds nothing.
    return null
  }

  const sqlite = getSqliteClient(db)
  const migrationsTable = sqlite
    .prepare(
      "select count(*) as found from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
    )
    .get() as { found: number }
  if (migrationsTable.found === 0) return null
  const applied = sqlite
    .prepare('select count(*) as applied from __drizzle_migrations')
    .get() as { applied: number }
  if (applied.applied === 0 || journalCount <= applied.applied) return null

  // VACUUM INTO writes a consistent snapshot through the live connection —
  // WAL content included, which a plain file copy would miss. It refuses an
  // existing target, so the previous backup clears first.
  const backupPath = `${options.databasePath}.pre-migration.bak`
  rmSync(backupPath, { force: true })
  sqlite.prepare('VACUUM INTO ?').run(backupPath)
  return backupPath
}

export function runMigrations(db: Database, options: RunMigrationsOptions): void {
  // Disable FK enforcement at the CONNECTION level for the migration run, then
  // restore it. WHY: a table-rebuild migration — the `create __new_x → copy →
  // DROP old x → rename` pattern drizzle-kit emits for a column drop or type
  // change — DROPs the old table, and with `foreign_keys` ON, SQLite performs
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

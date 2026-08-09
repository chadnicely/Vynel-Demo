// Regression guard for the migrate-time foreign-key handling. The bug it locks
// down: a table-rebuild migration (DROP old table) on a POPULATED db, with
// foreign_keys ON, does an implicit cascade-delete into child tables + fires
// their triggers mid-DROP → `SQLITE_LOCKED`. The empty-db suite never caught it
// (0 rows = nothing to cascade). `runMigrations` fixes it by disabling FK
// enforcement at the CONNECTION level for the migration run (the in-migration
// `PRAGMA foreign_keys=OFF` is a no-op inside drizzle's transaction).
//
// We assert the FIX'S MECHANISM directly: a migration that inserts a child row
// referencing a NON-EXISTENT parent only succeeds if FK enforcement is OFF
// during the run. With the fix it passes; remove the fix and it throws.

import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createSqliteDatabase, closeDatabase, getSqliteClient } from './client.js'
import {
  backupBeforePendingMigrations,
  runMigrations,
  toActionableMigrationError,
} from './migrate.js'

function writeMigrationsFolder(migrations: { tag: string; sql: string }[]): string {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'vynel-mig-'))
  mkdirSync(path.join(folder, 'meta'), { recursive: true })
  writeFileSync(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: migrations.map((m, idx) => ({
        idx,
        version: '6',
        when: idx + 1,
        tag: m.tag,
        breakpoints: true,
      })),
    }),
  )
  for (const m of migrations) writeFileSync(path.join(folder, `${m.tag}.sql`), m.sql)
  return folder
}

describe('runMigrations — foreign-key handling', () => {
  it('disables FK enforcement DURING the migration and restores it after', () => {
    const dbDir = mkdtempSync(path.join(os.tmpdir(), 'vynel-db-'))
    const db = createSqliteDatabase({ dialect: 'sqlite', path: path.join(dbDir, 'test.db') })

    const folder = writeMigrationsFolder([
      {
        tag: '0000_fk_probe',
        sql: [
          'CREATE TABLE `parent` (`id` text PRIMARY KEY NOT NULL);',
          'CREATE TABLE `child` (`id` text PRIMARY KEY NOT NULL, `parent_id` text NOT NULL, FOREIGN KEY (`parent_id`) REFERENCES `parent`(`id`) ON DELETE cascade);',
          // Orphan FK — throws SQLITE_CONSTRAINT if FK is ON during the migration.
          "INSERT INTO `child` (`id`, `parent_id`) VALUES ('c1', 'no-such-parent');",
        ].join('\n--> statement-breakpoint\n'),
      },
    ])

    expect(() => runMigrations(db, { migrationsFolder: folder })).not.toThrow()

    const sqlite = getSqliteClient(db)
    // The orphan row landed → FK enforcement was OFF during the migration.
    expect(sqlite.prepare('SELECT parent_id FROM child WHERE id = ?').get('c1')).toEqual({
      parent_id: 'no-such-parent',
    })
    // …and it is restored to ON afterward (the app runs with FK enforcement).
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)

    closeDatabase(db)
    rmSync(folder, { recursive: true, force: true })
    rmSync(dbDir, { recursive: true, force: true })
  })
})

describe('backupBeforePendingMigrations', () => {
  const FIRST_MIGRATION = {
    tag: '0000_init',
    sql: "CREATE TABLE `notes` (`id` text PRIMARY KEY NOT NULL);--> statement-breakpoint\nINSERT INTO `notes` (`id`) VALUES ('n1');",
  }
  const SECOND_MIGRATION = {
    tag: '0001_more',
    sql: 'CREATE TABLE `extras` (`id` text PRIMARY KEY NOT NULL);',
  }

  function scratchDatabase() {
    const dbDir = mkdtempSync(path.join(os.tmpdir(), 'vynel-db-'))
    const databasePath = path.join(dbDir, 'test.db')
    const db = createSqliteDatabase({ dialect: 'sqlite', path: databasePath })
    return {
      db,
      databasePath,
      done: (...folders: string[]) => {
        closeDatabase(db)
        rmSync(dbDir, { recursive: true, force: true })
        for (const folder of folders) rmSync(folder, { recursive: true, force: true })
      },
    }
  }

  it('skips a fresh database (nothing applied yet, nothing worth saving)', () => {
    const { db, databasePath, done } = scratchDatabase()
    const folder = writeMigrationsFolder([FIRST_MIGRATION])

    expect(backupBeforePendingMigrations(db, { migrationsFolder: folder, databasePath })).toBeNull()

    done(folder)
  })

  it('skips an up-to-date database (steady-state boots pay nothing)', () => {
    const { db, databasePath, done } = scratchDatabase()
    const folder = writeMigrationsFolder([FIRST_MIGRATION])
    runMigrations(db, { migrationsFolder: folder })

    expect(backupBeforePendingMigrations(db, { migrationsFolder: folder, databasePath })).toBeNull()

    done(folder)
  })

  it('backs up a migrated database facing pending migrations — the update case', () => {
    const { db, databasePath, done } = scratchDatabase()
    const applied = writeMigrationsFolder([FIRST_MIGRATION])
    runMigrations(db, { migrationsFolder: applied })
    // The "new app version" ships a folder with one more migration.
    const shipped = writeMigrationsFolder([FIRST_MIGRATION, SECOND_MIGRATION])

    const backupPath = backupBeforePendingMigrations(db, {
      migrationsFolder: shipped,
      databasePath,
    })

    expect(backupPath).toBe(`${databasePath}.pre-migration.bak`)
    expect(existsSync(backupPath!)).toBe(true)
    // The snapshot is a real pre-migration database: the applied table is
    // there with its data, the pending one is not.
    const backup = createSqliteDatabase({ dialect: 'sqlite', path: backupPath! })
    const backupSqlite = getSqliteClient(backup)
    expect(backupSqlite.prepare('SELECT id FROM notes').get()).toEqual({ id: 'n1' })
    expect(
      backupSqlite
        .prepare("SELECT count(*) as found FROM sqlite_master WHERE name = 'extras'")
        .get(),
    ).toEqual({ found: 0 })
    closeDatabase(backup)

    done(applied, shipped)
  })

  it('replaces the previous backup (exactly one kept)', () => {
    const { db, databasePath, done } = scratchDatabase()
    const applied = writeMigrationsFolder([FIRST_MIGRATION])
    runMigrations(db, { migrationsFolder: applied })
    const shipped = writeMigrationsFolder([FIRST_MIGRATION, SECOND_MIGRATION])

    writeFileSync(`${databasePath}.pre-migration.bak`, 'stale previous backup')
    const backupPath = backupBeforePendingMigrations(db, {
      migrationsFolder: shipped,
      databasePath,
    })

    expect(backupPath).not.toBeNull()
    const backup = createSqliteDatabase({ dialect: 'sqlite', path: backupPath! })
    expect(getSqliteClient(backup).prepare('SELECT id FROM notes').get()).toEqual({ id: 'n1' })
    closeDatabase(backup)

    done(applied, shipped)
  })

  it('skips when the journal is unreadable (migrate itself will fail loudly)', () => {
    const { db, databasePath, done } = scratchDatabase()

    expect(
      backupBeforePendingMigrations(db, {
        migrationsFolder: path.join(os.tmpdir(), 'vynel-no-such-folder'),
        databasePath,
      }),
    ).toBeNull()

    done()
  })
})

describe('toActionableMigrationError', () => {
  it('wraps a locked-db error (code on the wrapped cause) with an actionable message + keeps the cause', () => {
    const sqliteError = Object.assign(new Error('database is locked'), { code: 'SQLITE_LOCKED' })
    const drizzleError = new Error("Failed to run the query 'DROP TABLE chat_sessions;'", {
      cause: sqliteError,
    })

    const actionable = toActionableMigrationError(drizzleError)

    expect(actionable.message).toContain('locked by another process')
    expect(actionable.message).toContain('stale dev server') // names the next step
    expect(actionable.cause).toBe(drizzleError)
  })

  it('detects the lock by message alone (no code)', () => {
    expect(toActionableMigrationError(new Error('database table is locked')).message).toContain(
      'locked by another process',
    )
  })

  it('passes a non-lock error through unchanged', () => {
    const other = new Error('no such table: chat_sessions')
    expect(toActionableMigrationError(other)).toBe(other)
  })

  it('coerces a non-Error throwable to an Error', () => {
    expect(toActionableMigrationError('boom')).toBeInstanceOf(Error)
  })
})

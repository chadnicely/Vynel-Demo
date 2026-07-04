// Smoke tests for createSqliteDatabase + withTransaction. Verifies the
// SQLite connection opens, WAL + foreign_keys pragmas are set, and the
// transaction wrapper rolls back when the callback throws. Per
// `docs/blueprints/users/blueprint.md §16 step 3`.

import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { createSqliteDatabase, closeDatabase, type Database } from './client.js'
import { withTransaction } from './transactions.js'

type TestDbHandle = { db: Database; dir: string }
const openDbs: TestDbHandle[] = []

function freshDb(): Database {
  const dir = mkdtempSync(join(tmpdir(), 'vynel-db-test-'))
  const db = createSqliteDatabase({ dialect: 'sqlite', path: join(dir, 'test.db') })
  openDbs.push({ db, dir })
  return db
}

afterEach(() => {
  // Close SQLite handles first — Windows refuses to unlink an open file.
  for (const { db, dir } of openDbs.splice(0)) {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('createSqliteDatabase', () => {
  it('opens a real SQLite database with WAL + foreign_keys pragmas', () => {
    const db = freshDb()
    const journalMode = db.get<{ journal_mode: string }>(sql`PRAGMA journal_mode`)
    expect(journalMode?.journal_mode).toBe('wal')
    const fk = db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)
    expect(fk?.foreign_keys).toBe(1)
  })

  it('rejects non-sqlite dialects (Phase 2 branch not yet implemented)', () => {
    expect(() =>
      createSqliteDatabase({ dialect: 'postgres' as 'sqlite', path: '/tmp/x.db' }),
    ).toThrow(/Postgres branch lands in Phase 2/)
  })

  it('requires a path', () => {
    expect(() => createSqliteDatabase({ dialect: 'sqlite' })).toThrow(/path is required/)
  })

  it('creates the parent directory when it does not exist yet (fresh boot)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vynel-db-test-'))
    // Point at a nested path whose parent dirs do NOT exist yet — the api boots
    // against `.data/vynel.db` before anything has created `.data/`.
    const db = createSqliteDatabase({ dialect: 'sqlite', path: join(dir, 'nested', 'deeper', 'boot.db') })
    openDbs.push({ db, dir })
    const row = db.get<{ n: number }>(sql`SELECT 1 AS n`)
    expect(row?.n).toBe(1)
  })
})

describe('sqlite-vec extension (loaded on every connection — memory + knowledge)', () => {
  it('exposes vec_version() — the extension loaded successfully', () => {
    const db = freshDb()
    const row = db.get<{ version: string }>(sql`SELECT vec_version() AS version`)
    // sqlite-vec 0.1.x returns a string like 'v0.1.9'; we don't pin the
    // exact value — assert presence + shape only so a future bump
    // doesn't break the smoke.
    expect(typeof row?.version).toBe('string')
    expect(row?.version).toMatch(/^v?\d+\.\d+/)
  })

  it('creates and queries a vec0 virtual table end-to-end', () => {
    const db = freshDb()
    db.run(sql`CREATE VIRTUAL TABLE _vec_probe USING vec0(id TEXT PRIMARY KEY, embedding float[4])`)
    // Insert two embeddings; query KNN against one of them.
    const a = Buffer.from(new Float32Array([1, 0, 0, 0]).buffer)
    const b = Buffer.from(new Float32Array([0.9, 0.1, 0, 0]).buffer)
    db.run(sql`INSERT INTO _vec_probe(id, embedding) VALUES ('a', ${a}), ('b', ${b})`)
    // KNN — closest to 'a's vector should be 'a' itself, then 'b'.
    const rows = db.all<{ id: string; distance: number }>(sql`
      SELECT id, distance
        FROM _vec_probe
        WHERE embedding MATCH ${a} AND k = 2
        ORDER BY distance
    `)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.id).toBe('a')
    expect(rows[1]?.id).toBe('b')
  })
})

describe('withTransaction (Phase 1: sync — better-sqlite3 constraint)', () => {
  it('commits the callback result when it does not throw', () => {
    const db = freshDb()
    db.run(sql`CREATE TABLE test_tx (id INTEGER PRIMARY KEY, v TEXT)`)
    const result = withTransaction(db, (tx) => {
      tx.run(sql`INSERT INTO test_tx (id, v) VALUES (1, 'kept')`)
      return 'ok'
    })
    expect(result).toBe('ok')
    const row = db.get<{ v: string }>(sql`SELECT v FROM test_tx WHERE id = 1`)
    expect(row?.v).toBe('kept')
  })

  it('rolls back when the callback throws', () => {
    const db = freshDb()
    db.run(sql`CREATE TABLE test_tx (id INTEGER PRIMARY KEY, v TEXT)`)
    expect(() =>
      withTransaction(db, (tx) => {
        tx.run(sql`INSERT INTO test_tx (id, v) VALUES (1, 'discarded')`)
        throw new Error('boom')
      }),
    ).toThrow('boom')
    const row = db.get<{ v: string }>(sql`SELECT v FROM test_tx WHERE id = 1`)
    expect(row).toBeUndefined()
  })

  it('rejects async callbacks at runtime (better-sqlite3 contract — Phase 1 constraint)', () => {
    const db = freshDb()
    db.run(sql`CREATE TABLE test_tx (id INTEGER PRIMARY KEY, v TEXT)`)
    expect(() =>
      withTransaction(db, (tx) => {
        // Returning a Promise from the callback triggers the
        // better-sqlite3 guard at runtime. This serves as the canary
        // that Phase 1 transactions stay sync.
        tx.run(sql`INSERT INTO test_tx (id, v) VALUES (1, 'x')`)
        return Promise.resolve('x') as unknown as string
      }),
    ).toThrow(/cannot return a promise/i)
  })
})

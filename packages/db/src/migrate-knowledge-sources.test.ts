// Behavioral regression test for migration 0038 (knowledge scope + sources).
// 0038 rebuilds `knowledge_documents` (nullable workspace + source_id + scope),
// drops `knowledge_chunks.workspace_id`, and REBUILDS the FTS + vec search
// indices. `migrate.ts` documents that an empty-DB-only test let a prior rebuild
// ship green-but-broken — so this seeds a POPULATED old-shape DB (workspace +
// document + chunk with a real 1536-byte embedding + FTS + vec row), applies
// 0038, and asserts the data survived AND that keyword (FTS) + vector (vec)
// search still return the chunk afterward.

import { describe, it, expect, afterEach } from 'vitest'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createSqliteDatabase, closeDatabase, getSqliteClient, type Database } from './client.js'
import { runMigrations } from './migrate.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const realMigrationsDir = path.join(here, 'migrations-sqlite')

const TS = 1700000000000
const WS_PATH = '/tmp/ws-fixture'

// Deterministic 384-dim float32 embedding (1536 bytes). Querying with the same
// vector puts the seeded chunk at distance 0 — the nearest neighbour.
function makeEmbedding(value: number): Buffer {
  const buf = Buffer.alloc(384 * 4)
  for (let i = 0; i < 384; i++) buf.writeFloatLE(value, i * 4)
  return buf
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) c()
})

// Copy the REAL migrations into a temp dir; `applyUpTo` writes the journal
// truncated to `<= maxIdx` then runs — so we can stop at 0037, seed, then apply
// 0038 (the migrator applies only the newly-listed entry).
function stagedMigrations(): { applyUpTo: (db: Database, maxIdx: number) => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vynel-mig-0038-'))
  cpSync(realMigrationsDir, dir, { recursive: true })
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const journalPath = path.join(dir, 'meta', '_journal.json')
  const fullJournal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    version: string
    dialect: string
    entries: { idx: number }[]
  }
  return {
    applyUpTo(db, maxIdx) {
      writeFileSync(
        journalPath,
        JSON.stringify({
          ...fullJournal,
          entries: fullJournal.entries.filter((e) => e.idx <= maxIdx),
        }),
      )
      runMigrations(db, { migrationsFolder: dir })
    },
  }
}

describe('migration 0038 — knowledge scope + sources (populated DB)', () => {
  it('preserves docs, chunks + embeddings, and keyword + vector search still return the chunk', () => {
    const dbDir = mkdtempSync(path.join(os.tmpdir(), 'vynel-db-0038-'))
    cleanups.push(() => rmSync(dbDir, { recursive: true, force: true }))
    const db = createSqliteDatabase({ dialect: 'sqlite', path: path.join(dbDir, 'test.db') })
    cleanups.push(() => closeDatabase(db))
    const sqlite = getSqliteClient(db)

    const migrations = stagedMigrations()

    // 1. Old shape: apply everything up to (and including) 0037.
    migrations.applyUpTo(db, 37)

    // 2. Seed an old-shape populated DB. Inserting the chunk fires the FTS insert
    //    trigger, so knowledge_chunks_fts is populated for free.
    const userId = 'user-1'
    const workspaceId = 'ws-1'
    const documentId = 'doc-1'
    const chunkId = 'chunk-1'
    const embedding = makeEmbedding(0.25)

    sqlite
      .prepare(
        `INSERT INTO users (id, display_name, email_address, locale, timezone, has_completed_onboarding, created_at, updated_at)
         VALUES (?, ?, NULL, 'en', 'UTC', 1, ?, ?)`,
      )
      .run(userId, 'Test User', TS, TS)
    sqlite
      .prepare(
        `INSERT INTO workspaces (id, user_id, name, kind, path, is_archived, continue_enabled, created_at, updated_at, last_accessed_at)
         VALUES (?, ?, 'WS', 'project', ?, 0, 1, ?, ?, ?)`,
      )
      .run(workspaceId, userId, WS_PATH, TS, TS, TS)
    sqlite
      .prepare(
        `INSERT INTO knowledge_documents (id, user_id, workspace_id, relative_path, document_kind, content_hash, file_size_bytes, file_modified_at, chunk_count, parse_status, parse_error_message, indexed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'notes.md', 'markdown', 'hash-1', 100, ?, 1, 'parsed', NULL, ?, ?, ?)`,
      )
      .run(documentId, userId, workspaceId, TS, TS, TS, TS)
    sqlite
      .prepare(
        `INSERT INTO knowledge_chunks (id, document_id, workspace_id, chunk_index, start_char_offset, end_char_offset, chunk_text, chunk_token_estimate, embedding, embedding_model_version, created_at)
         VALUES (?, ?, ?, 0, 0, 20, 'the quick brown fox', 5, ?, 'all-MiniLM-L6-v2/v1', ?)`,
      )
      .run(chunkId, documentId, workspaceId, embedding, TS)
    sqlite
      .prepare(
        `INSERT INTO knowledge_chunks_vec (chunk_id, workspace_id, document_id, embedding) VALUES (?, ?, ?, ?)`,
      )
      .run(chunkId, workspaceId, documentId, embedding)

    // Sanity: FTS matches the chunk before the migration.
    expect(
      sqlite
        .prepare(`SELECT rowid FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH 'brown'`)
        .all().length,
    ).toBe(1)

    // 3. Apply 0038.
    migrations.applyUpTo(db, 38)

    // 4a. Survival + backfill.
    const doc = sqlite.prepare(`SELECT * FROM knowledge_documents WHERE id = ?`).get(documentId) as
      | Record<string, unknown>
      | undefined
    expect(doc).toBeTruthy()
    expect(doc!.source_id).toBe(`kbsrc_${workspaceId}`)
    expect(doc!.scope).toBe('workspace')
    expect(doc!.workspace_id).toBe(workspaceId)
    expect(doc!.relative_path).toBe('notes.md')

    const source = sqlite
      .prepare(`SELECT * FROM knowledge_sources WHERE id = ?`)
      .get(`kbsrc_${workspaceId}`) as Record<string, unknown> | undefined
    expect(source).toBeTruthy()
    expect(source!.scope).toBe('workspace')
    expect(source!.workspace_id).toBe(workspaceId)
    expect(source!.absolute_path).toBe(WS_PATH)

    const chunk = sqlite.prepare(`SELECT * FROM knowledge_chunks WHERE id = ?`).get(chunkId) as
      | Record<string, unknown>
      | undefined
    expect(chunk).toBeTruthy()
    expect(chunk!.chunk_text).toBe('the quick brown fox')
    expect('workspace_id' in chunk!).toBe(false) // column dropped
    expect(Buffer.isBuffer(chunk!.embedding)).toBe(true)
    expect((chunk!.embedding as Buffer).length).toBe(1536)

    // 4b. workspace_id is now NULLABLE on documents (a global doc can be inserted).
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO knowledge_documents (id, user_id, workspace_id, source_id, scope, relative_path, document_kind, content_hash, file_size_bytes, file_modified_at, chunk_count, parse_status, created_at, updated_at)
           VALUES ('doc-global', ?, NULL, ?, 'global', 'g.md', 'markdown', 'h', 1, ?, 0, 'parsed', ?, ?)`,
        )
        .run(userId, `kbsrc_${workspaceId}`, TS, TS, TS),
    ).not.toThrow()

    // 4c. BEHAVIORAL — keyword (FTS) search still returns the chunk post-migration.
    const ftsAfter = sqlite
      .prepare(
        `SELECT c.id AS chunkId FROM knowledge_chunks_fts f
         JOIN knowledge_chunks c ON c.rowid = f.rowid
         WHERE knowledge_chunks_fts MATCH 'brown'`,
      )
      .all() as { chunkId: string }[]
    expect(ftsAfter.map((r) => r.chunkId)).toContain(chunkId)

    // 4d. BEHAVIORAL — vec row now carries source_id (new partition key), and a
    //     nearest-neighbour query still returns the chunk. Exercises the migration's
    //     blob → float[384] bulk copy.
    const vecRow = sqlite
      .prepare(`SELECT source_id FROM knowledge_chunks_vec WHERE chunk_id = ?`)
      .get(chunkId) as { source_id: string } | undefined
    expect(vecRow?.source_id).toBe(`kbsrc_${workspaceId}`)

    const knn = sqlite
      .prepare(
        `SELECT chunk_id, distance FROM knowledge_chunks_vec WHERE embedding MATCH ? AND k = 1 ORDER BY distance`,
      )
      .all(embedding) as { chunk_id: string; distance: number }[]
    expect(knn.length).toBe(1)
    expect(knn[0]!.chunk_id).toBe(chunkId)
    expect(knn[0]!.distance).toBeCloseTo(0, 5)
  })
})

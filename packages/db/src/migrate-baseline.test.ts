// Baseline-integrity test. The squashed `0000_baseline` migration creates the
// full schema in one file — the regular tables via drizzle-kit, plus the
// hand-appended FTS5 + sqlite-vec virtual tables and their sync triggers (chat,
// memory, knowledge). drizzle-kit does NOT model those, so this test is their
// guard: apply the baseline to a fresh DB, confirm the final schema shape, and
// exercise keyword (FTS `MATCH`) + vector (vec KNN) search for ALL THREE search
// domains. If a trigger or virtual table were dropped/mis-wired in the squash,
// the insert would not populate the index and these queries would return empty.
//
// Replaces the retired `migrate-knowledge-sources.test.ts` (the 0038
// data-preservation regression) — 0038 is folded into the baseline, so there is
// no old shape to migrate from; the guarantee that survives is "the baseline's
// search DDL works", which this asserts.

import { describe, it, expect } from 'vitest'
import { getSqliteClient } from './client.js'
import { withTestDatabase } from './test-support/with-test-database.js'

const TS = 1700000000000

// Deterministic 384-dim float32 embedding (1536 bytes). Querying with the same
// vector puts the seeded row at distance 0 — the nearest neighbour.
function makeEmbedding(value: number): Buffer {
  const buf = Buffer.alloc(384 * 4)
  for (let i = 0; i < 384; i++) buf.writeFloatLE(value, i * 4)
  return buf
}

describe('0000_baseline — schema shape + search DDL', () => {
  it('applies to a fresh DB with the final knowledge shape (source_id/scope; no chunk workspace_id)', async () => {
    await withTestDatabase(async (db) => {
      const sqlite = getSqliteClient(db)
      const docCols = (sqlite.prepare(`PRAGMA table_info(knowledge_documents)`).all() as {
        name: string
      }[]).map((c) => c.name)
      expect(docCols).toContain('source_id')
      expect(docCols).toContain('scope')

      const chunkCols = (sqlite.prepare(`PRAGMA table_info(knowledge_chunks)`).all() as {
        name: string
      }[]).map((c) => c.name)
      expect(chunkCols).not.toContain('workspace_id')

      // knowledge_sources registry exists.
      expect(
        sqlite
          .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_sources'`)
          .get(),
      ).toBeTruthy()
    })
  })

  it('chat: FTS trigger populates chat_messages_fts and MATCH returns the row', async () => {
    await withTestDatabase(async (db) => {
      const sqlite = getSqliteClient(db)
      sqlite
        .prepare(
          `INSERT INTO users (id, display_name, locale, timezone, has_completed_onboarding, created_at, updated_at)
           VALUES ('u1', 'U', 'en', 'UTC', 1, ?, ?)`,
        )
        .run(TS, TS)
      sqlite
        .prepare(
          `INSERT INTO workspaces (id, user_id, name, kind, path, is_archived, continue_enabled, created_at, updated_at, last_accessed_at)
           VALUES ('w1', 'u1', 'WS', 'project', '/tmp/ws', 0, 1, ?, ?, ?)`,
        )
        .run(TS, TS, TS)
      sqlite
        .prepare(
          `INSERT INTO chat_sessions (id, user_id, workspace_id, provider_id, title, visibility, is_archived, scope, total_message_count, total_input_tokens, total_output_tokens, started_at, last_message_at, updated_at)
           VALUES ('s1', 'u1', 'w1', 'claude', 'T', 'listed', 0, 'workspace', 0, 0, 0, ?, ?, ?)`,
        )
        .run(TS, TS, TS)
      sqlite
        .prepare(
          `INSERT INTO chat_messages (id, session_id, role, body, started_at, created_at)
           VALUES ('m1', 's1', 'user', 'the quick brown fox', ?, ?)`,
        )
        .run(TS, TS)

      const hits = sqlite
        .prepare(
          `SELECT c.id AS id FROM chat_messages_fts f JOIN chat_messages c ON c.rowid = f.rowid
           WHERE chat_messages_fts MATCH 'brown'`,
        )
        .all() as { id: string }[]
      expect(hits.map((h) => h.id)).toContain('m1')
    })
  })

  it('memory: FTS trigger + vec KNN both return the seeded entry', async () => {
    await withTestDatabase(async (db) => {
      const sqlite = getSqliteClient(db)
      const embedding = makeEmbedding(0.25)
      sqlite
        .prepare(
          `INSERT INTO users (id, display_name, locale, timezone, has_completed_onboarding, created_at, updated_at)
           VALUES ('u1', 'U', 'en', 'UTC', 1, ?, ?)`,
        )
        .run(TS, TS)
      sqlite
        .prepare(
          `INSERT INTO workspaces (id, user_id, name, kind, path, is_archived, continue_enabled, created_at, updated_at, last_accessed_at)
           VALUES ('w1', 'u1', 'WS', 'project', '/tmp/ws', 0, 1, ?, ?, ?)`,
        )
        .run(TS, TS, TS)
      sqlite
        .prepare(
          `INSERT INTO memory_entries (id, user_id, workspace_id, kind, title, body, category, section, created_source, is_archived, created_at, updated_at)
           VALUES ('e1', 'u1', 'w1', 'fact', 'Title', 'the quick brown fox', 'context', 'general', 'user', 0, ?, ?)`,
        )
        .run(TS, TS)
      sqlite
        .prepare(`INSERT INTO memory_entries_vec (entryId, workspaceId, embedding) VALUES ('e1', 'w1', ?)`)
        .run(embedding)

      const fts = sqlite
        .prepare(
          `SELECT e.id AS id FROM memory_entries_fts f JOIN memory_entries e ON e.rowid = f.rowid
           WHERE memory_entries_fts MATCH 'brown'`,
        )
        .all() as { id: string }[]
      expect(fts.map((h) => h.id)).toContain('e1')

      const knn = sqlite
        .prepare(
          `SELECT entryId, distance FROM memory_entries_vec WHERE embedding MATCH ? AND k = 1 ORDER BY distance`,
        )
        .all(embedding) as { entryId: string; distance: number }[]
      expect(knn.length).toBe(1)
      expect(knn[0]!.entryId).toBe('e1')
      expect(knn[0]!.distance).toBeCloseTo(0, 5)
    })
  })

  it('knowledge: FTS trigger + source-keyed vec KNN both return the seeded chunk', async () => {
    await withTestDatabase(async (db) => {
      const sqlite = getSqliteClient(db)
      const embedding = makeEmbedding(0.5)
      sqlite
        .prepare(
          `INSERT INTO users (id, display_name, locale, timezone, has_completed_onboarding, created_at, updated_at)
           VALUES ('u1', 'U', 'en', 'UTC', 1, ?, ?)`,
        )
        .run(TS, TS)
      sqlite
        .prepare(
          `INSERT INTO workspaces (id, user_id, name, kind, path, is_archived, continue_enabled, created_at, updated_at, last_accessed_at)
           VALUES ('w1', 'u1', 'WS', 'project', '/tmp/ws', 0, 1, ?, ?, ?)`,
        )
        .run(TS, TS, TS)
      sqlite
        .prepare(
          `INSERT INTO knowledge_sources (id, user_id, workspace_id, scope, absolute_path, created_at, updated_at)
           VALUES ('src1', 'u1', 'w1', 'workspace', '/tmp/ws', ?, ?)`,
        )
        .run(TS, TS)
      sqlite
        .prepare(
          `INSERT INTO knowledge_documents (id, user_id, workspace_id, source_id, scope, relative_path, document_kind, content_hash, file_size_bytes, file_modified_at, chunk_count, parse_status, created_at, updated_at)
           VALUES ('doc1', 'u1', 'w1', 'src1', 'workspace', 'notes.md', 'markdown', 'h', 100, ?, 1, 'parsed', ?, ?)`,
        )
        .run(TS, TS, TS)
      sqlite
        .prepare(
          `INSERT INTO knowledge_chunks (id, document_id, chunk_index, start_char_offset, end_char_offset, chunk_text, chunk_token_estimate, embedding, embedding_model_version, created_at)
           VALUES ('ch1', 'doc1', 0, 0, 20, 'the quick brown fox', 5, ?, 'all-MiniLM-L6-v2/v1', ?)`,
        )
        .run(embedding, TS)
      sqlite
        .prepare(
          `INSERT INTO knowledge_chunks_vec (chunk_id, source_id, document_id, embedding) VALUES ('ch1', 'src1', 'doc1', ?)`,
        )
        .run(embedding)

      const fts = sqlite
        .prepare(
          `SELECT c.id AS id FROM knowledge_chunks_fts f JOIN knowledge_chunks c ON c.rowid = f.rowid
           WHERE knowledge_chunks_fts MATCH 'brown'`,
        )
        .all() as { id: string }[]
      expect(fts.map((h) => h.id)).toContain('ch1')

      const knn = sqlite
        .prepare(
          `SELECT chunk_id, distance FROM knowledge_chunks_vec WHERE embedding MATCH ? AND k = 1 ORDER BY distance`,
        )
        .all(embedding) as { chunk_id: string; distance: number }[]
      expect(knn.length).toBe(1)
      expect(knn[0]!.chunk_id).toBe('ch1')
      expect(knn[0]!.distance).toBeCloseTo(0, 5)
    })
  })
})

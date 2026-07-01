-- knowledge_chunks_vec: sqlite-vec virtual table for semantic search over
-- chunk embeddings. Stores the 384-dimension MiniLM-L6-v2 embeddings keyed
-- by chunk_id. Per `docs/blueprints/knowledge/blueprint.md §3.4` +
-- decisions D15 + D23.
--
-- Requires the sqlite-vec extension loaded at the connection level —
-- handled in `packages/db/src/client.ts` via better-sqlite3's
-- `loadExtension(...)` against the bundled binary from the `sqlite-vec`
-- npm package. Memory shipped the extension load with its first vec0
-- table (0010); knowledge reuses the existing extension load.
--
-- sqlite-vec does NOT honor SQL FK constraints or triggers — every write
-- into knowledge_chunks_vec is explicit code (`upsertVectorIndexForChunk`,
-- `deleteVectorIndexForDocument` in `packages/db/src/repositories/
-- knowledge/search.ts`). Maintenance on knowledge_chunks deletes is
-- handled in the same transaction by `removeFileFromIndex` calling
-- `deleteVectorIndexForDocument(tx, documentId)`.
--
-- The `document_id` column lets `removeFileFromIndex` purge a document's
-- vec rows in one statement (without joining back to knowledge_chunks).
--
-- Phase 2 Postgres ships `pgvector` with a `vector(384)` column on
-- knowledge_chunks directly (no separate virtual table); the dialect
-- branch in packages/db/src/repositories/knowledge/search.ts is the
-- seam.

CREATE VIRTUAL TABLE knowledge_chunks_vec USING vec0(
  chunk_id TEXT PRIMARY KEY,
  workspace_id TEXT,
  document_id TEXT,
  embedding float[384]
);

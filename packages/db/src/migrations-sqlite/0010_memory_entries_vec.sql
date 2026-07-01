-- memory_entries_vec: sqlite-vec virtual table for semantic search.
-- Stores the 384-dimension MiniLM-L6-v2 embeddings keyed by entryId.
-- Per `docs/blueprints/memory/blueprint.md §3.4` + decisions D18.
--
-- Requires the sqlite-vec extension loaded at the connection level —
-- handled in `packages/db/src/client.ts` via better-sqlite3's
-- `loadExtension(...)` against the bundled binary from the `sqlite-vec`
-- npm package. Without the extension load, this CREATE will fail at
-- migration time with `no such module: vec0`.
--
-- sqlite-vec does NOT honor SQL FK constraints or triggers — every
-- write into memory_entries_vec is explicit code (`upsertVectorIndex`,
-- `deleteVectorIndex` in `packages/db/src/repositories/memory/memory-search.ts`).
-- Maintenance on `memory_entries.deletedAt` flips is handled by
-- `deleteMemoryEntry` calling `deleteVectorIndex(tx, entryId)` inside
-- the same transaction.
--
-- Phase 2 Postgres ships `pgvector` with a `vector(384)` column on
-- memory_entries directly (no separate virtual table); the dialect
-- branch in memory-search.ts is the seam.

CREATE VIRTUAL TABLE memory_entries_vec USING vec0(
  entryId TEXT PRIMARY KEY,
  workspaceId TEXT,
  embedding float[384]
);

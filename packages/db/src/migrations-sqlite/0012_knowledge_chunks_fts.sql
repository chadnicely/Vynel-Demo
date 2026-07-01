-- knowledge_chunks_fts: FTS5 external-content virtual table for full-text
-- search over indexed chunk text. Per `docs/blueprints/knowledge/blueprint.md
-- §3.3` + chat D17 (post-fix trigger pattern) + memory precedent.
--
-- External-content pattern: FTS5 reads chunk_text from knowledge_chunks via
-- rowid; no content duplication. Triggers MUST pass the indexed column
-- explicitly in the INSERT (the rowid-only form fails — chat hit this in
-- 0005 and fixed in 0006; memory + knowledge adopt the post-fix pattern
-- from day one).
--
-- ONLY the indexed column (chunk_text) is declared on the FTS5 table.
-- The blueprint §3.3's UNINDEXED columns (chunk_id / workspace_id /
-- document_id) are dropped from this migration: external-content FTS5
-- requires UNINDEXED column names to EXIST as columns in the source
-- table (FTS5 fetches their values via rowid lookup against the source).
-- The source `knowledge_chunks` table's primary key is `id` not
-- `chunk_id`, so `chunk_id UNINDEXED` fails at query time with "no such
-- column: T.chunk_id". The metadata is retrieved via a JOIN back to
-- knowledge_chunks (same pattern memory uses for entryId/title/body via
-- the rowid JOIN).
--
-- Workspace scoping + documentKind filtering happen in the search query
-- (JOINs against knowledge_chunks + knowledge_documents).
--
-- Phase 2 Postgres ships a tsvector + GIN index equivalent in a separate
-- migrations-postgres/ file; the dialect branch in
-- packages/db/src/repositories/knowledge/search.ts is the seam.

CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(
  chunk_text,
  content='knowledge_chunks',
  content_rowid='rowid'
);
--> statement-breakpoint
CREATE TRIGGER knowledge_chunks_fts_insert AFTER INSERT ON knowledge_chunks BEGIN
  INSERT INTO knowledge_chunks_fts(rowid, chunk_text) VALUES (new.rowid, new.chunk_text);
END;
--> statement-breakpoint
CREATE TRIGGER knowledge_chunks_fts_delete AFTER DELETE ON knowledge_chunks BEGIN
  INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, chunk_text) VALUES ('delete', old.rowid, old.chunk_text);
END;
--> statement-breakpoint
CREATE TRIGGER knowledge_chunks_fts_update AFTER UPDATE OF chunk_text ON knowledge_chunks BEGIN
  INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, chunk_text) VALUES ('delete', old.rowid, old.chunk_text);
  INSERT INTO knowledge_chunks_fts(rowid, chunk_text) VALUES (new.rowid, new.chunk_text);
END;

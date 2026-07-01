-- memory_entries_fts: FTS5 external-content virtual table for full-text
-- search across memory entries (title + body). Per
-- `docs/blueprints/memory/blueprint.md §3.3` + decisions D17/D18.
--
-- External-content pattern: FTS5 reads title + body from memory_entries
-- via rowid; no content duplication. Triggers MUST pass the indexed
-- columns explicitly in the INSERT (the rowid-only form fails to
-- populate the FTS5 b-tree — chat hit this bug in 0005 and fixed it in
-- 0006; memory adopts the post-fix pattern from day one).
--
-- Workspace scoping + archived/soft-delete filtering happens by JOIN
-- against memory_entries in the search query (same shape as chat-search.ts).
-- Snippet column indexes are 0 (title) and 1 (body) — no UNINDEXED
-- columns in the FTS table.
--
-- Phase 2 Postgres ships a tsvector + GIN index equivalent in a separate
-- migrations-postgres/ file; the dialect branch in memory-search.ts is
-- the seam.

CREATE VIRTUAL TABLE memory_entries_fts USING fts5(
  title,
  body,
  content='memory_entries',
  content_rowid='rowid'
);
--> statement-breakpoint
CREATE TRIGGER memory_entries_fts_insert AFTER INSERT ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
--> statement-breakpoint
CREATE TRIGGER memory_entries_fts_delete AFTER DELETE ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(memory_entries_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
END;
--> statement-breakpoint
CREATE TRIGGER memory_entries_fts_update AFTER UPDATE OF title, body ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(memory_entries_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO memory_entries_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

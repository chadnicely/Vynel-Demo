-- chat_messages_fts: FTS5 external-content virtual table for full-text search
-- across chat messages. Per `docs/blueprints/chat/blueprint.md §3.4` + D17.
--
-- External-content pattern: FTS5 reads body from chat_messages via rowid; no
-- content duplication. Triggers pass ONLY rowid (the explicit-column INSERT
-- form does not work with external content). `snippet()` highlighting still
-- works because FTS5 reads body from the source table via the link.
--
-- Phase 2 Postgres ships a tsvector + GIN index equivalent in a separate
-- migrations-postgres/ file; the dialect branch in searchChatMessages is
-- the seam.

CREATE VIRTUAL TABLE chat_messages_fts USING fts5(
  body,
  content='chat_messages',
  content_rowid='rowid'
);
--> statement-breakpoint
CREATE TRIGGER chat_messages_fts_insert AFTER INSERT ON chat_messages BEGIN
  INSERT INTO chat_messages_fts(rowid) VALUES (new.rowid);
END;
--> statement-breakpoint
CREATE TRIGGER chat_messages_fts_delete AFTER DELETE ON chat_messages BEGIN
  INSERT INTO chat_messages_fts(chat_messages_fts, rowid) VALUES ('delete', old.rowid);
END;
--> statement-breakpoint
CREATE TRIGGER chat_messages_fts_update AFTER UPDATE OF body ON chat_messages BEGIN
  INSERT INTO chat_messages_fts(chat_messages_fts, rowid) VALUES ('delete', old.rowid);
  INSERT INTO chat_messages_fts(rowid) VALUES (new.rowid);
END;

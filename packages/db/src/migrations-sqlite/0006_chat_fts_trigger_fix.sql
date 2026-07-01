-- Fix FTS5 triggers: include `body` column in INSERT, not just rowid.
-- The rowid-only form fails to populate the FTS5 index for external-content
-- tables (FTS5 still needs the indexed values at insert time; the "external"
-- part means it does not store its own copy of the content, but the b-tree
-- index still needs the data passed explicitly).
--
-- The correct external-content trigger pattern per SQLite FTS5 docs:
--   INSERT INTO fts(rowid, indexed_col) VALUES (new.rowid, new.indexed_col)
--   INSERT INTO fts(fts, rowid, indexed_col) VALUES ('delete', old.rowid, old.indexed_col)
--
-- See blueprint §3.4 + D17. The 0005 migration's rowid-only triggers are
-- replaced wholesale here (drop + recreate). Failing chat-search tests
-- (`returns matches scoped to the given workspaceId` etc.) surfaced the bug.

DROP TRIGGER IF EXISTS chat_messages_fts_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS chat_messages_fts_delete;
--> statement-breakpoint
DROP TRIGGER IF EXISTS chat_messages_fts_update;
--> statement-breakpoint
CREATE TRIGGER chat_messages_fts_insert AFTER INSERT ON chat_messages BEGIN
  INSERT INTO chat_messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
--> statement-breakpoint
CREATE TRIGGER chat_messages_fts_delete AFTER DELETE ON chat_messages BEGIN
  INSERT INTO chat_messages_fts(chat_messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;
--> statement-breakpoint
CREATE TRIGGER chat_messages_fts_update AFTER UPDATE OF body ON chat_messages BEGIN
  INSERT INTO chat_messages_fts(chat_messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO chat_messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;

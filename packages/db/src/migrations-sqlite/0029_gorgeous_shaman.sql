PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`category` text NOT NULL,
	`section` text NOT NULL,
	`source_message_id` text,
	`created_source` text NOT NULL,
	`embedding` blob,
	`embedding_model_version` text,
	`is_archived` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_mentioned_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_memory_entries`("id", "user_id", "workspace_id", "kind", "title", "body", "category", "section", "source_message_id", "created_source", "embedding", "embedding_model_version", "is_archived", "created_at", "updated_at", "last_mentioned_at", "deleted_at") SELECT "id", "user_id", "workspace_id", "kind", "title", "body", "category", "section", "source_message_id", "created_source", "embedding", "embedding_model_version", "is_archived", "created_at", "updated_at", "last_mentioned_at", "deleted_at" FROM `memory_entries`;--> statement-breakpoint
DROP TABLE `memory_entries`;--> statement-breakpoint
ALTER TABLE `__new_memory_entries` RENAME TO `memory_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_memory_entries_user` ON `memory_entries` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_workspace_kind` ON `memory_entries` (`workspace_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_workspace_archived` ON `memory_entries` (`workspace_id`,`is_archived`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_last_mentioned` ON `memory_entries` (`workspace_id`,`last_mentioned_at`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_deleted_at` ON `memory_entries` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_source_message` ON `memory_entries` (`source_message_id`);--> statement-breakpoint
-- The rebuild above (drizzle's only way to drop a NOT NULL in SQLite) DROPs
-- `memory_entries` — and SQLite drops that table's triggers with it. The
-- baseline's external-content FTS5 index lives on those triggers, so without
-- this block keyword search silently stops seeing new memories forever, and
-- the surviving index rows point at rowids the INSERT…SELECT reassigned.
-- Recreate the triggers verbatim from `0000_baseline.sql`, then resync.
-- (`memory_entries_vec` is keyed by entryId, not rowid, so it is unaffected.)
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
--> statement-breakpoint
INSERT INTO memory_entries_fts(memory_entries_fts) VALUES('rebuild');

-- Knowledge scope + sources. Adds the `knowledge_sources` registry (workspace /
-- global scope), gives `knowledge_documents` a `source_id` + `scope` (and makes
-- `workspace_id` nullable for global docs), drops the now-dead
-- `knowledge_chunks.workspace_id`, and rebuilds the FTS + vec search indices to
-- match. Search partitions by SOURCE (resolved via the document join), fusing a
-- workspace's sources + the user's global sources.
-- See docs/module-notes/knowledge-scope-sources.md.
--
-- DATA-PRESERVING. Existing per-workspace documents/chunks are backfilled onto an
-- auto-created 'workspace' source per workspace (deterministic id
-- 'kbsrc_' || workspace_id, absolute_path = the workspace folder). Embeddings are
-- COPIED from the stored blob (never recomputed). FK enforcement is disabled at the
-- connection level by `runMigrations` for the whole run (the inline PRAGMAs below
-- are drizzle-generated no-ops inside its transaction — 0029 precedent). Regression-
-- tested on a POPULATED old-shape DB in `migrate-knowledge-sources.test.ts`.

CREATE TABLE `knowledge_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`scope` text NOT NULL,
	`absolute_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_sources_user` ON `knowledge_sources` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_sources_workspace` ON `knowledge_sources` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_knowledge_sources_workspace_path` ON `knowledge_sources` (`workspace_id`,`absolute_path`) WHERE "knowledge_sources"."scope" = 'workspace';--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_knowledge_sources_global_path` ON `knowledge_sources` (`user_id`,`absolute_path`) WHERE "knowledge_sources"."scope" = 'global';--> statement-breakpoint
INSERT INTO `knowledge_sources` (`id`, `user_id`, `workspace_id`, `scope`, `absolute_path`, `created_at`, `updated_at`) SELECT DISTINCT 'kbsrc_' || d.`workspace_id`, d.`user_id`, d.`workspace_id`, 'workspace', w.`path`, 1782974058276, 1782974058276 FROM `knowledge_documents` d JOIN `workspaces` w ON w.`id` = d.`workspace_id`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_knowledge_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`source_id` text NOT NULL,
	`scope` text DEFAULT 'workspace' NOT NULL,
	`relative_path` text NOT NULL,
	`document_kind` text NOT NULL,
	`content_hash` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`file_modified_at` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`parse_status` text NOT NULL,
	`parse_error_message` text,
	`indexed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `knowledge_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_knowledge_documents`("id", "user_id", "workspace_id", "source_id", "scope", "relative_path", "document_kind", "content_hash", "file_size_bytes", "file_modified_at", "chunk_count", "parse_status", "parse_error_message", "indexed_at", "created_at", "updated_at") SELECT "id", "user_id", "workspace_id", 'kbsrc_' || "workspace_id", 'workspace', "relative_path", "document_kind", "content_hash", "file_size_bytes", "file_modified_at", "chunk_count", "parse_status", "parse_error_message", "indexed_at", "created_at", "updated_at" FROM `knowledge_documents`;--> statement-breakpoint
DROP TABLE `knowledge_documents`;--> statement-breakpoint
ALTER TABLE `__new_knowledge_documents` RENAME TO `knowledge_documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_knowledge_documents_user` ON `knowledge_documents` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_documents_workspace` ON `knowledge_documents` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_documents_workspace_status` ON `knowledge_documents` (`workspace_id`,`parse_status`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_documents_workspace_indexed_at` ON `knowledge_documents` (`workspace_id`,`indexed_at`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_documents_source` ON `knowledge_documents` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_knowledge_documents_source_path` ON `knowledge_documents` (`source_id`,`relative_path`);--> statement-breakpoint
DROP INDEX `idx_knowledge_chunks_workspace`;--> statement-breakpoint
ALTER TABLE `knowledge_chunks` DROP COLUMN `workspace_id`;--> statement-breakpoint
INSERT INTO `knowledge_chunks_fts`(`knowledge_chunks_fts`) VALUES('rebuild');--> statement-breakpoint
DROP TABLE `knowledge_chunks_vec`;--> statement-breakpoint
CREATE VIRTUAL TABLE `knowledge_chunks_vec` USING vec0(
  chunk_id TEXT PRIMARY KEY,
  source_id TEXT,
  document_id TEXT,
  embedding float[384]
);--> statement-breakpoint
INSERT INTO `knowledge_chunks_vec` (chunk_id, source_id, document_id, embedding) SELECT c.`id`, d.`source_id`, c.`document_id`, c.`embedding` FROM `knowledge_chunks` c JOIN `knowledge_documents` d ON d.`id` = c.`document_id` WHERE c.`embedding` IS NOT NULL;
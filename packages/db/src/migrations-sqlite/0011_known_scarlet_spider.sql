CREATE TABLE `knowledge_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`document_kind` text NOT NULL,
	`content_hash` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`file_modified_at` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`parse_status` text NOT NULL,
	`parse_error_message` text,
	`is_identity_file` integer NOT NULL,
	`indexed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_documents_workspace` ON `knowledge_documents` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_documents_workspace_status` ON `knowledge_documents` (`workspace_id`,`parse_status`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_documents_workspace_indexed_at` ON `knowledge_documents` (`workspace_id`,`indexed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_knowledge_documents_workspace_path` ON `knowledge_documents` (`workspace_id`,`relative_path`);--> statement-breakpoint
CREATE TABLE `knowledge_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`start_char_offset` integer NOT NULL,
	`end_char_offset` integer NOT NULL,
	`chunk_text` text NOT NULL,
	`chunk_token_estimate` integer NOT NULL,
	`embedding` blob,
	`embedding_model_version` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_chunks_document` ON `knowledge_chunks` (`document_id`,`chunk_index`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_chunks_workspace` ON `knowledge_chunks` (`workspace_id`);
CREATE TABLE `memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`identity_file_kind` text NOT NULL,
	`identity_file_section` text NOT NULL,
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
CREATE INDEX `idx_memory_entries_workspace_kind` ON `memory_entries` (`workspace_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_workspace_archived` ON `memory_entries` (`workspace_id`,`is_archived`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_last_mentioned` ON `memory_entries` (`workspace_id`,`last_mentioned_at`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_deleted_at` ON `memory_entries` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_source_message` ON `memory_entries` (`source_message_id`);--> statement-breakpoint
CREATE TABLE `memory_entry_mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_entry_id` text NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`mention_kind` text NOT NULL,
	`mentioned_at` integer NOT NULL,
	FOREIGN KEY (`memory_entry_id`) REFERENCES `memory_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_memory_entry_mentions_entry` ON `memory_entry_mentions` (`memory_entry_id`,`mentioned_at`);--> statement-breakpoint
CREATE INDEX `idx_memory_entry_mentions_session` ON `memory_entry_mentions` (`session_id`);
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`provider_id` text NOT NULL,
	`model` text,
	`title` text NOT NULL,
	`visibility` text DEFAULT 'listed' NOT NULL,
	`is_archived` integer NOT NULL,
	`deleted_at` integer,
	`total_message_count` integer NOT NULL,
	`total_input_tokens` integer NOT NULL,
	`total_output_tokens` integer NOT NULL,
	`started_at` integer NOT NULL,
	`last_message_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_chat_sessions`("id", "user_id", "workspace_id", "provider_id", "model", "title", "visibility", "is_archived", "deleted_at", "total_message_count", "total_input_tokens", "total_output_tokens", "started_at", "last_message_at", "updated_at") SELECT "id", "user_id", "workspace_id", "provider_id", "model", "title", "visibility", "is_archived", "deleted_at", "total_message_count", "total_input_tokens", "total_output_tokens", "started_at", "last_message_at", "updated_at" FROM `chat_sessions`;--> statement-breakpoint
DROP TABLE `chat_sessions`;--> statement-breakpoint
ALTER TABLE `__new_chat_sessions` RENAME TO `chat_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_user` ON `chat_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_workspace_archived` ON `chat_sessions` (`workspace_id`,`is_archived`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_workspace_deleted_at` ON `chat_sessions` (`workspace_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_last_message_at` ON `chat_sessions` ("last_message_at" desc);--> statement-breakpoint
CREATE TABLE `__new_root_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`scope` text DEFAULT 'workspace' NOT NULL,
	`current_sdk_session_id` text,
	`superseded_from_sdk_session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_root_sessions`("id", "user_id", "workspace_id", "current_sdk_session_id", "superseded_from_sdk_session_id", "created_at", "updated_at", "deleted_at") SELECT "id", "user_id", "workspace_id", "current_sdk_session_id", "superseded_from_sdk_session_id", "created_at", "updated_at", "deleted_at" FROM `root_sessions`;--> statement-breakpoint
DROP TABLE `root_sessions`;--> statement-breakpoint
ALTER TABLE `__new_root_sessions` RENAME TO `root_sessions`;--> statement-breakpoint
CREATE INDEX `idx_root_sessions_user` ON `root_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_root_sessions_workspace` ON `root_sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_root_sessions_deleted_at` ON `root_sessions` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_root_sessions_user_workspace` ON `root_sessions` (`user_id`,`workspace_id`) WHERE "root_sessions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_root_sessions_global_user` ON `root_sessions` (`user_id`) WHERE "root_sessions"."scope" = 'global' AND "root_sessions"."deleted_at" IS NULL;
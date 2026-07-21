PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_delegation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`parent_session_id` text NOT NULL,
	`workspace_id` text,
	`workspace_path` text,
	`workspace_name` text,
	`target_primary_session_id` text,
	`task_text` text NOT NULL,
	`partial_session_id` text,
	`status` text NOT NULL,
	`claimed_at` integer,
	`completed_at` integer,
	`result_text` text,
	`error_message` text,
	`surfaced_to_root_at` integer,
	`origin_channel_id` text,
	`origin_external_sender_id` text,
	`origin_external_chat_context_id` text,
	`permission_mode` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_delegation_jobs`("id", "user_id", "parent_session_id", "workspace_id", "workspace_path", "workspace_name", "target_primary_session_id", "task_text", "partial_session_id", "status", "claimed_at", "completed_at", "result_text", "error_message", "surfaced_to_root_at", "origin_channel_id", "origin_external_sender_id", "origin_external_chat_context_id", "permission_mode", "created_at") SELECT "id", "user_id", "parent_session_id", "workspace_id", "workspace_path", "workspace_name", NULL, "task_text", "partial_session_id", "status", "claimed_at", "completed_at", "result_text", "error_message", "surfaced_to_root_at", "origin_channel_id", "origin_external_sender_id", "origin_external_chat_context_id", "permission_mode", "created_at" FROM `delegation_jobs`;--> statement-breakpoint
DROP TABLE `delegation_jobs`;--> statement-breakpoint
ALTER TABLE `__new_delegation_jobs` RENAME TO `delegation_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_delegation_jobs_status_created` ON `delegation_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_delegation_jobs_user` ON `delegation_jobs` (`user_id`);
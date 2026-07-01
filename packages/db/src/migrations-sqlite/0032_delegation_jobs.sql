CREATE TABLE `delegation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`parent_session_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`workspace_path` text NOT NULL,
	`workspace_name` text NOT NULL,
	`task_text` text NOT NULL,
	`partial_session_id` text,
	`status` text NOT NULL,
	`claimed_at` integer,
	`completed_at` integer,
	`result_text` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_delegation_jobs_status_created` ON `delegation_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_delegation_jobs_user` ON `delegation_jobs` (`user_id`);
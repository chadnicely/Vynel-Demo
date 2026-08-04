CREATE TABLE `session_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope_kind` text NOT NULL,
	`workspace_id` text,
	`origin` text NOT NULL,
	`session_id` text,
	`primary_session_id` text,
	`job_id` text,
	`thread_id` text,
	`partial_session_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`ended_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_turns_user_ended` ON `session_turns` (`user_id`,`ended_at`);--> statement-breakpoint
CREATE INDEX `idx_session_turns_job` ON `session_turns` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_session_turns_primary_started` ON `session_turns` (`primary_session_id`,`started_at`);
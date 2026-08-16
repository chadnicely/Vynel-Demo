CREATE TABLE `background_processes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`owner_kind` text NOT NULL,
	`owner_session_id` text,
	`command` text NOT NULL,
	`cwd_path` text NOT NULL,
	`status` text NOT NULL,
	`pid` integer,
	`exit_code` integer,
	`failure_reason` text,
	`output_tail` text,
	`timeout_ms` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_background_processes_user_workspace` ON `background_processes` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_background_processes_user_status` ON `background_processes` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_background_processes_status` ON `background_processes` (`status`);
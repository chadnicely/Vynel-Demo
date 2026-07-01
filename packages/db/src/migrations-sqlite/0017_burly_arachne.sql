CREATE TABLE `file_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`activity_kind` text NOT NULL,
	`editor` text NOT NULL,
	`relative_path` text NOT NULL,
	`from_path` text,
	`file_size_bytes` integer,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_file_activities_workspace_occurred_at` ON `file_activities` (`workspace_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_file_activities_workspace_path_occurred_at` ON `file_activities` (`workspace_id`,`relative_path`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_file_activities_user` ON `file_activities` (`user_id`);
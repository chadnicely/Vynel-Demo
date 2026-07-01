CREATE TABLE `root_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`current_sdk_session_id` text,
	`superseded_from_sdk_session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_root_sessions_user` ON `root_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_root_sessions_workspace` ON `root_sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_root_sessions_deleted_at` ON `root_sessions` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_root_sessions_user_workspace` ON `root_sessions` (`user_id`,`workspace_id`) WHERE "root_sessions"."deleted_at" IS NULL;
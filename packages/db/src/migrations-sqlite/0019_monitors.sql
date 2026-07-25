CREATE TABLE `monitors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`owner_kind` text NOT NULL,
	`owner_session_id` text,
	`description` text NOT NULL,
	`event_types` text NOT NULL,
	`payload_filter` text,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_checked_at` integer NOT NULL,
	`fired_count` integer NOT NULL,
	`last_fired_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_monitors_status_checked` ON `monitors` (`status`,`last_checked_at`);--> statement-breakpoint
CREATE INDEX `idx_monitors_user_workspace` ON `monitors` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_monitors_user_status` ON `monitors` (`user_id`,`status`);
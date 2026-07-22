CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`detail` text,
	`plan_date` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`session_id` text,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_plans_user_workspace` ON `plans` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_plans_user_date` ON `plans` (`user_id`,`plan_date`);--> statement-breakpoint
CREATE INDEX `idx_plans_user_status` ON `plans` (`user_id`,`status`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `plan_id` text;
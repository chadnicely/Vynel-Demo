CREATE TABLE `task_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`task_id` text NOT NULL,
	`plan_id` text,
	`session_id` text,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`order_index` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_task_steps_user_task` ON `task_steps` (`user_id`,`task_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `assigned_session_id` text;--> statement-breakpoint
ALTER TABLE `plans` ADD `task_id` text;
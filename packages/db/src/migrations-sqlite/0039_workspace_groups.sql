CREATE TABLE `workspace_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_groups_user_id` ON `workspace_groups` (`user_id`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `group_id` text;
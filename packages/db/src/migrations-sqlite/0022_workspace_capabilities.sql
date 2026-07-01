CREATE TABLE `workspace_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`capability_id` text NOT NULL,
	`is_enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_capabilities_workspace` ON `workspace_capabilities` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_workspace_capabilities_user` ON `workspace_capabilities` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_workspace_capabilities_workspace_capability` ON `workspace_capabilities` (`workspace_id`,`capability_id`);
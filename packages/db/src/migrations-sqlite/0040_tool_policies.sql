CREATE TABLE `tool_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`enabled` integer,
	`card_class` text,
	`surfaces_json` text,
	`feature_key` text,
	`capability_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tool_policies_user` ON `tool_policies` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_tool_policies_user_tool` ON `tool_policies` (`user_id`,`tool_name`);
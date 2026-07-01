CREATE TABLE `provider_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`is_default` integer NOT NULL,
	`default_settings` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_provider_preferences_user_id` ON `provider_preferences` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_provider_preferences_user_provider` ON `provider_preferences` (`user_id`,`provider_id`);
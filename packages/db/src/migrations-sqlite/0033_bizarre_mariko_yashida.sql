CREATE TABLE `desktop_app_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`app_name` text NOT NULL,
	`tier` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_desktop_app_grants_user` ON `desktop_app_grants` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_desktop_app_grants_user_app` ON `desktop_app_grants` (`user_id`,`app_name`);
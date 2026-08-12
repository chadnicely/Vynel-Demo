CREATE TABLE `desktop_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`goal` text,
	`tool` text NOT NULL,
	`app_name` text,
	`detail` text NOT NULL,
	`outcome` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `desktop_actions_user_created_idx` ON `desktop_actions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `desktop_actions_session_idx` ON `desktop_actions` (`session_id`);
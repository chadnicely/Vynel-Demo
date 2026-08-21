CREATE TABLE `display_widgets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope_key` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`slot` text NOT NULL,
	`size` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_by_session_id` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_display_widgets_user_scope_order` ON `display_widgets` (`user_id`,`scope_key`,`sort_order`);
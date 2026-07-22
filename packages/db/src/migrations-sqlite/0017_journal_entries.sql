CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`entry_date` text NOT NULL,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_journal_entries_user_workspace` ON `journal_entries` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_journal_entries_user_date` ON `journal_entries` (`user_id`,`entry_date`);
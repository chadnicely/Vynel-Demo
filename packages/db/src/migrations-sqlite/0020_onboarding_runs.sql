CREATE TABLE `onboarding_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`current_step_kind` text NOT NULL,
	`completed_steps` text NOT NULL,
	`collected_data` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_onboarding_runs_user` ON `onboarding_runs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_onboarding_runs_status` ON `onboarding_runs` (`status`);
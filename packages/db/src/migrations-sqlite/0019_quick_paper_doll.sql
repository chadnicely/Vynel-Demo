CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`template_kind` text NOT NULL,
	`display_name` text NOT NULL,
	`cron_expression` text NOT NULL,
	`timezone` text NOT NULL,
	`prompt_template` text NOT NULL,
	`destination_kind` text NOT NULL,
	`channel_id` text,
	`catch_up_on_miss` integer NOT NULL,
	`is_enabled` integer NOT NULL,
	`approval_timeout_ms_override` integer,
	`last_fired_at` integer,
	`next_scheduled_fire_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_schedules_user_workspace` ON `schedules` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_schedules_enabled_next_fire` ON `schedules` (`is_enabled`,`next_scheduled_fire_at`);--> statement-breakpoint
CREATE TABLE `schedule_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`scheduled_fire_at` integer NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`chat_session_id` text,
	`status` text NOT NULL,
	`status_message` text,
	`trigger_kind` text NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_schedule_runs_schedule_started` ON `schedule_runs` (`schedule_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_schedule_runs_status` ON `schedule_runs` (`status`);
CREATE TABLE `installed_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`skill_id` text NOT NULL,
	`scope` text NOT NULL,
	`installed_from_source` text NOT NULL,
	`version_installed` text NOT NULL,
	`install_location` text NOT NULL,
	`install_health` text NOT NULL,
	`install_health_message` text,
	`is_enabled` integer NOT NULL,
	`installed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_installed_skills_user` ON `installed_skills` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_installed_skills_workspace` ON `installed_skills` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_installed_skills_user_workspace_skill` ON `installed_skills` (`user_id`,`workspace_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `skill_settings` (
	`installed_skill_id` text NOT NULL,
	`setting_key` text NOT NULL,
	`setting_value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`installed_skill_id`, `setting_key`),
	FOREIGN KEY (`installed_skill_id`) REFERENCES `installed_skills`(`id`) ON UPDATE no action ON DELETE cascade
);

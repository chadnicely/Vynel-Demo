CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`icon` text,
	`prompt` text NOT NULL,
	`model` text,
	`effort` text,
	`permission_mode` text,
	`background` integer NOT NULL,
	`allowed_tools` text,
	`disallowed_tools` text,
	`scope` text NOT NULL,
	`source` text NOT NULL,
	`trust_tier` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agents_user` ON `agents` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_agents_workspace` ON `agents` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_agents_deleted_at` ON `agents` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_agents_user_workspace_slug` ON `agents` (`user_id`,`workspace_id`,`slug`) WHERE "agents"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_agents_user_scope_slug` ON `agents` (`user_id`,`slug`) WHERE "agents"."workspace_id" IS NULL AND "agents"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `agent_skills` (
	`agent_id` text NOT NULL,
	`skill_id` text NOT NULL,
	PRIMARY KEY(`agent_id`, `skill_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);

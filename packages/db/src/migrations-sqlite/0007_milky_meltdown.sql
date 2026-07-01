CREATE TABLE `approval_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`rule_kind` text NOT NULL,
	`description` text NOT NULL,
	`matcher` text NOT NULL,
	`is_enabled` integer NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_approval_rules_workspace_enabled` ON `approval_rules` (`workspace_id`,`is_enabled`);--> statement-breakpoint
CREATE INDEX `idx_approval_rules_workspace_deleted_at` ON `approval_rules` (`workspace_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_approval_rules_user` ON `approval_rules` (`user_id`);--> statement-breakpoint
CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_approval_id` text NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`session_id` text NOT NULL,
	`parent_message_id` text NOT NULL,
	`tool_use_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`action_kind` text NOT NULL,
	`tool_input` text NOT NULL,
	`status` text NOT NULL,
	`resolution_kind` text,
	`resolution_reason` text,
	`resolution_updated_input` text,
	`auto_approved_by_rule_id` text,
	`timeout_ms` integer NOT NULL,
	`requested_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`auto_approved_by_rule_id`) REFERENCES `approval_rules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_approval_requests_provider_approval_id` ON `approval_requests` (`provider_approval_id`);--> statement-breakpoint
CREATE INDEX `idx_approval_requests_session_status` ON `approval_requests` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_approval_requests_workspace_requested_at` ON `approval_requests` (`workspace_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `idx_approval_requests_user` ON `approval_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_approval_requests_status_requested_at` ON `approval_requests` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `idx_approval_requests_tool_use_id` ON `approval_requests` (`tool_use_id`);
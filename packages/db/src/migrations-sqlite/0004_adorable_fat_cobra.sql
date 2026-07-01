CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`title` text NOT NULL,
	`is_archived` integer NOT NULL,
	`deleted_at` integer,
	`total_message_count` integer NOT NULL,
	`total_input_tokens` integer NOT NULL,
	`total_output_tokens` integer NOT NULL,
	`started_at` integer NOT NULL,
	`last_message_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_user` ON `chat_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_workspace_archived` ON `chat_sessions` (`workspace_id`,`is_archived`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_workspace_deleted_at` ON `chat_sessions` (`workspace_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_last_message_at` ON `chat_sessions` ("last_message_at" desc);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`body` text NOT NULL,
	`thinking_body` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`attached_images_metadata` text,
	`error_code` text,
	`error_message` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_session_started` ON `chat_messages` (`session_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_messages_session_role` ON `chat_messages` (`session_id`,`role`);--> statement-breakpoint
CREATE TABLE `chat_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_message_id` text NOT NULL,
	`tool_use_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_input` text NOT NULL,
	`tool_output` text,
	`status` text NOT NULL,
	`approval_status` text,
	`is_error_result` integer NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`parent_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_tool_calls_parent_message` ON `chat_tool_calls` (`parent_message_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_tool_calls_parent_message_started` ON `chat_tool_calls` (`parent_message_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_tool_calls_tool_use_id` ON `chat_tool_calls` (`tool_use_id`);
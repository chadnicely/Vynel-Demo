CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`channel_kind` text NOT NULL,
	`display_name` text NOT NULL,
	`bot_credentials` text NOT NULL,
	`bot_metadata` text NOT NULL,
	`connection_status` text NOT NULL,
	`connection_status_message` text,
	`last_polled_cursor` text,
	`last_polled_at` integer,
	`last_inbound_at` integer,
	`is_enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_channels_user` ON `channels` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_channels_workspace` ON `channels` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_channels_enabled_polling` ON `channels` (`is_enabled`,`last_polled_at`);--> statement-breakpoint
CREATE TABLE `channel_user_links` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`external_sender_id` text NOT NULL,
	`external_sender_handle` text,
	`external_sender_display_name` text,
	`scope_context_id` text,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_channel_user_links_channel` ON `channel_user_links` (`channel_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_channel_user_links_sender` ON `channel_user_links` (`channel_id`,`external_sender_id`,`scope_context_id`);--> statement-breakpoint
CREATE TABLE `channel_inbound_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`external_message_id` text NOT NULL,
	`external_sender_id` text NOT NULL,
	`external_chat_context_id` text NOT NULL,
	`message_body` text NOT NULL,
	`message_metadata` text NOT NULL,
	`intent_kind` text NOT NULL,
	`routed_to_chat_session_id` text,
	`routed_to_approval_request_id` text,
	`status` text NOT NULL,
	`status_message` text,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_channel_inbound_channel_status` ON `channel_inbound_messages` (`channel_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_channel_inbound_pending` ON `channel_inbound_messages` (`status`,`received_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_channel_inbound_external` ON `channel_inbound_messages` (`channel_id`,`external_message_id`);--> statement-breakpoint
CREATE INDEX `idx_channel_inbound_history` ON `channel_inbound_messages` (`channel_id`,`received_at`,`id`);--> statement-breakpoint
CREATE TABLE `channel_message_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`external_recipient_id` text NOT NULL,
	`external_chat_context_id` text NOT NULL,
	`message_body` text NOT NULL,
	`message_structure` text NOT NULL,
	`payload_kind` text NOT NULL,
	`status` text NOT NULL,
	`status_message` text,
	`attempt_count` integer NOT NULL,
	`last_attempted_at` integer,
	`next_attempt_at` integer NOT NULL,
	`external_sent_message_id` text,
	`enqueued_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_channel_queue_ready` ON `channel_message_queue` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_channel_queue_channel_chat` ON `channel_message_queue` (`channel_id`,`external_chat_context_id`,`enqueued_at`);
CREATE TABLE `channel_chat_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`external_chat_context_id` text NOT NULL,
	`title` text,
	`status` text NOT NULL,
	`member_policy` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_inbound_at` integer,
	`approved_at` integer,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_channel_chat_groups_channel_status` ON `channel_chat_groups` (`channel_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_channel_chat_groups_context` ON `channel_chat_groups` (`channel_id`,`external_chat_context_id`);
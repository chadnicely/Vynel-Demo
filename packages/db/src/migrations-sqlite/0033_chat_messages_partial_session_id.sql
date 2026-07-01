ALTER TABLE `chat_messages` ADD `partial_session_id` text;--> statement-breakpoint
CREATE INDEX `idx_chat_messages_partial_started` ON `chat_messages` (`partial_session_id`,`started_at`);
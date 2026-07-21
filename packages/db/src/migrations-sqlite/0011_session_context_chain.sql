ALTER TABLE `chat_sessions` ADD `last_context_tokens` integer;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `continued_from_session_id` text;
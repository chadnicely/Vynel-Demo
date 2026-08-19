ALTER TABLE `chat_sessions` ADD `last_context_window` integer;--> statement-breakpoint
ALTER TABLE `primary_sessions` ADD `pending_checkpoint_next_step` text;--> statement-breakpoint
ALTER TABLE `primary_sessions` ADD `pending_checkpoint_depth` integer;--> statement-breakpoint
ALTER TABLE `primary_sessions` ADD `pending_checkpoint_at` integer;--> statement-breakpoint
ALTER TABLE `primary_sessions` ADD `pending_checkpoint_job_id` text;--> statement-breakpoint
ALTER TABLE `delegation_jobs` ADD `lease_expires_at` integer;--> statement-breakpoint
ALTER TABLE `delegation_jobs` ADD `heartbeat_at` integer;
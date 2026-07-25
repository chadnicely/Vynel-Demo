ALTER TABLE `delegation_jobs` ADD `thread_id` text;--> statement-breakpoint
CREATE INDEX `idx_delegation_jobs_thread` ON `delegation_jobs` (`thread_id`,`created_at`);
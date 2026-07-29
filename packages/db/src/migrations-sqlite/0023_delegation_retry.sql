ALTER TABLE `delegation_jobs` ADD `attempt_count` integer;--> statement-breakpoint
ALTER TABLE `delegation_jobs` ADD `next_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `delegation_jobs` ADD `error_code` text;--> statement-breakpoint
CREATE INDEX `idx_delegation_jobs_ready` ON `delegation_jobs` (`status`,`next_attempt_at`);
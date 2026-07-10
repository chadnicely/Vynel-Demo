CREATE TABLE `memory_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_entry_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`memory_entry_id`) REFERENCES `memory_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_memory_tags_entry` ON `memory_tags` (`memory_entry_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_tags_tag` ON `memory_tags` (`tag`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_memory_tags_entry_tag` ON `memory_tags` (`memory_entry_id`,`tag`);
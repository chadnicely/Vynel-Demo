ALTER TABLE `workspaces` ADD `name` text NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `kind` text NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `path` text NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `is_archived` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `created_at` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `updated_at` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `last_accessed_at` integer NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_workspaces_user_id` ON `workspaces` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_user_id_archived` ON `workspaces` (`user_id`,`is_archived`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_last_accessed_at` ON `workspaces` ("last_accessed_at" desc);
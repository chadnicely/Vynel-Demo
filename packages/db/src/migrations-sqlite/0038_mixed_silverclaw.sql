ALTER TABLE `desktop_actions` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `desktop_actions_workspace_idx` ON `desktop_actions` (`workspace_id`);
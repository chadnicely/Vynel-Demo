CREATE TABLE `instruction_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`workspace_id` text,
	`mode` text DEFAULT 'notebook' NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_instruction_documents_user_mode` ON `instruction_documents` (`user_id`,`mode`);--> statement-breakpoint
CREATE INDEX `idx_instruction_documents_workspace` ON `instruction_documents` (`workspace_id`);
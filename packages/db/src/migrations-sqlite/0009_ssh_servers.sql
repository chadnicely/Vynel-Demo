CREATE TABLE `ssh_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`username` text NOT NULL,
	`auth_kind` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`host_key_fingerprint` text,
	`last_connected_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ssh_servers_user_workspace` ON `ssh_servers` (`user_id`,`workspace_id`);
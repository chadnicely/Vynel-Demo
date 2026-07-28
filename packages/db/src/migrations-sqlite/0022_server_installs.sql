CREATE TABLE `server_installs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`username` text NOT NULL,
	`auth_kind` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`sealed_auth_token` text NOT NULL,
	`host_key_fingerprint` text,
	`status` text NOT NULL,
	`step` text,
	`error_message` text,
	`installed_version` text,
	`last_healthy_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

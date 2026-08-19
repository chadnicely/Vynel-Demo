CREATE TABLE `scope_customizations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope_key` text NOT NULL,
	`accent_color_slot` integer,
	`accent_custom_color` text,
	`persona_color_slot` integer,
	`persona_custom_color` text,
	`persona_image` text,
	`workspace_image` text,
	`menu_layout` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scope_customizations_user_scope_unique` ON `scope_customizations` (`user_id`,`scope_key`);--> statement-breakpoint
CREATE TABLE `tree_layouts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`layout` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tree_layouts_user_unique` ON `tree_layouts` (`user_id`);
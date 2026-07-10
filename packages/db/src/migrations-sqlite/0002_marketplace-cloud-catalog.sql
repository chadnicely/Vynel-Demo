CREATE TABLE `marketplace_cloud_catalog` (
	`item_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`publisher_name` text NOT NULL,
	`publisher_tier` text NOT NULL,
	`publisher_url` text,
	`display_name` text NOT NULL,
	`one_line_description` text NOT NULL,
	`category` text NOT NULL,
	`icon_name` text NOT NULL,
	`recommended_scope` text,
	`minimum_tier` text NOT NULL,
	`latest_version` text NOT NULL,
	`latest_version_sha256` text NOT NULL,
	`released_at` text NOT NULL,
	`synced_at` integer NOT NULL
);

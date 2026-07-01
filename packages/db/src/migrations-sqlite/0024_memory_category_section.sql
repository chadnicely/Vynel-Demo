ALTER TABLE `memory_entries` RENAME COLUMN `identity_file_kind` TO `category`;
--> statement-breakpoint
ALTER TABLE `memory_entries` RENAME COLUMN `identity_file_section` TO `section`;
--> statement-breakpoint
UPDATE `memory_entries` SET `created_source` = 'user-manual' WHERE `created_source` = 'identity-file-derivation';
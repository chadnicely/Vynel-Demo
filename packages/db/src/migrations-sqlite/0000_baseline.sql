CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`email_address` text,
	`locale` text NOT NULL,
	`timezone` text NOT NULL,
	`has_completed_onboarding` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text NOT NULL,
	`preference_key` text NOT NULL,
	`preference_value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `preference_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`manager_name` text,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`is_archived` integer NOT NULL,
	`continue_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_accessed_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workspaces_user_id` ON `workspaces` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_user_id_archived` ON `workspaces` (`user_id`,`is_archived`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_last_accessed_at` ON `workspaces` ("last_accessed_at" desc);--> statement-breakpoint
CREATE TABLE `provider_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`is_default` integer NOT NULL,
	`default_settings` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_provider_preferences_user_id` ON `provider_preferences` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_provider_preferences_user_provider` ON `provider_preferences` (`user_id`,`provider_id`);--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`provider_id` text NOT NULL,
	`model` text,
	`title` text NOT NULL,
	`visibility` text DEFAULT 'listed' NOT NULL,
	`scope` text DEFAULT 'workspace' NOT NULL,
	`is_archived` integer NOT NULL,
	`deleted_at` integer,
	`total_message_count` integer NOT NULL,
	`total_input_tokens` integer NOT NULL,
	`total_output_tokens` integer NOT NULL,
	`started_at` integer NOT NULL,
	`last_message_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_user` ON `chat_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_workspace_archived` ON `chat_sessions` (`workspace_id`,`is_archived`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_workspace_deleted_at` ON `chat_sessions` (`workspace_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_last_message_at` ON `chat_sessions` ("last_message_at" desc);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`body` text NOT NULL,
	`source_kind` text,
	`source_label` text,
	`partial_session_id` text,
	`thinking_body` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`attached_images_metadata` text,
	`error_code` text,
	`error_message` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_session_started` ON `chat_messages` (`session_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_messages_session_role` ON `chat_messages` (`session_id`,`role`);--> statement-breakpoint
CREATE INDEX `idx_chat_messages_partial_started` ON `chat_messages` (`partial_session_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `chat_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_message_id` text NOT NULL,
	`tool_use_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_input` text NOT NULL,
	`tool_output` text,
	`status` text NOT NULL,
	`approval_status` text,
	`is_error_result` integer NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`parent_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_tool_calls_parent_message` ON `chat_tool_calls` (`parent_message_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_tool_calls_parent_message_started` ON `chat_tool_calls` (`parent_message_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_tool_calls_tool_use_id` ON `chat_tool_calls` (`tool_use_id`);--> statement-breakpoint
CREATE TABLE `approval_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`rule_kind` text NOT NULL,
	`description` text NOT NULL,
	`matcher` text NOT NULL,
	`is_enabled` integer NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_approval_rules_workspace_enabled` ON `approval_rules` (`workspace_id`,`is_enabled`);--> statement-breakpoint
CREATE INDEX `idx_approval_rules_workspace_deleted_at` ON `approval_rules` (`workspace_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_approval_rules_user` ON `approval_rules` (`user_id`);--> statement-breakpoint
CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_approval_id` text NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`session_id` text NOT NULL,
	`parent_message_id` text NOT NULL,
	`tool_use_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`action_kind` text NOT NULL,
	`tool_input` text NOT NULL,
	`status` text NOT NULL,
	`resolution_kind` text,
	`resolution_reason` text,
	`resolution_updated_input` text,
	`auto_approved_by_rule_id` text,
	`timeout_ms` integer NOT NULL,
	`requested_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`auto_approved_by_rule_id`) REFERENCES `approval_rules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_approval_requests_provider_approval_id` ON `approval_requests` (`provider_approval_id`);--> statement-breakpoint
CREATE INDEX `idx_approval_requests_session_status` ON `approval_requests` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_approval_requests_workspace_requested_at` ON `approval_requests` (`workspace_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `idx_approval_requests_user` ON `approval_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_approval_requests_status_requested_at` ON `approval_requests` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `idx_approval_requests_tool_use_id` ON `approval_requests` (`tool_use_id`);--> statement-breakpoint
CREATE TABLE `memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`category` text NOT NULL,
	`section` text NOT NULL,
	`source_message_id` text,
	`created_source` text NOT NULL,
	`embedding` blob,
	`embedding_model_version` text,
	`is_archived` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_mentioned_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_memory_entries_user` ON `memory_entries` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_workspace_kind` ON `memory_entries` (`workspace_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_workspace_archived` ON `memory_entries` (`workspace_id`,`is_archived`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_last_mentioned` ON `memory_entries` (`workspace_id`,`last_mentioned_at`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_deleted_at` ON `memory_entries` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_memory_entries_source_message` ON `memory_entries` (`source_message_id`);--> statement-breakpoint
CREATE TABLE `memory_entry_mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_entry_id` text NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`mention_kind` text NOT NULL,
	`mentioned_at` integer NOT NULL,
	FOREIGN KEY (`memory_entry_id`) REFERENCES `memory_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_memory_entry_mentions_entry` ON `memory_entry_mentions` (`memory_entry_id`,`mentioned_at`);--> statement-breakpoint
CREATE INDEX `idx_memory_entry_mentions_session` ON `memory_entry_mentions` (`session_id`);--> statement-breakpoint
CREATE TABLE `knowledge_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`scope` text NOT NULL,
	`absolute_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_sources_user` ON `knowledge_sources` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_sources_workspace` ON `knowledge_sources` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_knowledge_sources_workspace_path` ON `knowledge_sources` (`workspace_id`,`absolute_path`) WHERE "knowledge_sources"."scope" = 'workspace';--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_knowledge_sources_global_path` ON `knowledge_sources` (`user_id`,`absolute_path`) WHERE "knowledge_sources"."scope" = 'global';--> statement-breakpoint
CREATE TABLE `knowledge_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`source_id` text NOT NULL,
	`scope` text DEFAULT 'workspace' NOT NULL,
	`relative_path` text NOT NULL,
	`document_kind` text NOT NULL,
	`content_hash` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`file_modified_at` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`parse_status` text NOT NULL,
	`parse_error_message` text,
	`indexed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `knowledge_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_documents_user` ON `knowledge_documents` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_documents_workspace` ON `knowledge_documents` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_documents_workspace_status` ON `knowledge_documents` (`workspace_id`,`parse_status`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_documents_workspace_indexed_at` ON `knowledge_documents` (`workspace_id`,`indexed_at`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_documents_source` ON `knowledge_documents` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_knowledge_documents_source_path` ON `knowledge_documents` (`source_id`,`relative_path`);--> statement-breakpoint
CREATE TABLE `knowledge_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`start_char_offset` integer NOT NULL,
	`end_char_offset` integer NOT NULL,
	`chunk_text` text NOT NULL,
	`chunk_token_estimate` integer NOT NULL,
	`embedding` blob,
	`embedding_model_version` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_chunks_document` ON `knowledge_chunks` (`document_id`,`chunk_index`);--> statement-breakpoint
CREATE TABLE `installed_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`skill_id` text NOT NULL,
	`scope` text NOT NULL,
	`installed_from_source` text NOT NULL,
	`version_installed` text NOT NULL,
	`install_location` text NOT NULL,
	`install_health` text NOT NULL,
	`install_health_message` text,
	`is_enabled` integer NOT NULL,
	`installed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_installed_skills_user` ON `installed_skills` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_installed_skills_workspace` ON `installed_skills` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_installed_skills_user_workspace_skill` ON `installed_skills` (`user_id`,`workspace_id`,`skill_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_installed_skills_user_scope_skill` ON `installed_skills` (`user_id`,`skill_id`) WHERE "installed_skills"."workspace_id" IS NULL;--> statement-breakpoint
CREATE TABLE `skill_settings` (
	`installed_skill_id` text NOT NULL,
	`setting_key` text NOT NULL,
	`setting_value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`installed_skill_id`, `setting_key`),
	FOREIGN KEY (`installed_skill_id`) REFERENCES `installed_skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `file_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`activity_kind` text NOT NULL,
	`editor` text NOT NULL,
	`relative_path` text NOT NULL,
	`from_path` text,
	`file_size_bytes` integer,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_file_activities_workspace_occurred_at` ON `file_activities` (`workspace_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_file_activities_workspace_path_occurred_at` ON `file_activities` (`workspace_id`,`relative_path`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_file_activities_user` ON `file_activities` (`user_id`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`channel_kind` text NOT NULL,
	`display_name` text NOT NULL,
	`bot_credentials` text NOT NULL,
	`bot_metadata` text NOT NULL,
	`connection_status` text NOT NULL,
	`connection_status_message` text,
	`last_polled_cursor` text,
	`last_polled_at` integer,
	`last_inbound_at` integer,
	`is_enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_channels_user` ON `channels` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_channels_workspace` ON `channels` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_channels_enabled_polling` ON `channels` (`is_enabled`,`last_polled_at`);--> statement-breakpoint
CREATE TABLE `channel_user_links` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`external_sender_id` text NOT NULL,
	`external_sender_handle` text,
	`external_sender_display_name` text,
	`scope_context_id` text,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_channel_user_links_channel` ON `channel_user_links` (`channel_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_channel_user_links_sender` ON `channel_user_links` (`channel_id`,`external_sender_id`,`scope_context_id`);--> statement-breakpoint
CREATE TABLE `channel_inbound_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`external_message_id` text NOT NULL,
	`external_sender_id` text NOT NULL,
	`external_chat_context_id` text NOT NULL,
	`message_body` text NOT NULL,
	`message_metadata` text NOT NULL,
	`intent_kind` text NOT NULL,
	`routed_to_chat_session_id` text,
	`routed_to_approval_request_id` text,
	`status` text NOT NULL,
	`status_message` text,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_channel_inbound_channel_status` ON `channel_inbound_messages` (`channel_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_channel_inbound_pending` ON `channel_inbound_messages` (`status`,`received_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_channel_inbound_external` ON `channel_inbound_messages` (`channel_id`,`external_message_id`);--> statement-breakpoint
CREATE INDEX `idx_channel_inbound_history` ON `channel_inbound_messages` (`channel_id`,`received_at`,`id`);--> statement-breakpoint
CREATE TABLE `channel_message_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`external_recipient_id` text NOT NULL,
	`external_chat_context_id` text NOT NULL,
	`message_body` text NOT NULL,
	`message_structure` text NOT NULL,
	`payload_kind` text NOT NULL,
	`status` text NOT NULL,
	`status_message` text,
	`attempt_count` integer NOT NULL,
	`last_attempted_at` integer,
	`next_attempt_at` integer NOT NULL,
	`external_sent_message_id` text,
	`enqueued_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_channel_queue_ready` ON `channel_message_queue` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_channel_queue_channel_chat` ON `channel_message_queue` (`channel_id`,`external_chat_context_id`,`enqueued_at`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`template_kind` text NOT NULL,
	`display_name` text NOT NULL,
	`cron_expression` text NOT NULL,
	`timezone` text NOT NULL,
	`prompt_template` text NOT NULL,
	`destination_kind` text NOT NULL,
	`channel_id` text,
	`catch_up_on_miss` integer NOT NULL,
	`is_enabled` integer NOT NULL,
	`approval_timeout_ms_override` integer,
	`last_fired_at` integer,
	`next_scheduled_fire_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_schedules_user_workspace` ON `schedules` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_schedules_enabled_next_fire` ON `schedules` (`is_enabled`,`next_scheduled_fire_at`);--> statement-breakpoint
CREATE TABLE `schedule_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`scheduled_fire_at` integer NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`chat_session_id` text,
	`status` text NOT NULL,
	`status_message` text,
	`trigger_kind` text NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_schedule_runs_schedule_started` ON `schedule_runs` (`schedule_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_schedule_runs_status` ON `schedule_runs` (`status`);--> statement-breakpoint
CREATE TABLE `onboarding_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`current_step_kind` text NOT NULL,
	`completed_steps` text NOT NULL,
	`collected_data` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_onboarding_runs_user` ON `onboarding_runs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_onboarding_runs_status` ON `onboarding_runs` (`status`);--> statement-breakpoint
CREATE TABLE `workspace_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`capability_id` text NOT NULL,
	`is_enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_capabilities_workspace` ON `workspace_capabilities` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_workspace_capabilities_user` ON `workspace_capabilities` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_workspace_capabilities_workspace_capability` ON `workspace_capabilities` (`workspace_id`,`capability_id`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`icon` text,
	`prompt` text NOT NULL,
	`model` text,
	`effort` text,
	`permission_mode` text,
	`background` integer NOT NULL,
	`allowed_tools` text,
	`disallowed_tools` text,
	`scope` text NOT NULL,
	`source` text NOT NULL,
	`trust_tier` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agents_user` ON `agents` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_agents_workspace` ON `agents` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_agents_deleted_at` ON `agents` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_agents_user_workspace_slug` ON `agents` (`user_id`,`workspace_id`,`slug`) WHERE "agents"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_agents_user_scope_slug` ON `agents` (`user_id`,`slug`) WHERE "agents"."workspace_id" IS NULL AND "agents"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `agent_skills` (
	`agent_id` text NOT NULL,
	`skill_id` text NOT NULL,
	PRIMARY KEY(`agent_id`, `skill_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `primary_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`scope` text DEFAULT 'workspace' NOT NULL,
	`current_sdk_session_id` text,
	`superseded_from_sdk_session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_primary_sessions_user` ON `primary_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_primary_sessions_workspace` ON `primary_sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_primary_sessions_deleted_at` ON `primary_sessions` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_primary_sessions_user_workspace` ON `primary_sessions` (`user_id`,`workspace_id`) WHERE "primary_sessions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_primary_sessions_global_user` ON `primary_sessions` (`user_id`) WHERE "primary_sessions"."scope" = 'global' AND "primary_sessions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_primary_sessions_voice_user` ON `primary_sessions` (`user_id`) WHERE "primary_sessions"."scope" = 'voice' AND "primary_sessions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `delegation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`parent_session_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`workspace_path` text NOT NULL,
	`workspace_name` text NOT NULL,
	`task_text` text NOT NULL,
	`partial_session_id` text,
	`status` text NOT NULL,
	`claimed_at` integer,
	`completed_at` integer,
	`result_text` text,
	`error_message` text,
	`surfaced_to_root_at` integer,
	`origin_channel_id` text,
	`origin_external_sender_id` text,
	`origin_external_chat_context_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_delegation_jobs_status_created` ON `delegation_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_delegation_jobs_user` ON `delegation_jobs` (`user_id`);--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_outbox_events_type` ON `outbox_events` (`type`);--> statement-breakpoint
CREATE INDEX `idx_outbox_events_created_at` ON `outbox_events` (`created_at`);--> statement-breakpoint
-- ── Hand-authored search DDL (FTS5 + sqlite-vec + triggers) ──────────────────
-- drizzle-kit does not model virtual tables or triggers, so they are appended
-- to the generated baseline by hand. Squashed from migrations 0005/0006 (chat),
-- 0009/0010 (memory), 0012/0013 (knowledge) + 0038's source-keyed vec rebuild.
-- Base tables above already exist, so the external-content links resolve. Each
-- statement below is separated by the drizzle breakpoint marker.

CREATE VIRTUAL TABLE chat_messages_fts USING fts5(
  body,
  content='chat_messages',
  content_rowid='rowid'
);
--> statement-breakpoint
CREATE TRIGGER chat_messages_fts_insert AFTER INSERT ON chat_messages BEGIN
  INSERT INTO chat_messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
--> statement-breakpoint
CREATE TRIGGER chat_messages_fts_delete AFTER DELETE ON chat_messages BEGIN
  INSERT INTO chat_messages_fts(chat_messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;
--> statement-breakpoint
CREATE TRIGGER chat_messages_fts_update AFTER UPDATE OF body ON chat_messages BEGIN
  INSERT INTO chat_messages_fts(chat_messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO chat_messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE memory_entries_fts USING fts5(
  title,
  body,
  content='memory_entries',
  content_rowid='rowid'
);
--> statement-breakpoint
CREATE TRIGGER memory_entries_fts_insert AFTER INSERT ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
--> statement-breakpoint
CREATE TRIGGER memory_entries_fts_delete AFTER DELETE ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(memory_entries_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
END;
--> statement-breakpoint
CREATE TRIGGER memory_entries_fts_update AFTER UPDATE OF title, body ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(memory_entries_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO memory_entries_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE memory_entries_vec USING vec0(
  entryId TEXT PRIMARY KEY,
  workspaceId TEXT,
  embedding float[384]
);
--> statement-breakpoint
CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(
  chunk_text,
  content='knowledge_chunks',
  content_rowid='rowid'
);
--> statement-breakpoint
CREATE TRIGGER knowledge_chunks_fts_insert AFTER INSERT ON knowledge_chunks BEGIN
  INSERT INTO knowledge_chunks_fts(rowid, chunk_text) VALUES (new.rowid, new.chunk_text);
END;
--> statement-breakpoint
CREATE TRIGGER knowledge_chunks_fts_delete AFTER DELETE ON knowledge_chunks BEGIN
  INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, chunk_text) VALUES ('delete', old.rowid, old.chunk_text);
END;
--> statement-breakpoint
CREATE TRIGGER knowledge_chunks_fts_update AFTER UPDATE OF chunk_text ON knowledge_chunks BEGIN
  INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, chunk_text) VALUES ('delete', old.rowid, old.chunk_text);
  INSERT INTO knowledge_chunks_fts(rowid, chunk_text) VALUES (new.rowid, new.chunk_text);
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE `knowledge_chunks_vec` USING vec0(
  chunk_id TEXT PRIMARY KEY,
  source_id TEXT,
  document_id TEXT,
  embedding float[384]
);

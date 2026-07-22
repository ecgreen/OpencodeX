CREATE TABLE `opencodex_state_aggregate_sequence` (
	`visibility` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`directory` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`aggregate_sequence` integer NOT NULL,
	CONSTRAINT `opencodex_state_aggregate_sequence_pk` PRIMARY KEY(`visibility`, `project_id`, `workspace_id`, `directory`, `aggregate_id`)
);
--> statement-breakpoint
CREATE TABLE `opencodex_state_metadata` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_command` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`project_id` text NOT NULL,
	`directory` text NOT NULL,
	`status` text NOT NULL,
	`owner_id` text,
	`claim_generation` integer DEFAULT 0 NOT NULL,
	`lease_expires_at` integer,
	`error` text,
	`started_at` integer,
	`completed_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_execution` (
	`session_id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`directory` text NOT NULL,
	`state` text NOT NULL,
	`owner_id` text,
	`generation` integer DEFAULT 0 NOT NULL,
	`lease_expires_at` integer,
	`cancel_requested_at` integer,
	`queued_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_interaction` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`session_id` text NOT NULL,
	`project_id` text NOT NULL,
	`directory` text NOT NULL,
	`state` text NOT NULL,
	`request_json` text NOT NULL,
	`response_json` text,
	`responded_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_status` (
	`session_id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`directory` text NOT NULL,
	`status` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `opencodex_state_event` ADD `visibility` text DEFAULT 'instance' NOT NULL;--> statement-breakpoint
CREATE INDEX `opencodex_state_event_visibility_position_idx` ON `opencodex_state_event` (`visibility`,`position`);--> statement-breakpoint
CREATE INDEX `session_command_status_idx` ON `session_command` (`status`,`directory`);--> statement-breakpoint
CREATE INDEX `session_command_session_idx` ON `session_command` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `session_command_lease_idx` ON `session_command` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_command_message_idx` ON `session_command` (`session_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `session_execution_state_idx` ON `session_execution` (`state`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `session_execution_directory_idx` ON `session_execution` (`directory`);--> statement-breakpoint
CREATE INDEX `session_interaction_pending_idx` ON `session_interaction` (`kind`,`state`,`directory`);--> statement-breakpoint
CREATE INDEX `session_interaction_session_idx` ON `session_interaction` (`session_id`,`state`);--> statement-breakpoint
CREATE INDEX `session_status_directory_idx` ON `session_status` (`directory`);--> statement-breakpoint
CREATE INDEX `session_time_updated_id_idx` ON `session` (`time_updated`,`id`);
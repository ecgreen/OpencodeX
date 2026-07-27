CREATE TABLE `opencodex_terminal_session` (
	`id` text PRIMARY KEY,
	`driver` text NOT NULL,
	`title` text NOT NULL,
	`project_id` text,
	`directory` text NOT NULL,
	`resume_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`session_id` text,
	`time_launched` integer,
	`time_opened` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_opencodex_terminal_session_project_id_opencodex_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `opencodex_project`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_opencodex_terminal_session_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `opencodex_view_terminal_session` (
	`view_id` text NOT NULL,
	`terminal_session_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `opencodex_view_terminal_session_pk` PRIMARY KEY(`view_id`, `terminal_session_id`),
	CONSTRAINT `fk_opencodex_view_terminal_session_view_id_opencodex_view_id_fk` FOREIGN KEY (`view_id`) REFERENCES `opencodex_view`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_opencodex_view_terminal_session_terminal_session_id_opencodex_terminal_session_id_fk` FOREIGN KEY (`terminal_session_id`) REFERENCES `opencodex_terminal_session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `opencodex_view` ADD `focused_item_id` text;--> statement-breakpoint
CREATE INDEX `opencodex_terminal_session_project_idx` ON `opencodex_terminal_session` (`project_id`);--> statement-breakpoint
CREATE INDEX `opencodex_terminal_session_installation_idx` ON `opencodex_terminal_session` (`installation_id`);--> statement-breakpoint
CREATE INDEX `opencodex_terminal_session_session_idx` ON `opencodex_terminal_session` (`session_id`);--> statement-breakpoint
CREATE INDEX `opencodex_terminal_session_updated_idx` ON `opencodex_terminal_session` (`time_updated`);--> statement-breakpoint
CREATE INDEX `opencodex_view_focused_item_idx` ON `opencodex_view` (`focused_item_id`);--> statement-breakpoint
CREATE INDEX `opencodex_view_terminal_session_view_idx` ON `opencodex_view_terminal_session` (`view_id`);--> statement-breakpoint
CREATE INDEX `opencodex_view_terminal_session_terminal_idx` ON `opencodex_view_terminal_session` (`terminal_session_id`);
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_opencodex_swarm` (
	`id` text PRIMARY KEY,
	`opencodex_project_id` text,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`created_by` text,
	`synthesis_session_id` text,
	`started_at` integer,
	`completed_at` integer,
	`metadata_json` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_opencodex_swarm_opencodex_project_id_opencodex_project_id_fk` FOREIGN KEY (`opencodex_project_id`) REFERENCES `opencodex_project`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_opencodex_swarm_synthesis_session_id_session_id_fk` FOREIGN KEY (`synthesis_session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__new_opencodex_swarm`(`id`, `opencodex_project_id`, `title`, `prompt`, `status`, `source`, `created_by`, `synthesis_session_id`, `started_at`, `completed_at`, `metadata_json`, `time_created`, `time_updated`) SELECT `id`, `opencodex_project_id`, `title`, `prompt`, `status`, `source`, `created_by`, `synthesis_session_id`, `started_at`, `completed_at`, `metadata_json`, `time_created`, `time_updated` FROM `opencodex_swarm`;--> statement-breakpoint
DROP TABLE `opencodex_swarm`;--> statement-breakpoint
ALTER TABLE `__new_opencodex_swarm` RENAME TO `opencodex_swarm`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `opencodex_swarm_project_idx` ON `opencodex_swarm` (`opencodex_project_id`);--> statement-breakpoint
CREATE INDEX `opencodex_swarm_status_idx` ON `opencodex_swarm` (`status`);--> statement-breakpoint
CREATE INDEX `opencodex_swarm_updated_idx` ON `opencodex_swarm` (`time_updated`);
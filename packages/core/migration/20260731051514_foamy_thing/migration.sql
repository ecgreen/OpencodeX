PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_opencodex_swarm_event` (
	`id` text PRIMARY KEY,
	`swarm_id` text NOT NULL,
	`role_id` text,
	`session_id` text,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`metadata_json` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_opencodex_swarm_event_swarm_id_opencodex_swarm_id_fk` FOREIGN KEY (`swarm_id`) REFERENCES `opencodex_swarm`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_opencodex_swarm_event_role_id_opencodex_swarm_role_id_fk` FOREIGN KEY (`role_id`) REFERENCES `opencodex_swarm_role`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_opencodex_swarm_event_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__new_opencodex_swarm_event`(`id`, `swarm_id`, `role_id`, `session_id`, `kind`, `message`, `metadata_json`, `time_created`, `time_updated`) SELECT `id`, `swarm_id`, `role_id`, `session_id`, `kind`, `message`, `metadata_json`, `time_created`, `time_updated` FROM `opencodex_swarm_event`;--> statement-breakpoint
DROP TABLE `opencodex_swarm_event`;--> statement-breakpoint
ALTER TABLE `__new_opencodex_swarm_event` RENAME TO `opencodex_swarm_event`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `opencodex_swarm_agent_run_run_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `opencodex_swarm_agent_run_swarm_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `opencodex_swarm_agent_run_role_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `opencodex_swarm_agent_run_session_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `opencodex_swarm_agent_run_job_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `opencodex_swarm_agent_run_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `opencodex_swarm_event_run_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `opencodex_swarm_run_swarm_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `opencodex_swarm_run_project_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `opencodex_swarm_run_orchestrator_session_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `opencodex_swarm_run_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `opencodex_swarm_run_updated_idx`;--> statement-breakpoint
CREATE INDEX `opencodex_swarm_event_swarm_idx` ON `opencodex_swarm_event` (`swarm_id`);--> statement-breakpoint
CREATE INDEX `opencodex_swarm_event_role_idx` ON `opencodex_swarm_event` (`role_id`);--> statement-breakpoint
CREATE INDEX `opencodex_swarm_event_session_idx` ON `opencodex_swarm_event` (`session_id`);--> statement-breakpoint
CREATE INDEX `opencodex_swarm_event_created_idx` ON `opencodex_swarm_event` (`time_created`);--> statement-breakpoint
DROP TABLE `opencodex_swarm_agent_run`;--> statement-breakpoint
DROP TABLE `opencodex_swarm_run`;
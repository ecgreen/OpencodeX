CREATE TABLE `opencodex_goal_edge` (
	`goal_id` text NOT NULL,
	`from_node_id` text NOT NULL,
	`to_node_id` text NOT NULL,
	`kind` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `opencodex_goal_edge_pk` PRIMARY KEY(`goal_id`, `from_node_id`, `to_node_id`, `kind`),
	CONSTRAINT `fk_opencodex_goal_edge_goal_id_opencodex_goal_id_fk` FOREIGN KEY (`goal_id`) REFERENCES `opencodex_goal`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `opencodex_goal_node` (
	`id` text NOT NULL,
	`goal_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`brief` text NOT NULL,
	`status` text NOT NULL,
	`executor_json` text,
	`parent_node_id` text,
	`loop_json` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`iteration` integer DEFAULT 0 NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`job_id` text,
	`session_id` text,
	`delivered_prompt` text,
	`result_text` text,
	`verdict_json` text,
	`failure_reason` text,
	`metadata_json` text,
	`started_at` integer,
	`completed_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `opencodex_goal_node_pk` PRIMARY KEY(`goal_id`, `id`),
	CONSTRAINT `fk_opencodex_goal_node_goal_id_opencodex_goal_id_fk` FOREIGN KEY (`goal_id`) REFERENCES `opencodex_goal`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_opencodex_goal_node_job_id_opencodex_job_id_fk` FOREIGN KEY (`job_id`) REFERENCES `opencodex_job`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_opencodex_goal_node_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `opencodex_goal` (
	`id` text PRIMARY KEY,
	`opencodex_project_id` text NOT NULL,
	`title` text NOT NULL,
	`statement` text NOT NULL,
	`success_criteria_json` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`owner_session_id` text,
	`swarm_id` text,
	`directory` text,
	`budget_json` text,
	`spend_json` text,
	`schedule_json` text,
	`status_reason` text,
	`metadata_json` text,
	`started_at` integer,
	`completed_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_opencodex_goal_opencodex_project_id_opencodex_project_id_fk` FOREIGN KEY (`opencodex_project_id`) REFERENCES `opencodex_project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_opencodex_goal_owner_session_id_session_id_fk` FOREIGN KEY (`owner_session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_opencodex_goal_swarm_id_opencodex_swarm_id_fk` FOREIGN KEY (`swarm_id`) REFERENCES `opencodex_swarm`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `opencodex_goal_edge_goal_idx` ON `opencodex_goal_edge` (`goal_id`);--> statement-breakpoint
CREATE INDEX `opencodex_goal_edge_to_idx` ON `opencodex_goal_edge` (`to_node_id`);--> statement-breakpoint
CREATE INDEX `opencodex_goal_node_goal_idx` ON `opencodex_goal_node` (`goal_id`);--> statement-breakpoint
CREATE INDEX `opencodex_goal_node_parent_idx` ON `opencodex_goal_node` (`parent_node_id`);--> statement-breakpoint
CREATE INDEX `opencodex_goal_node_job_idx` ON `opencodex_goal_node` (`job_id`);--> statement-breakpoint
CREATE INDEX `opencodex_goal_node_session_idx` ON `opencodex_goal_node` (`session_id`);--> statement-breakpoint
CREATE INDEX `opencodex_goal_node_status_idx` ON `opencodex_goal_node` (`status`);--> statement-breakpoint
CREATE INDEX `opencodex_goal_project_idx` ON `opencodex_goal` (`opencodex_project_id`);--> statement-breakpoint
CREATE INDEX `opencodex_goal_session_idx` ON `opencodex_goal` (`owner_session_id`);--> statement-breakpoint
CREATE INDEX `opencodex_goal_swarm_idx` ON `opencodex_goal` (`swarm_id`);--> statement-breakpoint
CREATE INDEX `opencodex_goal_status_idx` ON `opencodex_goal` (`status`);--> statement-breakpoint
CREATE INDEX `opencodex_goal_updated_idx` ON `opencodex_goal` (`time_updated`);
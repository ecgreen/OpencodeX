import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260602000000_opencodex_jobs_swarms",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_job\` (
          \`id\` text PRIMARY KEY,
          \`kind\` text NOT NULL,
          \`title\` text,
          \`status\` text NOT NULL,
          \`source\` text NOT NULL,
          \`opencodex_project_id\` text,
          \`session_id\` text,
          \`parent_job_id\` text,
          \`swarm_id\` text,
          \`role_id\` text,
          \`agent\` text,
          \`provider_id\` text,
          \`model_id\` text,
          \`started_at\` integer,
          \`completed_at\` integer,
          \`status_reason\` text,
          \`metadata_json\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_opencodex_job_opencodex_project_id_opencodex_project_id_fk\` FOREIGN KEY (\`opencodex_project_id\`) REFERENCES \`opencodex_project\`(\`id\`) ON DELETE SET NULL,
          CONSTRAINT \`fk_opencodex_job_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_job_project_idx\` ON \`opencodex_job\` (\`opencodex_project_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_job_session_idx\` ON \`opencodex_job\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_job_swarm_idx\` ON \`opencodex_job\` (\`swarm_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_job_status_idx\` ON \`opencodex_job\` (\`status\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_job_updated_idx\` ON \`opencodex_job\` (\`time_updated\`);`)

      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_swarm\` (
          \`id\` text PRIMARY KEY,
          \`opencodex_project_id\` text NOT NULL,
          \`title\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`status\` text NOT NULL,
          \`source\` text NOT NULL,
          \`created_by\` text,
          \`synthesis_session_id\` text,
          \`started_at\` integer,
          \`completed_at\` integer,
          \`metadata_json\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_opencodex_swarm_opencodex_project_id_opencodex_project_id_fk\` FOREIGN KEY (\`opencodex_project_id\`) REFERENCES \`opencodex_project\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_opencodex_swarm_synthesis_session_id_session_id_fk\` FOREIGN KEY (\`synthesis_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_project_idx\` ON \`opencodex_swarm\` (\`opencodex_project_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_status_idx\` ON \`opencodex_swarm\` (\`status\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_updated_idx\` ON \`opencodex_swarm\` (\`time_updated\`);`)

      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_swarm_run\` (
          \`id\` text PRIMARY KEY,
          \`swarm_id\` text NOT NULL,
          \`opencodex_project_id\` text,
          \`title\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`status\` text NOT NULL,
          \`source\` text NOT NULL,
          \`orchestrator_session_id\` text,
          \`result_session_id\` text,
          \`started_at\` integer,
          \`completed_at\` integer,
          \`metadata_json\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_opencodex_swarm_run_swarm_id_opencodex_swarm_id_fk\` FOREIGN KEY (\`swarm_id\`) REFERENCES \`opencodex_swarm\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_opencodex_swarm_run_opencodex_project_id_opencodex_project_id_fk\` FOREIGN KEY (\`opencodex_project_id\`) REFERENCES \`opencodex_project\`(\`id\`) ON DELETE SET NULL,
          CONSTRAINT \`fk_opencodex_swarm_run_orchestrator_session_id_session_id_fk\` FOREIGN KEY (\`orchestrator_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE SET NULL,
          CONSTRAINT \`fk_opencodex_swarm_run_result_session_id_session_id_fk\` FOREIGN KEY (\`result_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_run_swarm_idx\` ON \`opencodex_swarm_run\` (\`swarm_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_run_project_idx\` ON \`opencodex_swarm_run\` (\`opencodex_project_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_run_orchestrator_session_idx\` ON \`opencodex_swarm_run\` (\`orchestrator_session_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_run_status_idx\` ON \`opencodex_swarm_run\` (\`status\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_run_updated_idx\` ON \`opencodex_swarm_run\` (\`time_updated\`);`)

      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_swarm_role\` (
          \`id\` text PRIMARY KEY,
          \`swarm_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`agent\` text,
          \`skill\` text,
          \`provider_id\` text,
          \`model_id\` text,
          \`model_profile\` text,
          \`status\` text NOT NULL,
          \`instructions\` text NOT NULL,
          \`sort_order\` integer NOT NULL DEFAULT 0,
          \`session_id\` text,
          \`job_id\` text,
          \`metadata_json\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_opencodex_swarm_role_swarm_id_opencodex_swarm_id_fk\` FOREIGN KEY (\`swarm_id\`) REFERENCES \`opencodex_swarm\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_opencodex_swarm_role_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE SET NULL,
          CONSTRAINT \`fk_opencodex_swarm_role_job_id_opencodex_job_id_fk\` FOREIGN KEY (\`job_id\`) REFERENCES \`opencodex_job\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_role_swarm_idx\` ON \`opencodex_swarm_role\` (\`swarm_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_role_session_idx\` ON \`opencodex_swarm_role\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_role_job_idx\` ON \`opencodex_swarm_role\` (\`job_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_role_status_idx\` ON \`opencodex_swarm_role\` (\`status\`);`)

      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_swarm_agent_run\` (
          \`id\` text PRIMARY KEY,
          \`run_id\` text NOT NULL,
          \`swarm_id\` text NOT NULL,
          \`role_id\` text,
          \`status\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`session_id\` text,
          \`job_id\` text,
          \`metadata_json\` text,
          \`started_at\` integer,
          \`completed_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_opencodex_swarm_agent_run_run_id_opencodex_swarm_run_id_fk\` FOREIGN KEY (\`run_id\`) REFERENCES \`opencodex_swarm_run\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_opencodex_swarm_agent_run_swarm_id_opencodex_swarm_id_fk\` FOREIGN KEY (\`swarm_id\`) REFERENCES \`opencodex_swarm\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_opencodex_swarm_agent_run_role_id_opencodex_swarm_role_id_fk\` FOREIGN KEY (\`role_id\`) REFERENCES \`opencodex_swarm_role\`(\`id\`) ON DELETE SET NULL,
          CONSTRAINT \`fk_opencodex_swarm_agent_run_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE SET NULL,
          CONSTRAINT \`fk_opencodex_swarm_agent_run_job_id_opencodex_job_id_fk\` FOREIGN KEY (\`job_id\`) REFERENCES \`opencodex_job\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_agent_run_run_idx\` ON \`opencodex_swarm_agent_run\` (\`run_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_agent_run_swarm_idx\` ON \`opencodex_swarm_agent_run\` (\`swarm_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_agent_run_role_idx\` ON \`opencodex_swarm_agent_run\` (\`role_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_agent_run_session_idx\` ON \`opencodex_swarm_agent_run\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_agent_run_job_idx\` ON \`opencodex_swarm_agent_run\` (\`job_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_agent_run_status_idx\` ON \`opencodex_swarm_agent_run\` (\`status\`);`)

      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_swarm_event\` (
          \`id\` text PRIMARY KEY,
          \`swarm_id\` text NOT NULL,
          \`run_id\` text,
          \`role_id\` text,
          \`session_id\` text,
          \`kind\` text NOT NULL,
          \`message\` text NOT NULL,
          \`metadata_json\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_opencodex_swarm_event_swarm_id_opencodex_swarm_id_fk\` FOREIGN KEY (\`swarm_id\`) REFERENCES \`opencodex_swarm\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_opencodex_swarm_event_run_id_opencodex_swarm_run_id_fk\` FOREIGN KEY (\`run_id\`) REFERENCES \`opencodex_swarm_run\`(\`id\`) ON DELETE SET NULL,
          CONSTRAINT \`fk_opencodex_swarm_event_role_id_opencodex_swarm_role_id_fk\` FOREIGN KEY (\`role_id\`) REFERENCES \`opencodex_swarm_role\`(\`id\`) ON DELETE SET NULL,
          CONSTRAINT \`fk_opencodex_swarm_event_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_event_swarm_idx\` ON \`opencodex_swarm_event\` (\`swarm_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_event_run_idx\` ON \`opencodex_swarm_event\` (\`run_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_event_role_idx\` ON \`opencodex_swarm_event\` (\`role_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_event_session_idx\` ON \`opencodex_swarm_event\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_event_created_idx\` ON \`opencodex_swarm_event\` (\`time_created\`);`)
    })
  },
} satisfies DatabaseMigration.Migration

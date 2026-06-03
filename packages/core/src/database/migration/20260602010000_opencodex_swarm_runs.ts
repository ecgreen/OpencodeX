import { Effect } from "effect"
import { sql } from "drizzle-orm"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260602010000_opencodex_swarm_runs",
  up(tx) {
    return Effect.gen(function* () {
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

      const columns = yield* tx.all<{ name: string }>(sql`PRAGMA table_info(${sql.identifier("opencodex_swarm_event")})`)
      if (!columns.some((column) => column.name === "run_id")) {
        yield* tx.run(`ALTER TABLE \`opencodex_swarm_event\` ADD COLUMN \`run_id\` text;`)
      }
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_swarm_event_run_idx\` ON \`opencodex_swarm_event\` (\`run_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration

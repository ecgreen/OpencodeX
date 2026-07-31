import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260731051514_foamy_thing",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`PRAGMA foreign_keys=OFF;`)
      yield* tx.run(`
        CREATE TABLE \`__new_opencodex_swarm_event\` (
          \`id\` text PRIMARY KEY,
          \`swarm_id\` text NOT NULL,
          \`role_id\` text,
          \`session_id\` text,
          \`kind\` text NOT NULL,
          \`message\` text NOT NULL,
          \`metadata_json\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_opencodex_swarm_event_swarm_id_opencodex_swarm_id_fk\` FOREIGN KEY (\`swarm_id\`) REFERENCES \`opencodex_swarm\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_opencodex_swarm_event_role_id_opencodex_swarm_role_id_fk\` FOREIGN KEY (\`role_id\`) REFERENCES \`opencodex_swarm_role\`(\`id\`) ON DELETE SET NULL,
          CONSTRAINT \`fk_opencodex_swarm_event_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`INSERT INTO \`__new_opencodex_swarm_event\`(\`id\`, \`swarm_id\`, \`role_id\`, \`session_id\`, \`kind\`, \`message\`, \`metadata_json\`, \`time_created\`, \`time_updated\`) SELECT \`id\`, \`swarm_id\`, \`role_id\`, \`session_id\`, \`kind\`, \`message\`, \`metadata_json\`, \`time_created\`, \`time_updated\` FROM \`opencodex_swarm_event\`;`)
      yield* tx.run(`DROP TABLE \`opencodex_swarm_event\`;`)
      yield* tx.run(`ALTER TABLE \`__new_opencodex_swarm_event\` RENAME TO \`opencodex_swarm_event\`;`)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`opencodex_swarm_agent_run_run_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`opencodex_swarm_agent_run_swarm_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`opencodex_swarm_agent_run_role_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`opencodex_swarm_agent_run_session_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`opencodex_swarm_agent_run_job_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`opencodex_swarm_agent_run_status_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`opencodex_swarm_event_run_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`opencodex_swarm_run_swarm_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`opencodex_swarm_run_project_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`opencodex_swarm_run_orchestrator_session_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`opencodex_swarm_run_status_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`opencodex_swarm_run_updated_idx\`;`)
      yield* tx.run(`CREATE INDEX \`opencodex_swarm_event_swarm_idx\` ON \`opencodex_swarm_event\` (\`swarm_id\`);`)
      yield* tx.run(`CREATE INDEX \`opencodex_swarm_event_role_idx\` ON \`opencodex_swarm_event\` (\`role_id\`);`)
      yield* tx.run(`CREATE INDEX \`opencodex_swarm_event_session_idx\` ON \`opencodex_swarm_event\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`opencodex_swarm_event_created_idx\` ON \`opencodex_swarm_event\` (\`time_created\`);`)
      yield* tx.run(`DROP TABLE \`opencodex_swarm_agent_run\`;`)
      yield* tx.run(`DROP TABLE \`opencodex_swarm_run\`;`)
    })
  },
} satisfies DatabaseMigration.Migration

import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260602030000_opencodex_session_state",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_session_state\` (
          \`session_id\` text PRIMARY KEY NOT NULL,
          \`seen_at\` integer,
          \`reviewed_at\` integer,
          \`reviewed_files\` text NOT NULL DEFAULT '[]',
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_opencodex_session_state_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_session_state_updated_idx\` ON \`opencodex_session_state\` (\`time_updated\`);`)
    })
  },
} satisfies DatabaseMigration.Migration

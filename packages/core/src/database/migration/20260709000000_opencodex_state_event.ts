import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260709000000_opencodex_state_event",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_state_event\` (
          \`position\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
          \`id\` text NOT NULL UNIQUE,
          \`project_id\` text NOT NULL,
          \`workspace_id\` text,
          \`directory\` text NOT NULL,
          \`aggregate_id\` text NOT NULL,
          \`aggregate_sequence\` integer NOT NULL,
          \`domain\` text NOT NULL,
          \`event_type\` text NOT NULL,
          \`operation\` text NOT NULL,
          \`payload\` text NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`opencodex_state_event_scope_position_idx\` ON \`opencodex_state_event\` (\`project_id\`, \`workspace_id\`, \`directory\`, \`position\`);`,
      )
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`opencodex_state_event_aggregate_idx\` ON \`opencodex_state_event\` (\`project_id\`, \`workspace_id\`, \`directory\`, \`aggregate_id\`, \`aggregate_sequence\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration

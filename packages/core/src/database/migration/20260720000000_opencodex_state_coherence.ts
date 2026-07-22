import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260720000000_opencodex_state_coherence",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run("ALTER TABLE `opencodex_state_event` ADD `visibility` text NOT NULL DEFAULT 'instance';")
      yield* tx.run(
        "CREATE INDEX IF NOT EXISTS `opencodex_state_event_visibility_position_idx` ON `opencodex_state_event` (`visibility`, `position`);",
      )
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_state_aggregate_sequence\` (
          \`visibility\` text NOT NULL,
          \`project_id\` text NOT NULL,
          \`workspace_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`aggregate_id\` text NOT NULL,
          \`aggregate_sequence\` integer NOT NULL,
          PRIMARY KEY (\`visibility\`, \`project_id\`, \`workspace_id\`, \`directory\`, \`aggregate_id\`)
        );
      `)
      yield* tx.run(`
        INSERT OR IGNORE INTO \`opencodex_state_aggregate_sequence\`
          (\`visibility\`, \`project_id\`, \`workspace_id\`, \`directory\`, \`aggregate_id\`, \`aggregate_sequence\`)
        SELECT
          'instance', \`project_id\`, COALESCE(\`workspace_id\`, ''), \`directory\`, \`aggregate_id\`, MAX(\`aggregate_sequence\`)
        FROM \`opencodex_state_event\`
        GROUP BY \`project_id\`, \`workspace_id\`, \`directory\`, \`aggregate_id\`;
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_state_metadata\` (
          \`key\` text PRIMARY KEY NOT NULL,
          \`value\` text NOT NULL
        );
      `)
      yield* tx.run(
        "INSERT OR IGNORE INTO `opencodex_state_metadata` (`key`, `value`) VALUES ('database_uuid', lower(hex(randomblob(16))));",
      )
    })
  },
} satisfies DatabaseMigration.Migration

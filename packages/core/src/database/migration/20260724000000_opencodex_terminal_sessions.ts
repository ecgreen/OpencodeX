import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260724000000_opencodex_terminal_sessions",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_terminal_session\` (
          \`id\` text PRIMARY KEY NOT NULL,
          \`driver\` text NOT NULL,
          \`title\` text NOT NULL,
          \`project_id\` text,
          \`directory\` text NOT NULL,
          \`resume_id\` text NOT NULL,
          \`installation_id\` text NOT NULL,
          \`time_launched\` integer,
          \`time_opened\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_opencodex_terminal_session_project_id_opencodex_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`opencodex_project\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(
        "CREATE INDEX IF NOT EXISTS `opencodex_terminal_session_project_idx` ON `opencodex_terminal_session` (`project_id`);",
      )
      yield* tx.run(
        "CREATE INDEX IF NOT EXISTS `opencodex_terminal_session_installation_idx` ON `opencodex_terminal_session` (`installation_id`);",
      )
      yield* tx.run(
        "CREATE INDEX IF NOT EXISTS `opencodex_terminal_session_updated_idx` ON `opencodex_terminal_session` (`time_updated`);",
      )

      yield* tx.run("ALTER TABLE `opencodex_view` ADD `focused_item_id` text;")
      yield* tx.run(
        "CREATE INDEX IF NOT EXISTS `opencodex_view_focused_item_idx` ON `opencodex_view` (`focused_item_id`);",
      )

      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_view_terminal_session\` (
          \`view_id\` text NOT NULL,
          \`terminal_session_id\` text NOT NULL,
          \`sort_order\` integer NOT NULL DEFAULT 0,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          PRIMARY KEY(\`view_id\`, \`terminal_session_id\`),
          CONSTRAINT \`fk_opencodex_view_terminal_session_view_id_opencodex_view_id_fk\` FOREIGN KEY (\`view_id\`) REFERENCES \`opencodex_view\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_opencodex_view_terminal_session_terminal_session_id_opencodex_terminal_session_id_fk\` FOREIGN KEY (\`terminal_session_id\`) REFERENCES \`opencodex_terminal_session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        "CREATE INDEX IF NOT EXISTS `opencodex_view_terminal_session_view_idx` ON `opencodex_view_terminal_session` (`view_id`);",
      )
      yield* tx.run(
        "CREATE INDEX IF NOT EXISTS `opencodex_view_terminal_session_terminal_idx` ON `opencodex_view_terminal_session` (`terminal_session_id`);",
      )
    })
  },
} satisfies DatabaseMigration.Migration

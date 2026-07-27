import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260602020000_opencodex_views",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_view\` (
          \`id\` text PRIMARY KEY NOT NULL,
          \`title\` text NOT NULL,
          \`focused_session_id\` text,
          \`layout\` text NOT NULL DEFAULT 'auto',
          \`metadata_json\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_opencodex_view_focused_session_id_session_id_fk\` FOREIGN KEY (\`focused_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_view_focused_session_idx\` ON \`opencodex_view\` (\`focused_session_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_view_updated_idx\` ON \`opencodex_view\` (\`time_updated\`);`)

      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_view_session\` (
          \`view_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`sort_order\` integer NOT NULL DEFAULT 0,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          PRIMARY KEY(\`view_id\`, \`session_id\`),
          CONSTRAINT \`fk_opencodex_view_session_view_id_opencodex_view_id_fk\` FOREIGN KEY (\`view_id\`) REFERENCES \`opencodex_view\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_opencodex_view_session_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_view_session_view_idx\` ON \`opencodex_view_session\` (\`view_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_view_session_session_idx\` ON \`opencodex_view_session\` (\`session_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration

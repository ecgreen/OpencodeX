import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260601000000_opencodex_project_folder",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`opencodex_project\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`name\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_opencodex_project_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`opencodex_project_project_idx\` ON \`opencodex_project\` (\`project_id\`);`)
      yield* tx.run(`
        CREATE TABLE \`opencodex_project_folder\` (
          \`path\` text NOT NULL,
          \`opencodex_project_id\` text NOT NULL,
          \`project_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          PRIMARY KEY(\`opencodex_project_id\`, \`path\`),
          CONSTRAINT \`fk_opencodex_project_folder_opencodex_project_id_opencodex_project_id_fk\` FOREIGN KEY (\`opencodex_project_id\`) REFERENCES \`opencodex_project\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_opencodex_project_folder_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`opencodex_project_folder_opencodex_project_idx\` ON \`opencodex_project_folder\` (\`opencodex_project_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`opencodex_project_folder_project_idx\` ON \`opencodex_project_folder\` (\`project_id\`);`,
      )
      yield* tx.run(`
        CREATE TABLE \`opencodex_project_session\` (
          \`session_id\` text PRIMARY KEY,
          \`opencodex_project_id\` text NOT NULL,
          \`path\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_opencodex_project_session_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_opencodex_project_session_opencodex_project_id_opencodex_project_id_fk\` FOREIGN KEY (\`opencodex_project_id\`) REFERENCES \`opencodex_project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`opencodex_project_session_project_idx\` ON \`opencodex_project_session\` (\`opencodex_project_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration

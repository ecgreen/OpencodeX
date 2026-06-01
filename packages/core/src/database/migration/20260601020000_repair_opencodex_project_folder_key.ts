import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260601020000_repair_opencodex_project_folder_key",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`opencodex_project\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`name\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_opencodex_project_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`opencodex_project_project_idx\` ON \`opencodex_project\` (\`project_id\`);`)

      const columns = yield* tx.all<{ name: string; pk: number }>(
        sql`PRAGMA table_info(${sql.identifier("opencodex_project_folder")})`,
      )
      if (columns.length === 0) {
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
      } else {
        if (!columns.some((column) => column.name === "opencodex_project_id")) {
          yield* tx.run(`ALTER TABLE \`opencodex_project_folder\` ADD COLUMN \`opencodex_project_id\` text;`)
        }
        yield* tx.run(`
          INSERT OR IGNORE INTO \`opencodex_project\` (\`id\`, \`project_id\`, \`name\`, \`time_created\`, \`time_updated\`)
          SELECT \`project_id\`, \`project_id\`, NULL, MIN(\`time_created\`), MAX(\`time_updated\`)
          FROM \`opencodex_project_folder\`
          GROUP BY \`project_id\`;
        `)
        yield* tx.run(`
          UPDATE \`opencodex_project_folder\`
          SET \`opencodex_project_id\` = \`project_id\`
          WHERE \`opencodex_project_id\` IS NULL;
        `)

        const repairedColumns = yield* tx.all<{ name: string; pk: number }>(
          sql`PRAGMA table_info(${sql.identifier("opencodex_project_folder")})`,
        )
        const hasProjectFolderKey =
          repairedColumns.find((column) => column.name === "opencodex_project_id")?.pk === 1 &&
          repairedColumns.find((column) => column.name === "path")?.pk === 2
        if (!hasProjectFolderKey) {
          yield* tx.run(`DROP TABLE IF EXISTS \`opencodex_project_folder_repair\`;`)
          yield* tx.run(`
            CREATE TABLE \`opencodex_project_folder_repair\` (
              \`path\` text NOT NULL,
              \`opencodex_project_id\` text NOT NULL,
              \`project_id\` text NOT NULL,
              \`time_created\` integer NOT NULL,
              \`time_updated\` integer NOT NULL,
              PRIMARY KEY(\`opencodex_project_id\`, \`path\`),
              CONSTRAINT \`fk_opencodex_project_folder_repair_opencodex_project_id_opencodex_project_id_fk\` FOREIGN KEY (\`opencodex_project_id\`) REFERENCES \`opencodex_project\`(\`id\`) ON DELETE CASCADE,
              CONSTRAINT \`fk_opencodex_project_folder_repair_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
            );
          `)
          yield* tx.run(`
            INSERT OR IGNORE INTO \`opencodex_project_folder_repair\`
            SELECT \`path\`, \`opencodex_project_id\`, \`project_id\`, \`time_created\`, \`time_updated\`
            FROM \`opencodex_project_folder\`
            WHERE \`opencodex_project_id\` IS NOT NULL;
          `)
          yield* tx.run(`DROP TABLE \`opencodex_project_folder\`;`)
          yield* tx.run(`ALTER TABLE \`opencodex_project_folder_repair\` RENAME TO \`opencodex_project_folder\`;`)
        }
      }

      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`opencodex_project_folder_opencodex_project_idx\` ON \`opencodex_project_folder\` (\`opencodex_project_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`opencodex_project_folder_project_idx\` ON \`opencodex_project_folder\` (\`project_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration

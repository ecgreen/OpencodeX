import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260601030000_opencodex_project_order",
  up(tx) {
    return Effect.gen(function* () {
      const columns = yield* tx.all<{ name: string }>(
        sql`PRAGMA table_info(${sql.identifier("opencodex_project")})`,
      )
      if (!columns.some((column) => column.name === "sort_order")) {
        yield* tx.run(`ALTER TABLE \`opencodex_project\` ADD COLUMN \`sort_order\` integer NOT NULL DEFAULT 0;`)
      }

      const rows = yield* tx.all<{ id: string }>(
        sql`SELECT \`id\` FROM \`opencodex_project\` ORDER BY \`time_updated\`, \`id\``,
      )
      yield* Effect.forEach(
        rows,
        (row, index) =>
          tx.run(
            `UPDATE \`opencodex_project\` SET \`sort_order\` = ${index} WHERE \`id\` = '${row.id.replaceAll("'", "''")}';`,
          ),
        { discard: true },
      )
    })
  },
} satisfies DatabaseMigration.Migration

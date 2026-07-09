import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260709000001_opencodex_state_retention_view_order",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run("ALTER TABLE `opencodex_state_event` ADD `created_at` integer NOT NULL DEFAULT 0;")
      yield* tx.run(
        "CREATE INDEX IF NOT EXISTS `opencodex_state_event_created_idx` ON `opencodex_state_event` (`created_at`);",
      )
      yield* tx.run("ALTER TABLE `opencodex_view` ADD `sort_order` integer NOT NULL DEFAULT 0;")
      yield* tx.run(`
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY time_updated DESC, id) - 1 AS position
          FROM opencodex_view
        )
        UPDATE opencodex_view
        SET sort_order = (SELECT position FROM ranked WHERE ranked.id = opencodex_view.id);
      `)
      yield* tx.run("CREATE INDEX IF NOT EXISTS `opencodex_view_sort_idx` ON `opencodex_view` (`sort_order`);")
    })
  },
} satisfies DatabaseMigration.Migration

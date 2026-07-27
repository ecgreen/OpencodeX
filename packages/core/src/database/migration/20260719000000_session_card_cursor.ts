import type { DatabaseMigration } from "../migration"

export default {
  id: "20260719000000_session_card_cursor",
  up(tx) {
    return tx.run(
      "CREATE INDEX IF NOT EXISTS `session_time_updated_id_idx` ON `session` (`time_updated`, `id`);",
    )
  },
} satisfies DatabaseMigration.Migration

import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260725000000_terminal_session_mirror",
  up(tx) {
    return Effect.gen(function* () {
      // Links a Claude Code terminal session to the OpencodeX session its
      // headless conversation is mirrored into.
      yield* tx.run("ALTER TABLE `opencodex_terminal_session` ADD `session_id` text REFERENCES `session`(`id`) ON DELETE SET NULL;")
      yield* tx.run(
        "CREATE INDEX IF NOT EXISTS `opencodex_terminal_session_session_idx` ON `opencodex_terminal_session` (`session_id`);",
      )
    })
  },
} satisfies DatabaseMigration.Migration

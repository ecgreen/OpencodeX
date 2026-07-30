import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260729003748_great_unus",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP TABLE \`session_share\`;`)
      yield* tx.run(`ALTER TABLE \`session\` DROP COLUMN \`share_url\`;`)
    })
  },
} satisfies DatabaseMigration.Migration

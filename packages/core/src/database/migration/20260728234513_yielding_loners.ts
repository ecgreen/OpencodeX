import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260728234513_yielding_loners",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`session_message_session_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_message_session_type_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_message_time_created_idx\`;`)
      yield* tx.run(`DROP TABLE \`session_message\`;`)
    })
  },
} satisfies DatabaseMigration.Migration

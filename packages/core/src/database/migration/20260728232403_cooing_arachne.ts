import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260728232403_cooing_arachne",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`CREATE INDEX \`event_aggregate_seq_idx\` ON \`event\` (\`aggregate_id\`,\`seq\`);`)
    })
  },
} satisfies DatabaseMigration.Migration

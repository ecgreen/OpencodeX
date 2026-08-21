import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260821043607_dashing_ikaris",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`opencodex_swarm_role\` ADD \`fallback_models\` text DEFAULT '[]' NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration

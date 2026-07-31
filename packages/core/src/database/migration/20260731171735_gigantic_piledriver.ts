import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260731171735_gigantic_piledriver",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`opencodex_swarm_role\` ADD \`variant\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration

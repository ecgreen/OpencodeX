import type { DatabaseMigration } from "../migration"

export default {
  id: "20260725012451_chubby_lyja",
  up(tx) {
    // Drizzle reconciliation marker. The schema was introduced by the preceding
    // OpencodeX sidecar migrations, so executing the generated SQL would repeat it.
    return tx.run("SELECT 1")
  },
} satisfies DatabaseMigration.Migration

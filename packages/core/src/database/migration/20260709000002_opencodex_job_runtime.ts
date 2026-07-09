import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260709000002_opencodex_job_runtime",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run("ALTER TABLE `opencodex_job` ADD `idempotency_key` text;")
      yield* tx.run("ALTER TABLE `opencodex_job` ADD `attempt` integer NOT NULL DEFAULT 0;")
      yield* tx.run("ALTER TABLE `opencodex_job` ADD `max_attempts` integer NOT NULL DEFAULT 1;")
      yield* tx.run("ALTER TABLE `opencodex_job` ADD `lease_owner` text;")
      yield* tx.run("ALTER TABLE `opencodex_job` ADD `lease_expires_at` integer;")
      yield* tx.run("ALTER TABLE `opencodex_job` ADD `timeout_at` integer;")
      yield* tx.run("ALTER TABLE `opencodex_job` ADD `cancel_requested_at` integer;")
      yield* tx.run("ALTER TABLE `opencodex_job` ADD `result_json` text;")
      yield* tx.run("ALTER TABLE `opencodex_job` ADD `failure_json` text;")
      yield* tx.run("UPDATE `opencodex_job` SET `status` = 'succeeded' WHERE `status` = 'completed';")
      yield* tx.run(
        "UPDATE `opencodex_job` SET `status` = 'interrupted' WHERE `status` IN ('stale', 'input_needed', 'approval_needed', 'blocked');",
      )
      yield* tx.run(
        "CREATE UNIQUE INDEX IF NOT EXISTS `opencodex_job_idempotency_idx` ON `opencodex_job` (`idempotency_key`) WHERE `idempotency_key` IS NOT NULL;",
      )
      yield* tx.run(
        "CREATE INDEX IF NOT EXISTS `opencodex_job_lease_idx` ON `opencodex_job` (`status`, `lease_expires_at`);",
      )
    })
  },
} satisfies DatabaseMigration.Migration

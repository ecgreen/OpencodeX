import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260720010000_session_execution",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_execution\` (
          \`session_id\` text PRIMARY KEY NOT NULL,
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`state\` text NOT NULL,
          \`owner_id\` text,
          \`generation\` integer NOT NULL DEFAULT 0,
          \`lease_expires_at\` integer,
          \`cancel_requested_at\` integer,
          \`queued_at\` integer,
          \`started_at\` integer,
          \`completed_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(
        "CREATE INDEX `session_execution_state_idx` ON `session_execution` (`state`, `lease_expires_at`);",
      )
      yield* tx.run("CREATE INDEX `session_execution_directory_idx` ON `session_execution` (`directory`);")
      yield* tx.run(`
        CREATE TABLE \`session_status\` (
          \`session_id\` text PRIMARY KEY NOT NULL,
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`status\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run("CREATE INDEX `session_status_directory_idx` ON `session_status` (`directory`);")
      yield* tx.run(`
        CREATE TABLE \`session_interaction\` (
          \`id\` text PRIMARY KEY NOT NULL,
          \`kind\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`state\` text NOT NULL,
          \`request_json\` text NOT NULL,
          \`response_json\` text,
          \`responded_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(
        "CREATE INDEX `session_interaction_pending_idx` ON `session_interaction` (`kind`, `state`, `directory`);",
      )
      yield* tx.run(
        "CREATE INDEX `session_interaction_session_idx` ON `session_interaction` (`session_id`, `state`);",
      )
      yield* tx.run(`
        CREATE TABLE \`session_command\` (
          \`id\` text PRIMARY KEY NOT NULL,
          \`session_id\` text NOT NULL,
          \`message_id\` text NOT NULL,
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`status\` text NOT NULL,
          \`error\` text,
          \`owner_id\` text,
          \`claim_generation\` integer NOT NULL DEFAULT 0,
          \`lease_expires_at\` integer,
          \`started_at\` integer,
          \`completed_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(
        "CREATE INDEX `session_command_status_idx` ON `session_command` (`status`, `directory`);",
      )
      yield* tx.run(
        "CREATE INDEX `session_command_session_idx` ON `session_command` (`session_id`, `status`);",
      )
      yield* tx.run(
        "CREATE INDEX `session_command_lease_idx` ON `session_command` (`status`, `lease_expires_at`);",
      )
      yield* tx.run(
        "CREATE UNIQUE INDEX `session_command_message_idx` ON `session_command` (`session_id`, `message_id`);",
      )
    })
  },
} satisfies DatabaseMigration.Migration

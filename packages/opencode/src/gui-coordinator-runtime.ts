import { Database } from "@opencode-ai/core/database/database"
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"
import { ensureProcessMetadata } from "@opencode-ai/core/util/opencode-process"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { JsonMigration } from "@/storage/json-migration"
import { errorMessage } from "@/util/error"
import { Filesystem } from "@/util/filesystem"

export const initializeGuiCoordinator = Effect.fn("GuiCoordinator.initialize")(function* () {
  yield* Effect.promise(() =>
    Log.init({
      print: false,
      dev: InstallationLocal,
      level: InstallationLocal ? "DEBUG" : "INFO",
    }),
  )

  process.on("unhandledRejection", (error) => {
    Log.Default.error("rejection", { error: errorMessage(error) })
  })
  process.on("uncaughtException", (error) => {
    Log.Default.error("exception", { error: errorMessage(error) })
  })

  const processMetadata = ensureProcessMetadata("main")
  Log.Default.info("opencodex gui coordinator", {
    version: InstallationVersion,
    args: process.argv.slice(1),
    process_role: processMetadata.processRole,
    run_id: processMetadata.runID,
  })
})

export const migrateGuiCoordinatorDatabase = Effect.fn("GuiCoordinator.migrateDatabase")(function* () {
  const marker = Database.path()
  if (yield* Effect.promise(() => Filesystem.exists(marker))) return

  const sqlite = new (yield* Effect.promise(() => import("bun:sqlite"))).Database(marker)
  yield* Effect.acquireUseRelease(
    Effect.succeed(sqlite),
    (client) => Effect.promise(() => JsonMigration.run(drizzle({ client }))).pipe(Effect.asVoid),
    (client) => Effect.sync(() => client.close()),
  )
})

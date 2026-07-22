import { cmd } from "@/cli/cmd/cmd"
import { Effect } from "effect"
import { COORDINATOR_STARTUP_LOCK_HELD, coordinatorKey } from "./coordinator-registry"
import { runCoordinator } from "./coordinator-runner"

export const TuiCoordinatorCommand = cmd({
  command: "internal-tui-coordinator <directory>",
  describe: false,
  builder: (yargs) =>
    yargs
      .positional("directory", {
        type: "string",
        demandOption: true,
      })
      .option("key", {
        type: "string",
        demandOption: true,
      }),
  handler: async (args) => {
    if (typeof args.directory !== "string") throw new Error("directory is required")
    const key = coordinatorKey()
    if (typeof args.key !== "string" || args.key !== key) {
      throw new Error("TUI coordinator key does not match its database")
    }
    await Effect.runPromise(
      runCoordinator({
        directory: args.directory,
        key,
        startupLock: process.env[COORDINATOR_STARTUP_LOCK_HELD] !== "1",
      }),
    )
  },
})

import { Effect } from "effect"

const directory = process.argv[2]
const key = process.argv[3]
if (!directory || !key) throw new Error("directory and key are required")

const controller = new AbortController()
process.stdin.once("data", () => controller.abort())

const runtime = await import("@/gui-coordinator-runtime")
await Effect.runPromise(runtime.initializeGuiCoordinator())
const { runCoordinator } = await import("@/cli/cmd/tui/coordinator-runner")
await Effect.runPromise(
  runCoordinator({
    directory,
    key,
    signal: controller.signal,
    beforeStart: runtime.migrateGuiCoordinatorDatabase(),
  }),
)

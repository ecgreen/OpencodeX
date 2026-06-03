import { cmd } from "@/cli/cmd/cmd"
import { UI } from "@/cli/ui"
import { Server } from "@/server/server"
import { ServerAuth } from "@/server/auth"
import { errorMessage } from "@/util/error"
import { Filesystem } from "@/util/filesystem"
import {
  coordinatorKey,
  readActiveCoordinatorClientLeases,
  removeCoordinatorManifest,
  writeCoordinatorManifest,
} from "./coordinator-registry"
import * as Log from "@opencode-ai/core/util/log"

function env(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const FIRST_CLIENT_TIMEOUT = 60_000
const IDLE_SHUTDOWN_TIMEOUT = 5_000
const CLIENT_MONITOR_INTERVAL = 2_000

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
    const directory = Filesystem.resolve(args.directory)
    const key = typeof args.key === "string" ? args.key : coordinatorKey(directory)
    const username = env("OPENCODE_TUI_COORDINATOR_USERNAME")
    const password = env("OPENCODE_TUI_COORDINATOR_PASSWORD")
    const token = env("OPENCODE_TUI_COORDINATOR_TOKEN")

    try {
      process.chdir(directory)
    } catch {
      UI.error("Failed to change directory to " + directory)
      process.exitCode = 1
      return
    }

    let stopped = false
    let server: Awaited<ReturnType<typeof Server.listen>> | undefined
    let clientMonitor: ReturnType<typeof createClientMonitor> | undefined

    const disposeSessions = async () => {
      if (!server) return
      const response = await fetch(new URL("/global/dispose", server.url), {
        method: "POST",
        headers: ServerAuth.headers({ username, password }),
      })
      if (!response.ok) throw new Error(await response.text())
    }

    const stop = async (reason = "requested") => {
      if (stopped) return
      stopped = true
      clientMonitor?.dispose()
      Log.Default.info("tui coordinator stopping", { reason })
      await disposeSessions().catch((error) => {
        Log.Default.warn("tui coordinator dispose failed", { error: errorMessage(error) })
      })
      await removeCoordinatorManifest(key, token).catch(() => undefined)
      await server?.stop(true).catch((error) => {
        Log.Default.warn("tui coordinator server stop failed", { error: errorMessage(error) })
      })
    }

    server = await Server.listen({
      hostname: "127.0.0.1",
      port: 0,
      mdns: false,
      cors: [],
    })

    await writeCoordinatorManifest({
      version: 1,
      key,
      directory,
      pid: process.pid,
      url: server.url.toString(),
      username,
      password,
      token,
      createdAt: new Date().toISOString(),
    })

    clientMonitor = createClientMonitor(key, (reason) => void stop(reason).finally(() => process.exit(0)))

    const signal = () => {
      void stop("signal").finally(() => process.exit(0))
    }

    process.on("SIGINT", signal)
    process.on("SIGTERM", signal)
    process.on("SIGHUP", signal)
    process.on("beforeExit", () => {
      void stop("beforeExit")
    })

    await new Promise(() => {})
  },
})

function createClientMonitor(key: string, stop: (reason: string) => void) {
  let sawClient = false
  let disposed = false
  let lastClientCount = -1
  let firstClientTimer: Timer | undefined
  let shutdownTimer: Timer | undefined

  const cancelShutdown = () => {
    if (!shutdownTimer) return
    clearTimeout(shutdownTimer)
    shutdownTimer = undefined
  }

  const cancelFirstClientTimeout = () => {
    if (!firstClientTimer) return
    clearTimeout(firstClientTimer)
    firstClientTimer = undefined
  }

  const scheduleShutdown = (reason: string, timeout: number) => {
    cancelShutdown()
    shutdownTimer = setTimeout(() => stop(reason), timeout)
    shutdownTimer.unref?.()
  }

  const check = async () => {
    if (disposed) return
    const leases = await readActiveCoordinatorClientLeases(key)
    if (leases.length > 0) {
      sawClient = true
      cancelFirstClientTimeout()
      cancelShutdown()
      if (lastClientCount !== leases.length) {
        Log.Default.info("tui coordinator clients active", { clients: leases.length })
        lastClientCount = leases.length
      }
      return
    }
    if (lastClientCount !== 0) {
      Log.Default.info("tui coordinator clients active", { clients: 0 })
      lastClientCount = 0
    }
    if (!sawClient) return
    if (shutdownTimer) return
    scheduleShutdown("all TUI clients closed", IDLE_SHUTDOWN_TIMEOUT)
  }

  firstClientTimer = setTimeout(() => stop("no TUI clients connected"), FIRST_CLIENT_TIMEOUT)
  firstClientTimer.unref?.()
  const interval = setInterval(() => {
    void check().catch((error) => {
      Log.Default.warn("tui coordinator client monitor failed", { error: errorMessage(error) })
    })
  }, CLIENT_MONITOR_INTERVAL)
  interval.unref?.()
  void check()

  return {
    dispose() {
      if (disposed) return
      disposed = true
      cancelFirstClientTimeout()
      cancelShutdown()
      clearInterval(interval)
    },
  }
}

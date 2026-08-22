import { Installation } from "@/installation"
import { Server, type Listener } from "@/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { ServerAuth } from "@/server/auth"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { ensureProcessMetadata } from "@opencode-ai/core/util/opencode-process"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Effect } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { manifestURLFor, validateServeAuthorityNetwork } from "@/cli/cmd/serve-authority"
import { errorMessage } from "@/util/error"
import { Filesystem } from "@/util/filesystem"
import {
  acquireCoordinatorOwnerLock,
  coordinatorDatabaseIdentity,
  coordinatorKey,
  readActiveCoordinator,
  removeCoordinatorManifest,
  writeCoordinatorManifest,
  type TuiCoordinatorManifest,
} from "./coordinator-registry"
import { randomBytes } from "crypto"
import { createWorkerGate, WorkerShuttingDownError } from "./worker-gate"

ensureProcessMetadata("worker")

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

Heap.start()

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])
const WILDCARD_HOSTS = new Set(["0.0.0.0", "::"])
const DEFAULT_USERNAME = "opencodex-local"

/*
 * The explicit-network TUI path (`--port`/`--hostname`/`--mdns`) serves the
 * database from this worker. To keep the one-writer-per-database invariant it
 * participates in the same authority protocol as the TUI coordinator and
 * `opencode serve`: it claims the per-database owner lock, publishes the same
 * v2 manifest (with a loopback companion when a LAN listener is requested),
 * and removes both on shutdown. A live authority is never replaced — if one
 * appears while this worker boots, it fails closed instead.
 */
type OwnedBackend = {
  key: string
  token: string
  ownerLock: { release: () => Promise<void> }
  manifest: TuiCoordinatorManifest
  listeners: Listener[]
}

let owned: OwnedBackend | undefined

// Serializes shutdown with in-flight instance work: dispose must never kill
// the database while a bootstrap statement is mid-flight (OpencodeX-l1v).
const gate = createWorkerGate()

export const rpc = {
  fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    return gate.run(async () => {
      const headers = { ...input.headers }
      const auth = ServerAuth.header()
      if (auth && !headers["authorization"] && !headers["Authorization"]) {
        headers["Authorization"] = auth
      }
      const request = new Request(input.url, {
        method: input.method,
        headers,
        body: input.body,
      })
      const response = await Server.Default().app.fetch(request)
      const body = await response.text()
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      }
    })
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  server(input: { port: number; hostname: string; mdns?: boolean; mdnsDomain?: string; cors?: string[] }) {
    return gate.run(() => startServer(input))
  },
  async checkUpgrade(input: { directory: string }) {
    // Only the instance load races disposal; the upgrade check is network I/O
    // (and possibly a binary install) that must not hold the shutdown drain.
    await gate.run(() => InstanceRuntime.load({ directory: input.directory }))
    await upgrade().catch(() => {})
  },
  reload() {
    return gate.run(async () => {
      await AppRuntime.runPromise(
        Effect.gen(function* () {
          const cfg = yield* Config.Service
          yield* cfg.invalidate()
          yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
        }),
      )
    })
  },
  async shutdown() {
    Log.Default.info("worker shutting down")

    // Close the gate and let in-flight instance work settle before disposal;
    // a shutdown mid-bootstrap otherwise kills the database mid-statement.
    const drained = await gate.drain()
    if (!drained) Log.Default.warn("worker shutdown proceeding with unsettled rpc work")
    await InstanceRuntime.disposeAllInstances()
    await stopOwnedBackend("shutdown").catch((error) => {
      Log.Default.warn("worker backend authority stop failed", { error: errorMessage(error) })
    })
  },
}

async function startServer(input: {
  port: number
  hostname: string
  mdns?: boolean
  mdnsDomain?: string
  cors?: string[]
}) {
  const username = process.env.OPENCODE_TUI_COORDINATOR_USERNAME ?? DEFAULT_USERNAME
  const password = process.env.OPENCODE_TUI_COORDINATOR_PASSWORD ?? ""
  await Effect.runPromise(
    validateServeAuthorityNetwork({
      hostname: input.hostname,
      password,
      allowInsecureLan: process.env.OPENCODE_SERVER_ALLOW_INSECURE_LAN,
    }),
  )
  await stopOwnedBackend("reconfigured").catch((error) => {
    Log.Default.warn("worker backend authority stop on reconfigure failed", { error: errorMessage(error) })
  })
  const database = coordinatorDatabaseIdentity()
  const key = coordinatorKey(database)
  const token = process.env.OPENCODE_TUI_COORDINATOR_TOKEN ?? randomBytes(24).toString("base64url")
  process.env.OPENCODE_SERVER_USERNAME = username
  process.env.OPENCODE_SERVER_PASSWORD = password

  const ownerLock = await acquireCoordinatorOwnerLock(key)
  let listeners: Listener[] | undefined
  try {
    const existing = await readActiveCoordinator(key, database)
    if (existing) throw collidingAuthorityError(existing)
    const needsCompanion = !LOOPBACK_HOSTS.has(input.hostname) && !WILDCARD_HOSTS.has(input.hostname)
    const primary = {
      hostname: input.hostname,
      port: input.port,
      mdns: input.mdns,
      mdnsDomain: input.mdnsDomain,
      cors: input.cors ?? [],
    }
    listeners = needsCompanion
      ? await Server.listenShared([
          primary,
          // A loopback socket sharing the same in-process event bus so local
          // and LAN subscribers see one authority.
          { hostname: "127.0.0.1", port: 0, mdns: false, prefer4096: false },
        ])
      : await Server.listenShared([primary])
    const claimed = await readActiveCoordinator(key, database)
    if (claimed) throw collidingAuthorityError(claimed)
    // A drain timeout means shutdown has already run stopOwnedBackend and
    // moved on; publishing a manifest now would leak listeners, the manifest,
    // and the owner lock past the worker's death. Fail into the catch below,
    // which stops the sockets and releases the lock.
    if (gate.draining) throw new WorkerShuttingDownError()
    const companion = needsCompanion ? listeners[1] : undefined
    const manifest = {
      version: 2 as const,
      key,
      directory: Filesystem.resolve(process.cwd()),
      database,
      pid: process.pid,
      url: manifestURLFor(input.hostname, listeners[0].port, companion),
      username,
      password,
      token,
      createdAt: new Date().toISOString(),
      serverVersion: InstallationVersion,
    }
    await writeCoordinatorManifest(manifest)
    owned = { key, token, ownerLock, manifest, listeners }
    return { url: manifest.url }
  } catch (error) {
    // A failure after the sockets bound (e.g. the manifest write) must not
    // leave listeners serving a database nobody owns: stop them before the
    // owner lock is released so no window exists where a racing client can
    // attach to an unbranded authority.
    if (listeners) await stopListeners(listeners).catch(() => {})
    await ownerLock.release().catch(() => {})
    throw error
  }
}

function collidingAuthorityError(manifest: TuiCoordinatorManifest) {
  return new Error(
    `A backend authority is already serving this database (pid ${manifest.pid}, url ${manifest.url}); refusing to start a second one`,
  )
}

async function stopListeners(listeners: Listener[]) {
  await Promise.all(listeners.map((listener) => listener.stop(true).catch(() => undefined)))
}

async function stopOwnedBackend(reason: string) {
  const current = owned
  owned = undefined
  if (!current) return
  Log.Default.info("worker backend authority stopping", { reason })
  const disposeURL = current.manifest.url
  await fetch(new URL("/global/dispose", disposeURL), {
    method: "POST",
    headers: ServerAuth.headers({
      username: current.manifest.username,
      password: current.manifest.password,
    }),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(await response.text())
    })
    .catch((error) => {
      Log.Default.warn("worker backend authority dispose failed", { error: errorMessage(error) })
    })
  // Both sockets stop together: the shared scope closes on the first stop and
  // application disposal runs once; the remaining stops are idempotent.
  await stopListeners(current.listeners)
  await removeCoordinatorManifest(current.key, current.token).catch(() => {})
  await current.ownerLock.release().catch((error) => {
    Log.Default.warn("worker backend authority owner lock release failed", { error: errorMessage(error) })
  })
}

Rpc.listen(rpc)

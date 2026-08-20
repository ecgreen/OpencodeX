import { Database } from "@opencode-ai/core/database/database"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Log } from "@opencode-ai/core/util/log"
import { ensureRunID, OPENCODE_PROCESS_ROLE } from "@opencode-ai/core/util/opencode-process"
import { Effect } from "effect"
import { randomBytes } from "crypto"
import { ServerAuth } from "@/server/auth"
import { Server, type Listener } from "@/server/server"
import { errorMessage } from "@/util/error"
import { Filesystem } from "@/util/filesystem"
import {
  acquireCoordinatorOwnerLock,
  coordinatorDatabaseIdentity,
  coordinatorKey,
  coordinatorStartupLock,
  readActiveCoordinator,
  removeCoordinatorManifest,
  writeCoordinatorManifest,
  type TuiCoordinatorManifest,
} from "./tui/coordinator-registry"

/**
 * Shared backend authority for `opencodex serve`.
 *
 * Serve becomes the per-database authority exactly like the TUI coordinator:
 * it claims the same owner lock, publishes the same v2 manifest under the same
 * key, and tears the manifest/lock down with the same token-matched cleanup.
 * The one deliberate difference is lifetime: serve does not arm the client
 * lease monitor, so it stays alive with zero leases and only exits on signal.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])
const WILDCARD_HOSTS = new Set(["0.0.0.0", "::"])
const DEFAULT_USERNAME = "opencode"

export type ServeAuthorityOptions = {
  hostname: string
  port: number
  mdns?: boolean
  mdnsDomain?: string
  cors?: string[]
  signal?: AbortSignal
}

type OwnedServeAuthority = {
  manifest: TuiCoordinatorManifest
  ownerLock: { release: () => Promise<void> }
  listeners: Listener[]
  companion?: Listener
  reason: string
  stopped: boolean
}

export const runServeAuthority = Effect.fn("ServeAuthority.run")(function* (input: ServeAuthorityOptions) {
  const directory = Filesystem.resolve(process.cwd())
  const database = coordinatorDatabaseIdentity(Database.path())
  const key = coordinatorKey(database)
  const username = process.env.OPENCODE_SERVER_USERNAME ?? DEFAULT_USERNAME
  const password = process.env.OPENCODE_SERVER_PASSWORD ?? ""
  const token = randomBytes(24).toString("base64url")

  process.env[OPENCODE_PROCESS_ROLE] = "main"
  ensureRunID()

  return yield* Effect.acquireUseRelease(
    startServeAuthority({ ...input, directory, database, key, username, password, token }),
    (resource) => {
      const primary = resource.listeners[0]
      // Normal console output so the CLI can keep parsing the listening line.
      console.log(`opencode server listening on http://${primary.hostname}:${primary.port}`)
      return waitForShutdown(resource, input.signal).pipe(
        Effect.tap((reason) =>
          Effect.sync(() => {
            resource.reason = reason
          }),
        ),
        Effect.as(resource.manifest),
      )
    },
    (resource) => {
      return stopServeAuthority(resource, resource.reason || "interrupted")
    },
  )
})

function startServeAuthority(
  input: ServeAuthorityOptions & {
    directory: string
    database: string
    key: string
    username: string
    password: string
    token: string
  },
) {
  const start = Effect.fnUntraced(function* () {
    if (input.signal?.aborted) return yield* Effect.interrupt
    // A live authority (TUI coordinator, GUI sidecar, or another serve) must be
    // left strictly alone: attaching two writers to one database is the exact
    // failure this protocol exists to prevent. Fail loudly instead.
    const existing = yield* Effect.promise(() => readActiveCoordinator(input.key, input.database))
    if (existing) return yield* Effect.fail(collidingAuthorityError(existing))
    const ownerLock = yield* Effect.tryPromise({
      try: () => acquireCoordinatorOwnerLock(input.key),
      catch: (error) => error,
    }).pipe(
      Effect.catchIf(
        () => true,
        (error) =>
          Effect.gen(function* () {
            // Another contender may have won the lock while this process waited.
            // Surface the clear collision error when a healthy authority now
            // exists; otherwise preserve the underlying acquisition failure.
            const now = yield* Effect.promise(() => readActiveCoordinator(input.key, input.database))
            if (now) return yield* Effect.fail(collidingAuthorityError(now))
            return yield* Effect.fail(new Error(`Failed to acquire backend authority: ${errorMessage(error)}`))
          }),
      ),
    )
    const launch = Effect.gen(function* () {
      const claimed = yield* Effect.promise(() => readActiveCoordinator(input.key, input.database))
      if (claimed) {
        yield* Effect.promise(() => ownerLock.release())
        return yield* Effect.fail(collidingAuthorityError(claimed))
      }
      if (input.signal?.aborted) return yield* Effect.interrupt

      const needsCompanion = !LOOPBACK_HOSTS.has(input.hostname) && !WILDCARD_HOSTS.has(input.hostname)
      const primary = {
        hostname: input.hostname,
        port: input.port,
        mdns: input.mdns,
        mdnsDomain: input.mdnsDomain,
        cors: input.cors ?? [],
      }
      const options: Parameters<typeof Server.listenShared>[0] = needsCompanion
        ? [
            primary,
            // A loopback socket sharing the same in-process application state so
            // LAN and local subscribers see one event bus. Ephemeral port: this
            // is not the legacy serve port, and 4096 may already be a LAN bind.
            { hostname: "127.0.0.1", port: 0, mdns: false, prefer4096: false },
          ]
        : [primary]
      const listeners = yield* Effect.promise(() => Server.listenShared(options))
      const companion = needsCompanion ? listeners[1] : undefined
      const manifest = {
        version: 2 as const,
        key: input.key,
        directory: input.directory,
        database: input.database,
        pid: process.pid,
        url: manifestURLFor(input.hostname, listeners[0].port, companion),
        username: input.username,
        password: input.password,
        token: input.token,
        createdAt: new Date().toISOString(),
        /* Same additive field as the coordinator so attaching clients can
           verify SDK/server skew before reaching the process. Schema stays 2. */
        serverVersion: InstallationVersion,
      }
      return yield* Effect.promise(() => writeCoordinatorManifest(manifest)).pipe(
        Effect.as({
          manifest,
          ownerLock,
          listeners,
          companion,
          reason: "" as string,
          stopped: false,
        }),
        Effect.onError(() =>
          Effect.all(listeners.map((listener) => Effect.promise(() => listener.stop(true))), { discard: true }).pipe(
            Effect.ignore,
          ),
        ),
      )
    })
    return yield* launch.pipe(Effect.onError(() => Effect.promise(() => ownerLock.release()).pipe(Effect.ignore)))
  })

  return Effect.scoped(
    Effect.gen(function* () {
      yield* coordinatorStartupLock(input.key)
      return yield* start()
    }),
  )
}

export function manifestURLFor(hostname: string, primaryPort: number, companion?: Listener) {
  const port = companion ? companion.port : primaryPort
  // Loopback hosts publish themselves; wildcard and LAN listeners publish a
  // loopback address (the companion socket in the LAN case). `::` and `::1`
  // resolve to the bracketed IPv6 loopback form `[::1]` (the WHATWG URL
  // hostname setter drops a bare IPv6 address), while 0.0.0.0 and LAN
  // hostnames use the IPv4 127.0.0.1 that their sockets map to.
  const host =
    hostname === "::" || hostname === "::1" ? "[::1]" : LOOPBACK_HOSTS.has(hostname) ? hostname : "127.0.0.1"
  return new URL(`http://${host}:${port}`).toString()
}

function collidingAuthorityError(manifest: TuiCoordinatorManifest) {
  return new Error(
    `A backend authority is already serving this database (pid ${manifest.pid}, url ${manifest.url}); refusing to start a second one`,
  )
}

function waitForShutdown(resource: OwnedServeAuthority, signal?: AbortSignal) {
  return Effect.callback<string>((resume) => {
    let completed = false
    const finish = (reason: string) => {
      if (completed) return
      completed = true
      resume(Effect.succeed(reason))
    }
    const onSignal = () => finish("signal")
    const onAbort = () => finish("abort")
    const onBeforeExit = () => finish("beforeExit")

    process.on("SIGINT", onSignal)
    process.on("SIGTERM", onSignal)
    process.on("SIGHUP", onSignal)
    process.on("beforeExit", onBeforeExit)
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) onAbort()

    return Effect.sync(() => {
      signal?.removeEventListener("abort", onAbort)
      process.off("SIGINT", onSignal)
      process.off("SIGTERM", onSignal)
      process.off("SIGHUP", onSignal)
      process.off("beforeExit", onBeforeExit)
    })
  })
}

function stopServeAuthority(resource: OwnedServeAuthority, reason: string) {
  return Effect.gen(function* () {
    if (resource.stopped) return
    resource.stopped = true
    Log.Default.info("backend authority stopping", { reason })
    // Dispose through the connectable URL published to clients. This is the
    // companion for LAN binds and loopback for wildcard binds.
    const disposeURL = resource.manifest.url
    yield* Effect.tryPromise(() =>
      fetch(new URL("/global/dispose", disposeURL), {
        method: "POST",
        headers: ServerAuth.headers({
          username: resource.manifest.username,
          password: resource.manifest.password,
        }),
      }).then(async (response) => {
        if (!response.ok) throw new Error(await response.text())
      }),
    ).pipe(
      Effect.catch((error) =>
        Effect.sync(() => Log.Default.warn("backend authority dispose failed", { error: errorMessage(error) })),
      ),
    )
    // Both sockets stop together. Stopping the first closes the shared scope,
    // so application disposal runs once; the second stop is idempotent.
    yield* Effect.all(
      resource.listeners.map((listener) => Effect.tryPromise(() => listener.stop(true))),
      { discard: true },
    ).pipe(
      Effect.catch((error) =>
        Effect.sync(() => Log.Default.warn("backend authority server stop failed", { error: errorMessage(error) })),
      ),
    )
    // Token-matched removal only: a manifest published by a successor must not
    // be deleted by this process's shutdown.
    yield* Effect.tryPromise(() => removeCoordinatorManifest(resource.manifest.key, resource.manifest.token)).pipe(
      Effect.ignore,
    )
    yield* Effect.tryPromise(() => resource.ownerLock.release()).pipe(
      Effect.catch((error) =>
        Effect.sync(() => Log.Default.warn("backend authority owner lock release failed", { error: errorMessage(error) })),
      ),
    )
  })
}

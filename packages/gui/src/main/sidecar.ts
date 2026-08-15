import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { rememberBackendAuthority } from "./backend-authority.js"
import fs from "node:fs"
import path from "node:path"
import {
  checkCoordinatorCompatibility,
  coordinatorClientDir,
  fetchCoordinatorHealth,
  isCoordinatorClientLease,
  isCoordinatorHealthForManifest,
  isCoordinatorProcessAlive,
  isMissingCoordinatorFile,
  readCoordinatorManifestFile,
  readCoordinatorManifestToken,
  removeCoordinatorManifest as removeCoordinatorManifestIn,
  startCoordinatorClientLease as startCoordinatorClientLeaseIn,
} from "@opencode-ai/sdk/coordinator"
import {
  COORDINATOR_STATE_ROOT,
  COORDINATOR_USERNAME,
  coordinatorDatabaseIdentity,
  coordinatorKey,
  coordinatorManifestPath,
  coordinatorStartupLogPath,
  createSidecarLaunch,
  createStartupLog,
  selectedDatabaseEnv,
  sidecarDatabase,
  sidecarVersion,
  startError,
  startupLogDetails,
  workingDirectory,
  type CoordinatorManifest,
  type SidecarLaunch,
} from "./sidecar-launch.js"
import { stopDetachedChild } from "./sidecar-lifecycle.js"

export type SidecarConnection = {
  url: string
  username: string
  password: string
  directory: string
}

type SidecarState = {
  child?: { process: ChildProcess; key: string; token: string }
  owned?: { process: ChildProcess; key: string; token: string }
  connection?: SidecarConnection
  startup?: Promise<SidecarConnection>
  lease?: { dispose: () => Promise<void> }
  controller?: AbortController
  generation: number
}

/**
 * A coordinator whose server version this GUI cannot verify is refused, never
 * replaced: the manifest stays, the process keeps running, and any client that
 * does match it stays attached. Killing it would put a second writer on the
 * same database, which is the failure the whole attach protocol prevents.
 */
class CoordinatorVersionMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CoordinatorVersionMismatchError"
  }
}

/* Generous on purpose: the coordinator is `bun run` over the full opencode
   source graph, and a dev machine under load (builds, test suites) can push a
   cold start well past 15s. The wait loop still returns the moment the
   manifest appears, so the ceiling only matters on slow starts. */
const START_TIMEOUT = 45_000
const CLIENT_HEARTBEAT_INTERVAL = 2_000
const CLIENT_STALE_MS = 10_000
const state: SidecarState = { generation: 0 }

export function startSidecar(signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(startupStoppedError())
  if (state.connection) return Promise.resolve(state.connection)
  if (state.startup) return state.startup

  const generation = state.generation
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener("abort", abort, { once: true })
  const directory = workingDirectory()
  const startup = coordinatorConnection(directory, controller.signal)
    .then(async (manifest) => {
      if (generation !== state.generation || controller.signal.aborted) throw startupStoppedError()
      const lease = startCoordinatorClientLease(manifest.key)
      try {
        await lease.ready
      } catch (error) {
        await lease.dispose()
        throw error
      }
      if (generation !== state.generation || controller.signal.aborted) {
        await lease.dispose()
        throw startupStoppedError()
      }
      if (state.lease) await state.lease.dispose()
      if (generation !== state.generation || controller.signal.aborted) {
        await lease.dispose()
        throw startupStoppedError()
      }
      state.lease = lease
      if (state.child?.process.pid === manifest.pid && process.env.OPENCODEX_GUI_SMOKE !== "1")
        state.child = undefined
      if (state.owned && (state.owned.process.pid !== manifest.pid || state.owned.token !== manifest.token)) {
        state.owned = undefined
      }
      const connection = connectionFromManifest(manifest, directory)
      state.connection = connection
      return connection
    })
    .finally(() => {
      signal?.removeEventListener("abort", abort)
      if (state.startup !== startup) return
      state.startup = undefined
      state.controller = undefined
    })

  state.controller = controller
  state.startup = startup
  return startup
}

export function stopSidecar() {
  return stopSidecarNow(false)
}

export function stopSidecarForRestart() {
  return stopSidecarNow(true)
}

async function stopSidecarNow(restart: boolean) {
  state.generation += 1
  const startup = state.startup
  const lease = state.lease
  const child = restart ? state.owned ?? state.child : state.child
  state.controller?.abort()
  state.controller = undefined
  state.lease = undefined
  state.child = undefined
  state.connection = undefined
  state.startup = undefined
  if (restart || state.owned === child) state.owned = undefined
  await Promise.all([
    lease?.dispose(),
    child ? stopOwnedCoordinator(child) : undefined,
    startup?.catch(() => undefined),
  ])
}

export async function assertSidecarRestartAllowed() {
  const database = await sidecarDatabase(workingDirectory())
  const key = coordinatorKey(database)
  const manifest = await readActiveManifest(key)
  if (!manifest) {
    if (state.owned?.process.pid !== undefined && isCoordinatorProcessAlive(state.owned.process.pid)) {
      throw new Error("Backend restart is waiting for the coordinator manifest to recover.")
    }
    return
  }
  const health = await fetchCoordinatorHealth(manifest)
  if (health?.healthy !== true) {
    if (!isCoordinatorProcessAlive(manifest.pid)) {
      await removeCoordinatorManifest(key, manifest.token).catch(() => undefined)
      return
    }
    throw new Error("Backend restart is waiting for the coordinator health check to recover.")
  }
  if (!isCoordinatorHealthForManifest(manifest, health)) {
    throw new Error("Backend restart refused because the coordinator serves a different database.")
  }
  if (health.active) throw new Error("Backend restart is waiting for active work to finish.")
  if (state.owned?.process.pid !== manifest.pid || state.owned.token !== manifest.token) {
    throw new Error("Backend restart is not managed by this client.")
  }
  if (await hasOtherActiveClient(key)) {
    throw new Error("Backend restart is waiting for another OpencodeX client to disconnect.")
  }
}

async function hasOtherActiveClient(key: string) {
  const dir = coordinatorClientDir(COORDINATOR_STATE_ROOT, key)
  const clients = await Promise.all(
    (await fs.promises.readdir(dir).catch(() => []))
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const pid = Number(name.split(".")[0])
        if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || !isCoordinatorProcessAlive(pid)) return false
        const file = path.join(dir, name)
        const lease = await fs.promises.readFile(file, "utf8")
          .then((value) => JSON.parse(value) as unknown)
          .catch(() => undefined)
        if (isCoordinatorClientLease(lease)) {
          return lease.key === key && Date.now() - lease.updatedAt <= CLIENT_STALE_MS
        }
        const stat = await fs.promises.stat(file).catch(() => undefined)
        return stat !== undefined && Date.now() - stat.mtimeMs <= CLIENT_STALE_MS
      }),
  )
  return clients.some(Boolean)
}

async function coordinatorConnection(directory: string, signal: AbortSignal) {
  const database = await sidecarDatabase(directory)
  await rememberBackendAuthority(database)
  const key = coordinatorKey(database)
  throwIfStartupStopped(signal)
  const existing = await activeCoordinator(key, database)
  throwIfStartupStopped(signal)
  if (existing) return existing
  throwIfStartupStopped(signal)
  return spawnCoordinator(directory, key, database, signal)
}

function connectionFromManifest(manifest: CoordinatorManifest, directory: string) {
  return {
    url: manifest.url,
    username: manifest.username,
    password: manifest.password,
    directory,
  }
}

async function activeCoordinator(key: string, database: string) {
  const manifest = await readActiveManifest(key)
  if (!manifest) return undefined
  if (
    manifest.key !== key ||
    coordinatorDatabaseIdentity(manifest.database) !== coordinatorDatabaseIdentity(database)
  ) {
    await removeCoordinatorManifest(key, manifest.token)
    return undefined
  }
  const health = await fetchCoordinatorHealth(manifest)
  if (health?.healthy === true) {
    if (!isCoordinatorHealthForManifest(manifest, health)) {
      if (isCoordinatorProcessAlive(manifest.pid)) {
        throw new Error(
          `OpencodeX coordinator process ${manifest.pid} answered for a different database; refusing to attach`,
        )
      }
      await removeCoordinatorManifest(key, manifest.token)
      return undefined
    }
    const compatibility = checkCoordinatorCompatibility({
      manifest,
      clientVersion: sidecarVersion(),
      healthVersion: health.version,
    })
    if (!compatibility.compatible) {
      throw new CoordinatorVersionMismatchError(compatibility.message ?? "Coordinator version mismatch")
    }
    if (compatibility.reason === "local" && compatibility.message) console.warn(compatibility.message)
    return manifest
  }
  if (isCoordinatorProcessAlive(manifest.pid)) {
    throw new Error(`OpencodeX coordinator process ${manifest.pid} is alive but unhealthy; refusing to replace it`)
  }
  await removeCoordinatorManifest(key, manifest.token)
  return undefined
}

async function readActiveManifest(key: string) {
  try {
    return await readCoordinatorManifest(key)
  } catch (error) {
    if (isMissingCoordinatorFile(error)) return undefined
    const token = await readCoordinatorManifestToken(coordinatorManifestPath(key))
    if (!token) throw new Error("Invalid TUI coordinator manifest cannot be removed safely", { cause: error })
    await removeCoordinatorManifest(key, token)
    return undefined
  }
}

function readCoordinatorManifest(key: string) {
  return readCoordinatorManifestFile(coordinatorManifestPath(key))
}

function removeCoordinatorManifest(key: string, token: string) {
  return removeCoordinatorManifestIn(COORDINATOR_STATE_ROOT, key, token)
}

function startCoordinatorClientLease(key: string) {
  /* The `.gui` suffix is load-bearing: the TUI scans for `*.gui.json` leases to
     decide which database an active GUI already owns. */
  return startCoordinatorClientLeaseIn({
    stateRoot: COORDINATOR_STATE_ROOT,
    key,
    suffix: ".gui",
    interval: CLIENT_HEARTBEAT_INTERVAL,
  })
}

async function spawnCoordinator(directory: string, key: string, database: string, signal: AbortSignal) {
  throwIfStartupStopped(signal)
  const password = randomBytes(32).toString("base64url")
  const token = randomBytes(32).toString("base64url")
  const started = { ...createSidecarLaunch(directory, key, database), startupLog: coordinatorStartupLogPath(key) }
  const child = (() => {
    const startupLog = createStartupLog(started)
    try {
      const spawned = spawn(started.command, started.args, {
        cwd: started.cwd,
        /* Detached everywhere, including Windows: a non-detached child shares
           the dev terminal's console process group, so a Ctrl-C aimed at the
           GUI dev process also signals the coordinator - which then shuts down
           gracefully even while an attached TUI still holds a client lease.
           `windowsHide` keeps the detached child from opening a console
           window. */
        detached: true,
        stdio: ["ignore", startupLog, startupLog],
        env: {
          ...process.env,
          ...selectedDatabaseEnv(started.database),
          OPENCODE_CLI_NAME: "opencodex",
          OPENCODE_TUI_COORDINATOR_USERNAME: COORDINATOR_USERNAME,
          OPENCODE_TUI_COORDINATOR_PASSWORD: password,
          OPENCODE_TUI_COORDINATOR_TOKEN: token,
          OPENCODE_SERVER_USERNAME: COORDINATOR_USERNAME,
          OPENCODE_SERVER_PASSWORD: password,
        },
        windowsHide: true,
      })
      fs.closeSync(startupLog)
      return spawned
    } catch (error) {
      fs.closeSync(startupLog)
      throw startError(error, started)
    }
  })()
  child.unref()
  const owned = { process: child, key, token }
  state.child = owned
  state.owned = owned
  try {
    return await waitForCoordinator(directory, child, started, signal)
  } catch (error) {
    await stopOwnedCoordinator(owned)
    if (state.child === owned) state.child = undefined
    if (state.owned === owned) state.owned = undefined
    throw error
  }
}

async function waitForCoordinator(directory: string, child: ChildProcess, started: SidecarLaunch, signal: AbortSignal) {
  const startedAt = Date.now()
  let failure: Error | undefined
  child.once("error", (error) => {
    failure = startError(error, started)
  })
  child.once("exit", (code, signal) => {
    failure = new Error(`OpencodeX coordinator exited before startup (${signal ?? code ?? "unknown"})${startupLogDetails(started)}`)
  })
  while (Date.now() - startedAt < START_TIMEOUT) {
    throwIfStartupStopped(signal)
    const manifest = await activeCoordinator(coordinatorKey(started.database), started.database)
    throwIfStartupStopped(signal)
    if (manifest) return manifest
    if (failure) throw failure
    await startupDelay(signal)
  }
  throw new Error(`Timed out waiting for OpencodeX coordinator to start${startupLogDetails(started)}`)
}

function throwIfStartupStopped(signal: AbortSignal) {
  if (signal.aborted) throw startupStoppedError()
}

function startupStoppedError() {
  const error = new Error("Sidecar startup was stopped")
  error.name = "AbortError"
  return error
}

function startupDelay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, 150)
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      reject(startupStoppedError())
    }
    function done() {
      signal.removeEventListener("abort", abort)
      resolve()
    }
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
  })
}

async function stopOwnedCoordinator(owned: NonNullable<SidecarState["child"]>) {
  const child = owned.process
  await stopDetachedChild(child)
  const manifest = await readCoordinatorManifest(owned.key).catch(() => undefined)
  if (!manifest || manifest.pid !== child.pid || manifest.token !== owned.token) return
  await removeCoordinatorManifest(owned.key, owned.token).catch(() => undefined)
}

import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import {
  COORDINATOR_USERNAME,
  coordinatorClientDir,
  coordinatorDatabaseIdentity,
  coordinatorHeaders,
  coordinatorKey,
  coordinatorManifestPath,
  coordinatorStartupLogPath,
  createSidecarLaunch,
  createStartupLog,
  normalizeDirectory,
  selectedDatabaseEnv,
  sidecarDatabase,
  startError,
  startupLogDetails,
  workingDirectory,
  type CoordinatorManifest,
  type SidecarLaunch,
} from "./sidecar-launch.js"
import { loopbackSidecarURL } from "./sidecar-connection.js"
import { stopDetachedChild } from "./sidecar-lifecycle.js"

export type SidecarConnection = {
  url: string
  username: string
  password: string
  directory: string
}

type SidecarState = {
  child?: { process: ChildProcess; key: string; token: string }
  connection?: SidecarConnection
  startup?: Promise<SidecarConnection>
  lease?: { dispose: () => Promise<void> }
  controller?: AbortController
  generation: number
}

const START_TIMEOUT = 15_000
const CLIENT_HEARTBEAT_INTERVAL = 2_000
const state: SidecarState = { generation: 0 }

export function startSidecar(signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(startupStoppedError())
  if (state.connection) return Promise.resolve(state.connection)
  if (state.startup) return state.startup

  const generation = state.generation
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener("abort", abort, { once: true })
  const startup = coordinatorConnection(workingDirectory(), controller.signal)
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
      const connection = connectionFromManifest(manifest)
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

export async function stopSidecar() {
  state.generation += 1
  const startup = state.startup
  const lease = state.lease
  const child = state.child
  state.controller?.abort()
  state.controller = undefined
  state.lease = undefined
  state.child = undefined
  state.connection = undefined
  state.startup = undefined
  await Promise.all([
    lease?.dispose(),
    child ? stopOwnedCoordinator(child) : undefined,
    startup?.catch(() => undefined),
  ])
}

async function coordinatorConnection(directory: string, signal: AbortSignal) {
  const database = await sidecarDatabase(directory)
  const key = coordinatorKey(directory, database)
  throwIfStartupStopped(signal)
  const existing = await activeCoordinator(directory, key, database)
  throwIfStartupStopped(signal)
  if (existing) return existing
  throwIfStartupStopped(signal)
  return spawnCoordinator(directory, key, database, signal)
}

function connectionFromManifest(manifest: CoordinatorManifest) {
  return {
    url: manifest.url,
    username: manifest.username,
    password: manifest.password,
    directory: manifest.directory,
  }
}

async function activeCoordinator(directory: string, key: string, database: string) {
  const manifest = await readCoordinatorManifest(key).catch(() => undefined)
  if (!manifest) return undefined
  if (
    manifest.key !== key ||
    normalizeDirectory(manifest.directory) !== normalizeDirectory(directory) ||
    coordinatorDatabaseIdentity(manifest.database) !== coordinatorDatabaseIdentity(database)
  ) {
    await fs.promises.rm(coordinatorManifestPath(key), { force: true }).catch(() => undefined)
    return undefined
  }
  if (await isSidecarConnectionHealthy(manifest)) return manifest
  await fs.promises.rm(coordinatorManifestPath(key), { force: true }).catch(() => undefined)
  return undefined
}

async function readCoordinatorManifest(key: string) {
  const parsed = JSON.parse(await fs.promises.readFile(coordinatorManifestPath(key), "utf8")) as Partial<CoordinatorManifest>
  if (
    parsed.version !== 2 ||
    typeof parsed.key !== "string" ||
    typeof parsed.directory !== "string" ||
    typeof parsed.database !== "string" ||
    typeof parsed.pid !== "number" ||
    typeof parsed.url !== "string" ||
    !loopbackSidecarURL(parsed.url) ||
    typeof parsed.username !== "string" ||
    typeof parsed.password !== "string" ||
    typeof parsed.token !== "string" ||
    typeof parsed.createdAt !== "string"
  ) {
    throw new Error("Invalid TUI coordinator manifest")
  }
  return parsed as CoordinatorManifest
}

export async function isSidecarConnectionHealthy(manifest: Pick<CoordinatorManifest, "url" | "username" | "password">) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1_500)
  try {
    const response = await fetch(new URL("/global/health", manifest.url), {
      headers: coordinatorHeaders(manifest),
      signal: controller.signal,
    })
    if (!response.ok) return false
    const body = (await response.json()) as { healthy?: unknown }
    return body.healthy === true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function startCoordinatorClientLease(key: string) {
  const dir = coordinatorClientDir(key)
  const file = path.join(dir, `${process.pid}.gui.json`)
  let disposed = false
  const write = async () => {
    if (disposed) return
    await fs.promises.mkdir(dir, { recursive: true })
    if (disposed) return
    await fs.promises.writeFile(
      file,
      JSON.stringify({
        version: 1,
        key,
        pid: process.pid,
        updatedAt: Date.now(),
      }),
      { mode: 0o600 },
    )
  }
  const timer = setInterval(() => {
    void write().catch(() => {})
  }, CLIENT_HEARTBEAT_INTERVAL)
  timer.unref?.()
  const ready = write()

  return {
    ready,
    async dispose() {
      if (disposed) return
      disposed = true
      clearInterval(timer)
      await ready.catch(() => undefined)
      await fs.promises.rm(file, { force: true }).catch(() => undefined)
    },
  }
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
        detached: process.platform !== "win32",
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
  try {
    return await waitForCoordinator(directory, child, started, signal)
  } catch (error) {
    await stopOwnedCoordinator(owned)
    if (state.child === owned) state.child = undefined
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
    const manifest = await activeCoordinator(directory, coordinatorKey(directory, started.database), started.database)
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
  await fs.promises.rm(coordinatorManifestPath(owned.key), { force: true }).catch(() => undefined)
}

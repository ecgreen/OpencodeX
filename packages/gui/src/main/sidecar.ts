import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import {
  COORDINATOR_USERNAME,
  coordinatorClientDir,
  coordinatorHeaders,
  coordinatorKey,
  coordinatorManifestPath,
  coordinatorMatchesDatabase,
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

export type SidecarConnection = {
  url: string
  username: string
  password: string
  directory: string
}

type SidecarState = {
  child?: ChildProcess
  connection?: SidecarConnection
  startup?: Promise<SidecarConnection>
  lease?: { dispose: () => void }
}

const START_TIMEOUT = 15_000
const CLIENT_HEARTBEAT_INTERVAL = 2_000
const state: SidecarState = {}

export function startSidecar() {
  if (state.connection) return Promise.resolve(state.connection)
  if (state.startup) return state.startup

  state.startup = coordinatorConnection(workingDirectory())
    .then((connection) => {
      state.connection = connection
      return connection
    })
    .finally(() => {
      state.startup = undefined
    })

  return state.startup
}

export function stopSidecar() {
  state.lease?.dispose()
  state.lease = undefined
  state.child = undefined
  state.connection = undefined
  state.startup = undefined
}

async function coordinatorConnection(directory: string) {
  const key = coordinatorKey(directory)
  const database = sidecarDatabase(directory)
  const existing = await activeCoordinator(directory)
  if (existing && (await coordinatorMatchesDatabase(existing, database))) {
    state.lease?.dispose()
    state.lease = startCoordinatorClientLease(existing.key)
    return connectionFromManifest(existing)
  }
  if (existing) await fs.promises.rm(coordinatorManifestPath(key), { force: true }).catch(() => undefined)
  await spawnCoordinator(directory, key, database)
  const manifest = await activeCoordinator(directory)
  if (!manifest) throw new Error("OpencodeX coordinator did not publish a usable manifest")
  state.lease?.dispose()
  state.lease = startCoordinatorClientLease(manifest.key)
  return connectionFromManifest(manifest)
}

function connectionFromManifest(manifest: CoordinatorManifest) {
  return {
    url: manifest.url,
    username: manifest.username,
    password: manifest.password,
    directory: manifest.directory,
  }
}

async function activeCoordinator(directory: string) {
  const key = coordinatorKey(directory)
  const manifest = await readCoordinatorManifest(key).catch(() => undefined)
  if (!manifest) return undefined
  if (manifest.key !== key || normalizeDirectory(manifest.directory) !== normalizeDirectory(directory)) {
    await fs.promises.rm(coordinatorManifestPath(key), { force: true }).catch(() => undefined)
    return undefined
  }
  if (await isCoordinatorHealthy(manifest)) return manifest
  await fs.promises.rm(coordinatorManifestPath(key), { force: true }).catch(() => undefined)
  return undefined
}

async function readCoordinatorManifest(key: string) {
  const parsed = JSON.parse(await fs.promises.readFile(coordinatorManifestPath(key), "utf8")) as Partial<CoordinatorManifest>
  if (
    parsed.version !== 1 ||
    typeof parsed.key !== "string" ||
    typeof parsed.directory !== "string" ||
    typeof parsed.pid !== "number" ||
    typeof parsed.url !== "string" ||
    typeof parsed.username !== "string" ||
    typeof parsed.password !== "string" ||
    typeof parsed.token !== "string" ||
    typeof parsed.createdAt !== "string"
  ) {
    throw new Error("Invalid TUI coordinator manifest")
  }
  return parsed as CoordinatorManifest
}

async function isCoordinatorHealthy(manifest: CoordinatorManifest) {
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
  const write = () =>
    fs.promises
      .mkdir(dir, { recursive: true })
      .then(() =>
        fs.promises.writeFile(
          file,
          JSON.stringify({
            version: 1,
            key,
            pid: process.pid,
            updatedAt: Date.now(),
          }),
          { mode: 0o600 },
        ),
      )
      .catch(() => {})
  const timer = setInterval(() => {
    void write()
  }, CLIENT_HEARTBEAT_INTERVAL)
  timer.unref?.()
  void write()

  return {
    dispose() {
      clearInterval(timer)
      void fs.promises.rm(file, { force: true }).catch(() => {})
    },
  }
}

async function spawnCoordinator(directory: string, key: string, database: string | undefined) {
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
  state.child = child
  try {
    await waitForCoordinator(directory, child, started)
  } catch (error) {
    if (!child.killed) child.kill(process.platform === "win32" ? undefined : "SIGTERM")
    state.child = undefined
    throw error
  }
}

async function waitForCoordinator(directory: string, child: ChildProcess, started: SidecarLaunch) {
  const startedAt = Date.now()
  let failure: Error | undefined
  child.once("error", (error) => {
    failure = startError(error, started)
  })
  child.once("exit", (code, signal) => {
    failure = new Error(`OpencodeX coordinator exited before startup (${signal ?? code ?? "unknown"})${startupLogDetails(started)}`)
  })
  while (Date.now() - startedAt < START_TIMEOUT) {
    if (failure) throw failure
    if (await activeCoordinator(directory)) return
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Timed out waiting for OpencodeX coordinator to start${startupLogDetails(started)}`)
}

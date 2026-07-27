import { Database } from "@opencode-ai/core/database/database"
import { Global } from "@opencode-ai/core/global"
import { Flock } from "@opencode-ai/core/util/flock"
import { Hash } from "@opencode-ai/core/util/hash"
import { ensureRunID, OPENCODE_PROCESS_ROLE, OPENCODE_RUN_ID } from "@opencode-ai/core/util/opencode-process"
import { ServerAuth } from "@/server/auth"
import { errorMessage } from "@/util/error"
import { randomBytes } from "crypto"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import { discoverBackendDatabase } from "./database-discovery"

export type TuiCoordinatorManifest = {
  version: 2
  key: string
  directory: string
  database: string
  pid: number
  url: string
  username: string
  password: string
  token: string
  createdAt: string
}

export type TuiCoordinatorClientLease = {
  version: 1
  key: string
  pid: number
  updatedAt: number
}

const ROOT = path.join(Global.Path.state, "tui-coordinators")
const BACKEND_AUTHORITY = path.join(Global.Path.state, "backend-authority.json")
const USERNAME = "opencodex-local"
const START_TIMEOUT = 15_000
const CLIENT_HEARTBEAT_INTERVAL = 2_000
const CLIENT_STALE_MS = 10_000

export const COORDINATOR_STARTUP_LOCK_HELD = "OPENCODE_TUI_COORDINATOR_STARTUP_LOCK_HELD"

export function coordinatorDatabaseIdentity(database = Database.path()) {
  if (database === ":memory:") return database
  const resolved = path.resolve(database)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export function coordinatorKey(database = coordinatorDatabaseIdentity()) {
  return Hash.fast(coordinatorDatabaseIdentity(database))
}

export function coordinatorManifestPath(key: string) {
  return path.join(ROOT, `${key}.json`)
}

export function coordinatorClientDir(key: string) {
  return path.join(ROOT, `${key}.clients`)
}

export function coordinatorHeaders(manifest: TuiCoordinatorManifest) {
  return ServerAuth.headers({ username: manifest.username, password: manifest.password })
}

async function readManifestPath(file: string) {
  const raw = await fs.readFile(file, "utf8")
  const parsed = JSON.parse(raw) as Partial<TuiCoordinatorManifest>
  if (
    parsed.version !== 2 ||
    typeof parsed.key !== "string" ||
    typeof parsed.directory !== "string" ||
    typeof parsed.database !== "string" ||
    typeof parsed.pid !== "number" ||
    typeof parsed.url !== "string" ||
    !isLoopbackCoordinatorURL(parsed.url) ||
    typeof parsed.username !== "string" ||
    typeof parsed.password !== "string" ||
    typeof parsed.token !== "string" ||
    typeof parsed.createdAt !== "string"
  ) {
    throw new Error("Invalid TUI coordinator manifest")
  }
  return parsed as TuiCoordinatorManifest
}

function isLoopbackCoordinatorURL(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)
  } catch {
    return false
  }
}

export async function readCoordinatorManifest(key: string) {
  try {
    return await readManifestPath(coordinatorManifestPath(key))
  } catch {
    return undefined
  }
}

export async function writeCoordinatorManifest(manifest: TuiCoordinatorManifest) {
  await fs.mkdir(ROOT, { recursive: true })
  const file = coordinatorManifestPath(manifest.key)
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), { mode: 0o600 })
  await fs.rename(tmp, file)
}

export async function removeCoordinatorManifest(key: string, token: string) {
  const file = coordinatorManifestPath(key)
  if ((await readManifestToken(file)) !== token) return
  await fs.rm(file, { force: true })
}

async function readManifestToken(file: string) {
  return fs
    .readFile(file, "utf8")
    .then((raw) => JSON.parse(raw) as Partial<TuiCoordinatorManifest>)
    .then((manifest) => (typeof manifest.token === "string" ? manifest.token : undefined))
    .catch(() => undefined)
}

export function startCoordinatorClientLease(key: string) {
  const dir = coordinatorClientDir(key)
  const file = path.join(dir, `${process.pid}.json`)
  let disposed = false
  let writing = Promise.resolve()
  const write = () => {
    const next = writing.catch(() => {}).then(async () => {
      if (disposed) return
      await fs.mkdir(dir, { recursive: true })
      if (disposed) return
      const temporary = `${file}.${randomBytes(4).toString("hex")}.tmp`
      try {
        await fs.writeFile(
          temporary,
          JSON.stringify({
            version: 1,
            key,
            pid: process.pid,
            updatedAt: Date.now(),
          } satisfies TuiCoordinatorClientLease),
          { mode: 0o600 },
        )
        if (disposed) return
        await fs.rename(temporary, file)
        if (disposed) await fs.rm(file, { force: true })
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {})
      }
    })
    writing = next
    return next
  }
  const timer = setInterval(() => {
    void write().catch(() => {})
  }, CLIENT_HEARTBEAT_INTERVAL)
  timer.unref?.()
  const ready = write()

  return {
    ready,
    dispose() {
      if (disposed) return
      disposed = true
      clearInterval(timer)
      void fs.rm(file, { force: true }).catch(() => {})
    },
  }
}

export async function readActiveCoordinatorClientLeases(key: string) {
  const dir = coordinatorClientDir(key)
  const files = await fs.readdir(dir).catch(() => [])
  const leases = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (name) => {
        const file = path.join(dir, name)
        const lease = await readClientLease(file).catch(() => undefined)
        const recovered = lease ?? (await recoverReplacingClientLease(file, name, key))
        const active =
          recovered !== undefined &&
          recovered.key === key &&
          Date.now() - recovered.updatedAt <= CLIENT_STALE_MS &&
          isProcessAlive(recovered.pid)
        if (active) return recovered
        await fs.rm(file, { force: true }).catch(() => {})
        return undefined
      }),
  )
  return leases.filter((lease): lease is TuiCoordinatorClientLease => lease !== undefined)
}

async function recoverReplacingClientLease(file: string, name: string, key: string) {
  const pid = Number(name.split(".")[0])
  if (!Number.isInteger(pid) || pid <= 0 || !isProcessAlive(pid)) return undefined
  const stat = await fs.stat(file).catch(() => undefined)
  if (!stat || Date.now() - stat.mtimeMs > CLIENT_STALE_MS) return undefined
  return {
    version: 1,
    key,
    pid,
    updatedAt: stat.mtimeMs,
  } satisfies TuiCoordinatorClientLease
}

async function readClientLease(file: string) {
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<TuiCoordinatorClientLease>
  if (
    parsed.version !== 1 ||
    typeof parsed.key !== "string" ||
    typeof parsed.pid !== "number" ||
    typeof parsed.updatedAt !== "number"
  ) {
    throw new Error("Invalid TUI coordinator client lease")
  }
  return parsed as TuiCoordinatorClientLease
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM"
  }
}

async function fetchWithTimeout(url: URL, init: RequestInit, timeout: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function isCoordinatorHealthy(manifest: TuiCoordinatorManifest) {
  try {
    const response = await fetchWithTimeout(
      new URL("/global/health", manifest.url),
      {
        headers: coordinatorHeaders(manifest),
      },
      1_500,
    )
    if (!response.ok) return false
    const body = (await response.json()) as { healthy?: unknown }
    return body.healthy === true
  } catch {
    return false
  }
}

export async function readActiveCoordinator(key = coordinatorKey(), database = coordinatorDatabaseIdentity()) {
  const manifest = await readActiveManifest(key)
  if (!manifest) return undefined
  if (
    manifest.key !== key ||
    coordinatorDatabaseIdentity(manifest.database) !== coordinatorDatabaseIdentity(database)
  ) {
    await removeCoordinatorManifest(key, manifest.token)
    return undefined
  }
  if (await isCoordinatorHealthy(manifest)) return manifest
  if (isProcessAlive(manifest.pid)) {
    throw new Error(`TUI coordinator process ${manifest.pid} is alive but unhealthy; refusing to replace it`)
  }
  await removeCoordinatorManifest(key, manifest.token)
  return undefined
}

export async function readPreferredCoordinator() {
  const database = await preferredCoordinatorDatabase()
  return readActiveCoordinator(coordinatorKey(database), database)
}

async function readActiveManifest(key: string) {
  const file = coordinatorManifestPath(key)
  try {
    return await readManifestPath(file)
  } catch (error) {
    if (isMissingFile(error)) return undefined
    const token = await readManifestToken(file)
    if (!token) throw new Error("Invalid TUI coordinator manifest cannot be removed safely")
    await removeCoordinatorManifest(key, token)
    return undefined
  }
}

function isMissingFile(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  )
}

export function withCoordinatorStartupLock<T>(key: string, fn: () => Promise<T>) {
  return Flock.withLock(`tui-coordinator:${key}`, fn, { timeoutMs: START_TIMEOUT, staleMs: 30_000 })
}

export function coordinatorStartupLock(key: string) {
  return Flock.effect(`tui-coordinator:${key}`, { timeoutMs: START_TIMEOUT, staleMs: 30_000 })
}

export function acquireCoordinatorOwnerLock(key: string) {
  return Flock.acquire(`tui-coordinator-owner:${key}`, { timeoutMs: START_TIMEOUT, staleMs: 30_000 })
}

function cliCommand() {
  if (process.argv[1]?.endsWith(".ts")) return [process.execPath, "--conditions=browser", process.argv[1]]
  return [process.execPath]
}

function createSecret() {
  return randomBytes(32).toString("base64url")
}

function spawnCoordinator(directory: string, key: string, database: string) {
  const password = createSecret()
  const token = createSecret()
  const command = cliCommand()
  const child = spawn(command[0], [...command.slice(1), "internal-tui-coordinator", directory, "--key", key], {
    cwd: directory,
    detached: process.platform !== "win32",
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      [OPENCODE_PROCESS_ROLE]: "coordinator",
      [OPENCODE_RUN_ID]: ensureRunID(),
      [COORDINATOR_STARTUP_LOCK_HELD]: "1",
      OPENCODE_TUI_COORDINATOR_USERNAME: USERNAME,
      OPENCODE_TUI_COORDINATOR_PASSWORD: password,
      OPENCODE_TUI_COORDINATOR_TOKEN: token,
      OPENCODE_SERVER_USERNAME: USERNAME,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DB: database,
    },
  })
  child.unref()
}

async function waitForCoordinator(key: string, database: string) {
  const started = Date.now()
  let lastError = "coordinator did not publish a manifest"
  while (Date.now() - started < START_TIMEOUT) {
    const manifest = await readActiveCoordinator(key, database).catch((error) => {
      lastError = errorMessage(error)
      return undefined
    })
    if (manifest) return manifest
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Timed out waiting for TUI coordinator: ${lastError}`)
}

export async function resolveLocalCoordinator(directory: string) {
  const database = await preferredCoordinatorDatabase()
  const key = coordinatorKey(database)
  return await withCoordinatorStartupLock(key, async () => {
    const existing = await readActiveCoordinator(key, database)
    if (existing) return existing
    spawnCoordinator(directory, key, database)
    return await waitForCoordinator(key, database)
  })
}

export async function readBackendAuthority(file = BACKEND_AUTHORITY) {
  return fs
    .readFile(file, "utf8")
    .then((raw) => JSON.parse(raw) as Partial<{ version: number; database: string; updatedAt: number }>)
    .then(async (selection) => {
      if (
        selection.version !== 1 ||
        typeof selection.database !== "string" ||
        typeof selection.updatedAt !== "number" ||
        selection.database === ":memory:"
      )
        return undefined
      const database = coordinatorDatabaseIdentity(selection.database)
      return (await fs.stat(database)).isFile() ? database : undefined
    })
    .catch(() => undefined)
}

async function preferredCoordinatorDatabase() {
  const fallback = coordinatorDatabaseIdentity()
  if (process.env.OPENCODE_DB) return fallback
  const persisted = await readBackendAuthority()
  const active = await discoverActiveGuiCoordinatorDatabase()
  const discovered =
    active || persisted ? undefined : coordinatorDatabaseIdentity((await discoverBackendDatabase()) ?? fallback)
  const database = selectBackendAuthority(
    active,
    persisted,
    discovered,
    fallback,
  )
  if (database !== fallback && database !== persisted) await rememberBackendAuthority(database).catch(() => undefined)
  return database
}

export function selectBackendAuthority(
  active: string | undefined,
  persisted: string | undefined,
  discovered: string | undefined,
  fallback: string,
) {
  return active ?? persisted ?? discovered ?? fallback
}

export async function discoverActiveGuiCoordinatorDatabase(root = ROOT) {
  const manifests = await Promise.all(
    (await fs.readdir(root).catch(() => []))
      .filter((file) => file.endsWith(".json"))
      .map((file) => readManifestPath(path.join(root, file)).catch(() => undefined)),
  )
  const databases = await Promise.all(
    manifests.flatMap((manifest) =>
      manifest
        ? [
            hasActiveGuiClient(manifest.key, root).then(async (active) => {
              if (!active || !(await isCoordinatorHealthy(manifest))) return undefined
              return coordinatorDatabaseIdentity(manifest.database)
            }),
          ]
        : [],
    ),
  )
  const active = [...new Set(databases.filter((database): database is string => database !== undefined))]
  return active.length === 1 ? active[0] : undefined
}

async function hasActiveGuiClient(key: string, root: string) {
  const dir = path.join(root, `${key}.clients`)
  const clients = await Promise.all(
    (await fs.readdir(dir).catch(() => []))
      .filter((file) => file.endsWith(".gui.json"))
      .map(async (name) => {
        const file = path.join(dir, name)
        const lease = await readClientLease(file).catch(() => undefined)
        const active =
          lease !== undefined &&
          lease.key === key &&
          Date.now() - lease.updatedAt <= CLIENT_STALE_MS &&
          isProcessAlive(lease.pid)
        if (!active) await fs.rm(file, { force: true }).catch(() => {})
        return active
      }),
  )
  return clients.some(Boolean)
}

async function rememberBackendAuthority(database: string, file = BACKEND_AUTHORITY) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(
    tmp,
    JSON.stringify({ version: 1, database, updatedAt: Date.now() }, null, 2),
    { mode: 0o600 },
  )
  await fs.rename(tmp, file)
}

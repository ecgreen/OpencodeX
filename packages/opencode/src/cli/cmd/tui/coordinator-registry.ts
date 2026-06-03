import { Global } from "@opencode-ai/core/global"
import { Flock } from "@opencode-ai/core/util/flock"
import { Hash } from "@opencode-ai/core/util/hash"
import { ensureRunID, OPENCODE_PROCESS_ROLE, OPENCODE_RUN_ID } from "@opencode-ai/core/util/opencode-process"
import { ServerAuth } from "@/server/auth"
import { Filesystem } from "@/util/filesystem"
import { errorMessage } from "@/util/error"
import { randomBytes } from "crypto"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"

export type TuiCoordinatorManifest = {
  version: 1
  key: string
  directory: string
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
const USERNAME = "opencodex-local"
const START_TIMEOUT = 15_000
const CLIENT_HEARTBEAT_INTERVAL = 2_000
const CLIENT_STALE_MS = 10_000

function normalizeDirectory(directory: string) {
  const resolved = Filesystem.resolve(directory)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export function coordinatorKey(directory: string) {
  return Hash.fast(normalizeDirectory(directory))
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
  return parsed as TuiCoordinatorManifest
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

export async function removeCoordinatorManifest(key: string, token?: string) {
  const file = coordinatorManifestPath(key)
  if (token) {
    const current = await readManifestPath(file).catch(() => undefined)
    if (current?.token !== token) return
  }
  await fs.rm(file, { force: true })
}

export function startCoordinatorClientLease(key: string) {
  const dir = coordinatorClientDir(key)
  const file = path.join(dir, `${process.pid}.json`)
  const write = () =>
    fs
      .mkdir(dir, { recursive: true })
      .then(() =>
        fs.writeFile(
          file,
          JSON.stringify({
            version: 1,
            key,
            pid: process.pid,
            updatedAt: Date.now(),
          } satisfies TuiCoordinatorClientLease),
          { mode: 0o600 },
        ),
      )
      .catch(() => {})
  const timer = setInterval(() => {
    void write()
  }, CLIENT_HEARTBEAT_INTERVAL)
  timer.unref?.()
  void write()

  let disposed = false
  return {
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
        const active =
          lease !== undefined &&
          lease.key === key &&
          Date.now() - lease.updatedAt <= CLIENT_STALE_MS &&
          isProcessAlive(lease.pid)
        if (active) return lease
        await fs.rm(file, { force: true }).catch(() => {})
        return undefined
      }),
  )
  return leases.filter((lease): lease is TuiCoordinatorClientLease => lease !== undefined)
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

async function activeManifest(directory: string) {
  const key = coordinatorKey(directory)
  const manifest = await readCoordinatorManifest(key)
  if (!manifest) return undefined
  if (manifest.key !== key || normalizeDirectory(manifest.directory) !== normalizeDirectory(directory)) {
    await removeCoordinatorManifest(key).catch(() => undefined)
    return undefined
  }
  if (await isCoordinatorHealthy(manifest)) return manifest
  await removeCoordinatorManifest(key).catch(() => undefined)
  return undefined
}

function cliCommand() {
  if (process.argv[1]?.endsWith(".ts")) return [process.execPath, "--conditions=browser", process.argv[1]]
  return [process.execPath]
}

function createSecret() {
  return randomBytes(32).toString("base64url")
}

function spawnCoordinator(directory: string, key: string) {
  const password = createSecret()
  const token = createSecret()
  const command = cliCommand()
  const child = spawn(command[0], [...command.slice(1), "internal-tui-coordinator", directory, "--key", key], {
    cwd: directory,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      [OPENCODE_PROCESS_ROLE]: "coordinator",
      [OPENCODE_RUN_ID]: ensureRunID(),
      OPENCODE_TUI_COORDINATOR_USERNAME: USERNAME,
      OPENCODE_TUI_COORDINATOR_PASSWORD: password,
      OPENCODE_TUI_COORDINATOR_TOKEN: token,
      OPENCODE_SERVER_USERNAME: USERNAME,
      OPENCODE_SERVER_PASSWORD: password,
    },
  })
  child.unref()
}

async function waitForCoordinator(directory: string) {
  const started = Date.now()
  let lastError = "coordinator did not publish a manifest"
  while (Date.now() - started < START_TIMEOUT) {
    const manifest = await activeManifest(directory).catch((error) => {
      lastError = errorMessage(error)
      return undefined
    })
    if (manifest) return manifest
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Timed out waiting for TUI coordinator: ${lastError}`)
}

export async function resolveLocalCoordinator(directory: string) {
  const key = coordinatorKey(directory)
  return await Flock.withLock(
    `tui-coordinator:${key}`,
    async () => {
      const existing = await activeManifest(directory)
      if (existing) return existing
      spawnCoordinator(directory, key)
      return await waitForCoordinator(directory)
    },
    { timeoutMs: START_TIMEOUT, staleMs: 30_000 },
  )
}

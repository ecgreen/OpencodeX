/**
 * The single implementation of the coordinator attach protocol.
 *
 * One backend coordinator owns each SQLite database. Whichever client starts
 * first publishes a manifest; every other client reads it and attaches. Both
 * the TUI (`cli/cmd/tui/coordinator-registry.ts`) and the Electron main process
 * (`src/main/sidecar.ts`) used to carry their own copy of the manifest schema,
 * the lease files, and the health probe, which is exactly the kind of pair that
 * drifts. This module owns all three so the two agree by construction.
 *
 * Only node builtins are imported: Electron main bundles this file with esbuild
 * and rejects any non-builtin external, and the TUI imports it from Bun.
 */
import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * Schema number of the manifest file. This intentionally did NOT move when
 * `serverVersion` was added: both readers hard-delete a manifest that fails
 * validation, so an older binary meeting a newer schema number would delete the
 * manifest of a live, healthy coordinator and start a second writer on the same
 * database. Additive optional fields pass every field-typed validator, so new
 * information must arrive that way instead of through a version bump.
 */
export const COORDINATOR_MANIFEST_VERSION = 2
export const COORDINATOR_CLIENT_LEASE_VERSION = 1
/** Directory under the state root that holds manifests, leases, and startup logs. */
export const COORDINATOR_DIRECTORY = "tui-coordinators"
/** Version string used by builds that were not stamped by the release pipeline. */
export const COORDINATOR_LOCAL_VERSION = "local"
export const COORDINATOR_SKIP_VERSION_CHECK_ENV = "OPENCODEX_SKIP_VERSION_CHECK"

const CLIENT_HEARTBEAT_INTERVAL = 2_000
const HEALTH_TIMEOUT = 1_500
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

export type CoordinatorManifest = {
  version: typeof COORDINATOR_MANIFEST_VERSION
  key: string
  directory: string
  database: string
  pid: number
  url: string
  username: string
  password: string
  token: string
  createdAt: string
  /**
   * Server version of the process that published the manifest. Optional on the
   * wire: a coordinator started by a binary older than the handshake has none,
   * and that absence is what identifies it as legacy.
   */
  serverVersion?: string
}

export type CoordinatorClientLease = {
  version: typeof COORDINATOR_CLIENT_LEASE_VERSION
  key: string
  pid: number
  updatedAt: number
}

export type CoordinatorCredentials = Pick<CoordinatorManifest, "username" | "password">

export type CoordinatorHealth = {
  healthy: boolean
  version?: string
  active?: boolean
}

export type CoordinatorCompatibilityReason =
  | "match"
  | "skipped"
  | "local"
  | "legacy"
  | "mismatch"
  | "health_mismatch"

export type CoordinatorCompatibility = {
  compatible: boolean
  reason: CoordinatorCompatibilityReason
  /** Human-readable detail: a warning when compatible, the refusal when not. */
  message?: string
}

export function coordinatorRoot(stateRoot: string) {
  return path.join(stateRoot, COORDINATOR_DIRECTORY)
}

export function coordinatorManifestPath(stateRoot: string, key: string) {
  return path.join(coordinatorRoot(stateRoot), `${key}.json`)
}

export function coordinatorClientDir(stateRoot: string, key: string) {
  return path.join(coordinatorRoot(stateRoot), `${key}.clients`)
}

export function coordinatorStartupLogPath(stateRoot: string, key: string) {
  return path.join(coordinatorRoot(stateRoot), `${key}.startup.log`)
}

/**
 * Canonical spelling of a database path, used as the hash input for the
 * coordinator key. `base` resolves relative paths; callers that mean "relative
 * to the process cwd" leave it unset, and the GUI passes its data root because
 * a bare filename there names a database in that directory.
 */
export function coordinatorDatabaseIdentity(database: string, base?: string) {
  if (database === ":memory:") return database
  const resolved = base && !path.isAbsolute(database) ? path.resolve(base, database) : path.resolve(database)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export function coordinatorKey(database: string, base?: string) {
  return createHash("sha1").update(coordinatorDatabaseIdentity(database, base)).digest("hex")
}

export function coordinatorHeaders(credentials: CoordinatorCredentials) {
  const encoded = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")
  return { authorization: `Basic ${encoded}` }
}

export function isLoopbackCoordinatorURL(value: string) {
  return coordinatorURL(value) !== undefined
}

export function coordinatorURL(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return url
  } catch {
    // Fall through: an unparseable URL is not a loopback URL.
  }
  return undefined
}

/**
 * Field-typed validation. Unknown extra fields pass on purpose so a newer
 * coordinator can add information without an older reader treating the manifest
 * as corrupt (see `COORDINATOR_MANIFEST_VERSION`).
 */
export function isCoordinatorManifest(value: unknown): value is CoordinatorManifest {
  if (typeof value !== "object" || value === null) return false
  const manifest = value as Partial<CoordinatorManifest>
  return (
    manifest.version === COORDINATOR_MANIFEST_VERSION &&
    typeof manifest.key === "string" &&
    typeof manifest.directory === "string" &&
    typeof manifest.database === "string" &&
    typeof manifest.pid === "number" &&
    typeof manifest.url === "string" &&
    isLoopbackCoordinatorURL(manifest.url) &&
    typeof manifest.username === "string" &&
    typeof manifest.password === "string" &&
    typeof manifest.token === "string" &&
    typeof manifest.createdAt === "string" &&
    (manifest.serverVersion === undefined || typeof manifest.serverVersion === "string")
  )
}

export function parseCoordinatorManifest(raw: string): CoordinatorManifest {
  const parsed = JSON.parse(raw) as unknown
  if (!isCoordinatorManifest(parsed)) throw new Error("Invalid coordinator manifest")
  return parsed
}

export function isCoordinatorClientLease(value: unknown): value is CoordinatorClientLease {
  if (typeof value !== "object" || value === null) return false
  const lease = value as Partial<CoordinatorClientLease>
  return (
    lease.version === COORDINATOR_CLIENT_LEASE_VERSION &&
    typeof lease.key === "string" &&
    typeof lease.pid === "number" &&
    typeof lease.updatedAt === "number"
  )
}

/** Reads and validates a manifest file, propagating filesystem errors. */
export async function readCoordinatorManifestFile(file: string) {
  return parseCoordinatorManifest(await fs.readFile(file, "utf8"))
}

export async function readCoordinatorManifest(stateRoot: string, key: string) {
  return readCoordinatorManifestFile(coordinatorManifestPath(stateRoot, key))
}

/**
 * Reads only the token, without validating the rest. Removal is token-guarded,
 * so a manifest that fails validation still has to prove ownership before it
 * can be deleted.
 */
export async function readCoordinatorManifestToken(file: string) {
  return fs
    .readFile(file, "utf8")
    .then((raw): unknown => JSON.parse(raw))
    .then((manifest) => {
      if (typeof manifest !== "object" || manifest === null || !("token" in manifest)) return undefined
      return typeof manifest.token === "string" ? manifest.token : undefined
    })
    .catch(() => undefined)
}

export async function writeCoordinatorManifest(stateRoot: string, manifest: CoordinatorManifest) {
  const root = coordinatorRoot(stateRoot)
  await fs.mkdir(root, { recursive: true })
  const file = coordinatorManifestPath(stateRoot, manifest.key)
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(manifest, null, 2), { mode: 0o600 })
  await fs.rename(temporary, file)
}

/** Deletes the manifest only when `token` matches the one on disk. */
export async function removeCoordinatorManifest(stateRoot: string, key: string, token: string) {
  const file = coordinatorManifestPath(stateRoot, key)
  if ((await readCoordinatorManifestToken(file)) !== token) return false
  await fs.rm(file, { force: true })
  return true
}

export function isCoordinatorProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM"
  }
}

export function isMissingCoordinatorFile(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  )
}

/**
 * Probes `/global/health`. Returns `undefined` when the coordinator is
 * unreachable or answers with something unusable, which is the only signal a
 * caller needs to treat the manifest as dead. The parsed body carries the
 * server version, so this is also the handshake's second source of truth.
 */
export async function fetchCoordinatorHealth(
  manifest: Pick<CoordinatorManifest, "url"> & CoordinatorCredentials,
  options?: { timeout?: number; fetch?: typeof globalThis.fetch },
): Promise<CoordinatorHealth | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options?.timeout ?? HEALTH_TIMEOUT)
  try {
    const request = options?.fetch ?? globalThis.fetch
    const response = await request(new URL("/global/health", manifest.url), {
      headers: coordinatorHeaders(manifest),
      signal: controller.signal,
    })
    if (!response.ok) return undefined
    const body: unknown = await response.json()
    if (typeof body !== "object" || body === null) return undefined
    return {
      healthy: "healthy" in body && body.healthy === true,
      version: "version" in body && typeof body.version === "string" ? body.version : undefined,
      active: "active" in body && typeof body.active === "boolean" ? body.active : undefined,
    }
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

export async function isCoordinatorHealthy(
  manifest: Pick<CoordinatorManifest, "url"> & CoordinatorCredentials,
  options?: { timeout?: number; fetch?: typeof globalThis.fetch },
) {
  return (await fetchCoordinatorHealth(manifest, options))?.healthy === true
}

/**
 * Decides whether a client of `clientVersion` may attach to the coordinator the
 * manifest describes.
 *
 * Exact match is the rule; the escapes are deliberate and narrow:
 * - either side reporting `"local"` is a dev build, allowed with a warning;
 * - a manifest with no `serverVersion` predates the handshake and is refused,
 *   because nothing about its wire contract can be verified;
 * - `OPENCODEX_SKIP_VERSION_CHECK=1` bypasses everything.
 *
 * On refusal the caller must NOT delete the manifest or kill the coordinator.
 * The other client may be perfectly happy with it, and destroying it would
 * break the single-writer guarantee this whole protocol exists to hold.
 */
export function checkCoordinatorCompatibility(input: {
  manifest: Pick<CoordinatorManifest, "serverVersion">
  clientVersion: string
  /** Version reported by a live `/global/health`, when one was probed. */
  healthVersion?: string
  /** Defaults to the `OPENCODEX_SKIP_VERSION_CHECK` environment variable. */
  skip?: boolean
}): CoordinatorCompatibility {
  const skip = input.skip ?? coordinatorVersionCheckSkipped()
  if (skip) return { compatible: true, reason: "skipped" }

  const serverVersion = input.manifest.serverVersion
  if (serverVersion === undefined) {
    return {
      compatible: false,
      reason: "legacy",
      message:
        "The running coordinator predates the version handshake and does not publish its server version. Restart it so this client can verify the two agree.",
    }
  }

  if (
    serverVersion === COORDINATOR_LOCAL_VERSION ||
    input.clientVersion === COORDINATOR_LOCAL_VERSION ||
    input.healthVersion === COORDINATOR_LOCAL_VERSION
  ) {
    return {
      compatible: true,
      reason: "local",
      message: `Attaching across a local development build (coordinator ${serverVersion}, client ${input.clientVersion}); server and SDK skew is not validated.`,
    }
  }

  if (input.healthVersion !== undefined && input.healthVersion !== serverVersion) {
    return {
      compatible: false,
      reason: "health_mismatch",
      message: `The coordinator manifest claims version ${serverVersion} but the running process reports ${input.healthVersion}. The manifest is stale; restart the coordinator.`,
    }
  }

  if (serverVersion !== input.clientVersion) {
    return {
      compatible: false,
      reason: "mismatch",
      message: `The running coordinator is version ${serverVersion} but this client is ${input.clientVersion}. Close the other OpencodeX client so a matching coordinator can start, or set ${COORDINATOR_SKIP_VERSION_CHECK_ENV}=1 to attach anyway.`,
    }
  }

  return { compatible: true, reason: "match" }
}

export function coordinatorVersionCheckSkipped(env: NodeJS.ProcessEnv = process.env) {
  const value = env[COORDINATOR_SKIP_VERSION_CHECK_ENV]
  return value === "1" || value === "true"
}

export type CoordinatorClientLeaseHandle = {
  /** Resolves once the first lease file has been written. */
  ready: Promise<void>
  file: string
  dispose: () => Promise<void>
}

/**
 * Publishes a heartbeat file that tells the coordinator this client is still
 * attached. The coordinator shuts itself down once no lease remains, so the
 * file has to disappear on dispose even if a write is still in flight.
 *
 * `suffix` distinguishes client kinds inside the same directory (the GUI writes
 * `<pid>.gui.json` so the TUI can detect an active GUI without opening files).
 */
export function startCoordinatorClientLease(input: {
  stateRoot: string
  key: string
  suffix?: string
  pid?: number
  interval?: number
}): CoordinatorClientLeaseHandle {
  const pid = input.pid ?? process.pid
  const dir = coordinatorClientDir(input.stateRoot, input.key)
  const file = path.join(dir, `${pid}${input.suffix ?? ""}.json`)
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
            version: COORDINATOR_CLIENT_LEASE_VERSION,
            key: input.key,
            pid,
            updatedAt: Date.now(),
          } satisfies CoordinatorClientLease),
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
  }, input.interval ?? CLIENT_HEARTBEAT_INTERVAL)
  timer.unref?.()
  const ready = write()

  return {
    ready,
    file,
    async dispose() {
      if (disposed) return
      disposed = true
      clearInterval(timer)
      await Promise.all([ready.catch(() => undefined), writing.catch(() => undefined)])
      await fs.rm(file, { force: true }).catch(() => undefined)
    },
  }
}

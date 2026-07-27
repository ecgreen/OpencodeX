import { describe, expect } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { realpathSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { Database } from "bun:sqlite"
import { awaitWithTimeout, it, pollWithTimeout } from "../lib/effect"

const root = path.resolve(import.meta.dir, "../..")
const directEntry = path.join(root, "src", "gui-coordinator.ts")
const cliEntry = path.join(root, "src", "index.ts")
const runnerEntry = path.join(root, "test", "fixture", "gui-coordinator-runner.ts")
const directBinary = process.env.OPENCODE_GUI_COORDINATOR_TEST_BINARY

type Manifest = {
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

type Fixture = {
  home: string
  directory: string
  database: string
  key: string
  manifest: string
  clients: string
  ownerLock: string
}

describe("GUI coordinator direct entry", () => {
  it.live(
    "publishes authenticated loopback health and removes its manifest on runner abort",
    () =>
      withFixture((fixture) =>
        Effect.gen(function* () {
          const child = yield* spawnCoordinator(fixture, "runner", "signal")
          const manifest = yield* waitForManifest(fixture, child)
          const url = new URL(manifest.url)
          expect(url.protocol).toBe("http:")
          expect(url.hostname).toBe("127.0.0.1")

          expect((yield* Effect.promise(() => fetch(new URL("/global/health", manifest.url)))).status).toBe(401)
          const response = yield* Effect.promise(() =>
            fetch(new URL("/global/health", manifest.url), { headers: coordinatorHeaders(manifest) }),
          )
          expect(response.status).toBe(200)
          expect(yield* Effect.promise(() => response.json())).toMatchObject({ healthy: true })

          yield* writeLease(fixture)
          yield* Effect.sync(child.stop)
          yield* awaitWithTimeout(Effect.promise(() => child.process.exited), "coordinator did not exit on abort", "10 seconds")
          yield* waitForManifestRemoval(fixture)
        }),
      ),
    60_000,
  )

  it.live(
    "stays alive when a client attaches just before idle shutdown",
    () =>
      withFixture((fixture) =>
        Effect.gen(function* () {
          const child = yield* spawnCoordinator(fixture, "direct", "lease")
          yield* waitForManifest(fixture, child)
          const lease = yield* writeLease(fixture)

          yield* Effect.sleep("2500 millis")
          expect(child.process.exitCode).toBeNull()
          yield* Effect.promise(() => fs.rm(lease, { force: true }))

          yield* Effect.sleep("4500 millis")
          const lateLease = yield* writeLease(fixture)
          yield* Effect.sleep("2500 millis")
          expect(child.process.exitCode).toBeNull()
          yield* Effect.promise(() => fs.rm(lateLease, { force: true }))

          expect(
            yield* awaitWithTimeout(
              Effect.promise(() => child.process.exited),
              "coordinator did not stop after its last lease disappeared",
              "12 seconds",
            ),
          ).toBe(0)
          yield* waitForManifestRemoval(fixture)
        }),
      ),
    60_000,
  )

  it.live(
    "stays alive without clients while durable backend activity exists",
    () =>
      withFixture((fixture) =>
        Effect.gen(function* () {
          const durable = databaseFixture(fixture, path.join(fixture.home, "activity.db"))
          const child = yield* spawnCoordinator(durable, "direct", "durable-activity")
          const manifest = yield* waitForManifest(durable, child)
          const health = yield* Effect.promise(() =>
            fetch(new URL("/global/health", manifest.url), { headers: coordinatorHeaders(manifest) }),
          )
          expect(health.status).toBe(200)
          const lease = yield* writeLease(durable)
          return yield* Effect.acquireUseRelease(
            Effect.sync(() => new Database(durable.database)),
            (database) =>
              Effect.gen(function* () {
                const now = Date.now()
                yield* Effect.sync(() =>
                  database.run(
                    `INSERT INTO session_interaction
                      (id, kind, session_id, project_id, directory, state, request_json, time_created, time_updated)
                     VALUES (?, 'question', 'ses_activity', 'project', ?, 'pending', '{}', ?, ?)`,
                    ["que_activity", durable.directory, now, now],
                  ),
                )
                yield* Effect.sleep("2500 millis")
                yield* Effect.promise(() => fs.rm(lease, { force: true }))

                yield* Effect.sleep("9 seconds")
                expect(child.process.exitCode).toBeNull()

                yield* Effect.sync(() =>
                  database.run(
                    "UPDATE session_interaction SET state = 'replied', responded_at = ?, time_updated = ? WHERE id = 'que_activity'",
                    [Date.now(), Date.now()],
                  ),
                )
                expect(
                  yield* awaitWithTimeout(
                    Effect.promise(() => child.process.exited),
                    "coordinator did not stop after durable activity settled",
                    "15 seconds",
                  ),
                ).toBe(0)
              }),
            (database) => Effect.sync(() => database.close()),
          )
        }),
      ),
    60_000,
  )

  it.live(
    "converges GUI and TUI launches from two directories on one database",
    () =>
      withFixture((fixture) =>
        Effect.gen(function* () {
          const tuiDirectory = path.join(fixture.home, "other-workspace")
          yield* Effect.promise(() => fs.mkdir(tuiDirectory, { recursive: true }))
          const tuiFixture = databaseFixture({ home: fixture.home, directory: tuiDirectory }, fixture.database)
          expect(tuiFixture.key).toBe(fixture.key)
          expect(tuiFixture.manifest).toBe(fixture.manifest)

          const direct = yield* spawnCoordinator(fixture, "direct", "gui")
          const hidden = yield* spawnCoordinator(tuiFixture, "hidden", "tui")
          const manifest = yield* waitForManifest(fixture, direct, hidden)
          yield* writeLease(fixture)

          const winner = direct.process.pid === manifest.pid ? direct : hidden
          const loser = direct.process.pid === manifest.pid ? hidden : direct
          expect(
            yield* awaitWithTimeout(
              Effect.promise(() => loser.process.exited),
              "competing coordinator did not converge",
              "30 seconds",
            ),
          ).toBe(0)
          expect(winner.process.exitCode).toBeNull()
          expect((yield* readManifest(fixture))?.pid).toBe(manifest.pid)
          expect((yield* Effect.promise(() => fs.stat(fixture.ownerLock))).isDirectory()).toBe(true)
          expect([realDirectory(fixture.directory), realDirectory(tuiDirectory)]).toContain(
            realDirectory(manifest.directory),
          )

          const response = yield* Effect.promise(() =>
            fetch(new URL("/global/health", manifest.url), { headers: coordinatorHeaders(manifest) }),
          )
          expect(response.status).toBe(200)

          yield* Effect.sync(() => winner.process.kill())
          yield* awaitWithTimeout(Effect.promise(() => winner.process.exited), "winning coordinator did not exit", "10 seconds")
          yield* Effect.promise(() => fs.rm(fixture.manifest, { force: true }))
        }),
      ),
    90_000,
  )

  it.live(
    "does not replace an unhealthy manifest while its owner PID is alive",
    () =>
      withFixture((fixture) =>
        Effect.gen(function* () {
          const token = randomBytes(24).toString("base64url")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(fixture.manifest), { recursive: true })
            await fs.writeFile(
              fixture.manifest,
              JSON.stringify({
                version: 2,
                key: fixture.key,
                directory: fixture.directory,
                database: normalizeDatabase(fixture.database),
                pid: process.pid,
                url: "http://127.0.0.1:1/",
                username: "existing-owner",
                password: "existing-password",
                token,
                createdAt: new Date().toISOString(),
              } satisfies Manifest),
            )
          })

          const child = yield* spawnCoordinator(fixture, "direct", "contender")
          expect(
            yield* awaitWithTimeout(
              Effect.promise(() => child.process.exited),
              "competing coordinator did not reject the live owner",
              "10 seconds",
            ),
          ).toBe(1)
          expect(yield* Effect.promise(() => child.stderr)).toContain("is alive but unhealthy; refusing to replace it")
          expect(yield* readManifest(fixture)).toMatchObject({ pid: process.pid, token })
          yield* Effect.promise(() => fs.rm(fixture.manifest, { force: true }))
        }),
      ),
    60_000,
  )

  it.live(
    "uses independent coordinator namespaces for two databases",
    () =>
      withFixture((fixture) =>
        Effect.gen(function* () {
          const firstFixture = databaseFixture(fixture, path.join(fixture.home, "first.db"))
          const secondFixture = databaseFixture(fixture, path.join(fixture.home, "second.db"))
          const first = yield* spawnCoordinator(firstFixture, "direct", "first-database")
          const second = yield* spawnCoordinator(secondFixture, "direct", "second-database")
          const firstManifest = yield* waitForManifest(firstFixture, first)
          const secondManifest = yield* waitForManifest(secondFixture, second)
          yield* writeLease(firstFixture)
          yield* writeLease(secondFixture)

          expect(firstManifest.key).not.toBe(secondManifest.key)
          expect(firstManifest.database).toBe(normalizeDatabase(firstFixture.database))
          expect(secondManifest.database).toBe(normalizeDatabase(secondFixture.database))
          expect(first.process.exitCode).toBeNull()
          expect(second.process.exitCode).toBeNull()

          yield* Effect.sync(() => first.process.kill())
          yield* Effect.sync(() => second.process.kill())
          yield* Effect.all([
            awaitWithTimeout(Effect.promise(() => first.process.exited), "first coordinator did not exit", "10 seconds"),
            awaitWithTimeout(Effect.promise(() => second.process.exited), "second coordinator did not exit", "10 seconds"),
          ])
          yield* Effect.promise(() => fs.rm(firstFixture.manifest, { force: true }))
          yield* Effect.promise(() => fs.rm(secondFixture.manifest, { force: true }))
        }),
      ),
    90_000,
  )

  it.live(
    "does not bundle unrelated CLI or TUI modules",
    () =>
      withFixture((fixture) =>
        Effect.gen(function* () {
          const out = path.join(fixture.home, "bundle")
          const metafile = path.join(fixture.home, "coordinator-meta.json")
          const result = yield* Effect.sync(() =>
            Bun.spawn(
              [
                "bun",
                "build",
                directEntry,
                "--target=bun",
                `--outdir=${out}`,
                `--metafile=${metafile}`,
                "--conditions=browser",
                "--external=node-gyp",
              ],
              { cwd: root, stdout: "pipe", stderr: "pipe" },
            ),
          )
          const [exit, stderr] = yield* Effect.all([
            Effect.promise(() => result.exited),
            Effect.promise(() => new Response(result.stderr).text()),
          ])
          expect(exit, stderr).toBe(0)

          const metadata = JSON.parse(yield* Effect.promise(() => fs.readFile(metafile, "utf8"))) as {
            inputs: Record<string, unknown>
          }
          const inputs = Object.keys(metadata.inputs).map((file) => file.replaceAll("\\", "/"))
          expect(inputs.some((file) => file.includes("/yargs/"))).toBe(false)
          expect(inputs.some((file) => file.endsWith("packages/opencode/src/index.ts") || file === "src/index.ts")).toBe(false)
          expect(inputs.some((file) => file.includes("/src/cli/cmd/run"))).toBe(false)
          expect(inputs.some((file) => file.includes("/src/cli/cmd/tui/app"))).toBe(false)
          expect(inputs.some((file) => file.includes("parser.worker"))).toBe(false)
          expect(inputs.some((file) => file.includes("@opentui/solid"))).toBe(false)
        }),
      ),
    60_000,
  )
})

function withFixture<A, E, R>(use: (fixture: Fixture) => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.promise(async () => {
      const home = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-gui-coordinator-"))
      const directory = path.join(home, "workspace")
      await fs.mkdir(directory, { recursive: true })
      return databaseFixture(
        {
          home,
          directory,
        },
        ":memory:",
      )
    }),
    use,
    (fixture) => Effect.tryPromise(() => removeFixture(fixture.home)).pipe(Effect.ignore),
  )
}

function spawnCoordinator(fixture: Fixture, entry: "direct" | "hidden" | "runner", id: string) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const username = `coordinator-${id}`
      const password = randomBytes(24).toString("base64url")
      const args =
        entry === "direct"
          ? [directEntry, fixture.directory, "--key", fixture.key]
          : entry === "hidden"
            ? [cliEntry, "internal-tui-coordinator", fixture.directory, "--key", fixture.key]
            : [runnerEntry, fixture.directory, fixture.key]
      const command = entry === "direct" && directBinary ? [directBinary, ...args.slice(1)] : ["bun", "run", "--conditions=browser", ...args]
      const process = Bun.spawn(command, {
        cwd: root,
        env: {
          ...globalThis.process.env,
          HOME: fixture.home,
          XDG_CONFIG_HOME: path.join(fixture.home, "config"),
          XDG_DATA_HOME: path.join(fixture.home, "data"),
          XDG_STATE_HOME: path.join(fixture.home, "state"),
          XDG_CACHE_HOME: path.join(fixture.home, "cache"),
          OPENCODE_TEST_HOME: fixture.home,
          OPENCODE_DB: fixture.database,
          OPENCODE_AUTH_CONTENT: "{}",
          OPENCODE_PURE: "1",
          OPENCODE_DISABLE_AUTOUPDATE: "1",
          OPENCODE_DISABLE_MODELS_FETCH: "1",
          OPENCODE_TUI_COORDINATOR_USERNAME: username,
          OPENCODE_TUI_COORDINATOR_PASSWORD: password,
          OPENCODE_TUI_COORDINATOR_TOKEN: randomBytes(24).toString("base64url"),
          OPENCODE_SERVER_USERNAME: username,
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_RUN_ID: crypto.randomUUID(),
          OPENCODE_PROCESS_ROLE: "coordinator",
          OPENCODE_TUI_COORDINATOR_STARTUP_LOCK_HELD: undefined,
        },
        stdin: "pipe",
        stdout: "ignore",
        stderr: "pipe",
      })
      const stderr = new Response(process.stderr).text()
      return {
        process,
        stderr,
        stop: () => {
          process.stdin.write("stop\n")
          process.stdin.end()
        },
      }
    }),
    (child) => {
      if (child.process.exitCode !== null) return Effect.void
      return Effect.sync(() => child.process.kill()).pipe(
        Effect.andThen(Effect.promise(() => child.process.exited)),
        Effect.asVoid,
        Effect.ignore,
      )
    },
  )
}

function readManifest(fixture: Fixture) {
  return Effect.tryPromise(() => fs.readFile(fixture.manifest, "utf8")).pipe(
    Effect.map((raw) => JSON.parse(raw) as Manifest),
    Effect.catch(() => Effect.succeed(undefined)),
  )
}

function waitForManifest(
  fixture: Fixture,
  ...children: Array<Effect.Success<ReturnType<typeof spawnCoordinator>>>
) {
  return pollWithTimeout(
    Effect.gen(function* () {
      const manifest = yield* readManifest(fixture)
      if (manifest) return manifest
      const failed = children.find((child) => child.process.exitCode !== null)
      if (!failed) return undefined
      return yield* Effect.fail(new Error(`coordinator exited before publishing a manifest\n${yield* Effect.promise(() => failed.stderr)}`))
    }),
    "coordinator did not publish a manifest",
    "30 seconds",
  )
}

function waitForManifestRemoval(fixture: Fixture) {
  return pollWithTimeout(
    Effect.tryPromise(() => fs.stat(fixture.manifest)).pipe(
      Effect.as(undefined),
      Effect.catch(() => Effect.succeed(true as const)),
    ),
    "coordinator did not remove its manifest",
    "10 seconds",
  )
}

function writeLease(fixture: Fixture) {
  const file = path.join(fixture.clients, `${process.pid}-${randomBytes(4).toString("hex")}.json`)
  return Effect.promise(async () => {
    await fs.mkdir(fixture.clients, { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({ version: 1, key: fixture.key, pid: process.pid, updatedAt: Date.now() }),
    )
    return file
  })
}

function coordinatorHeaders(manifest: Manifest) {
  return { authorization: `Basic ${Buffer.from(`${manifest.username}:${manifest.password}`).toString("base64")}` }
}

function databaseFixture(fixture: Pick<Fixture, "home" | "directory">, database: string): Fixture {
  const key = createHash("sha1").update(normalizeDatabase(database)).digest("hex")
  const coordinatorRoot = path.join(fixture.home, "state", "opencode", "tui-coordinators")
  return {
    ...fixture,
    database,
    key,
    manifest: path.join(coordinatorRoot, `${key}.json`),
    clients: path.join(coordinatorRoot, `${key}.clients`),
    ownerLock: path.join(
      fixture.home,
      "state",
      "opencode",
      "locks",
      `${createHash("sha1").update(`tui-coordinator-owner:${key}`).digest("hex")}.lock`,
    ),
  }
}

function normalizeDirectory(directory: string) {
  const resolved = path.resolve(directory)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

/*
 * The coordinator publishes the directory it actually chdir'd into, and
 * Filesystem.resolve puts that through realpathSync.native. On Windows that
 * expands 8.3 short names, so os.tmpdir() under an account whose name exceeds
 * eight characters (GitHub's runneradmin -> RUNNER~1) yields a fixture path
 * that never string-matches the manifest. Compare on the coordinator's footing.
 */
function realDirectory(directory: string) {
  const resolved = path.resolve(directory)
  if (process.platform !== "win32") return resolved
  try {
    return realpathSync.native(resolved).toLowerCase()
  } catch {
    return resolved.toLowerCase()
  }
}

function normalizeDatabase(database: string) {
  if (database === ":memory:") return database
  return normalizeDirectory(database)
}

async function removeFixture(directory: string, attempts = 20): Promise<void> {
  return fs.rm(directory, { recursive: true, force: true }).catch((error) => {
    const busy = typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY"
    if (!busy || attempts === 1) throw error
    return Bun.sleep(100).then(() => removeFixture(directory, attempts - 1))
  })
}

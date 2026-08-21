// Subprocess tests for `opencode serve` as shared backend authority.
//
// Serve claims the same per-database coordinator owner lock a TUI coordinator
// would, publishes a v2 manifest under the same key, and refuses to start when
// a live authority already owns the database (see serve-process.test.ts for the
// collision case). These tests cover the manifest shape, the loopback URL rule
// for wildcard listeners, the LAN companion socket, cross-database coexistence,
// and stale dead-owner recovery.
import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  checkCoordinatorCompatibility,
  coordinatorHeaders,
  fetchCoordinatorHealth,
  isCoordinatorManifest,
  parseCoordinatorManifest,
} from "@opencode-ai/sdk/coordinator"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import {
  manifestURLFor,
  ServeAuthorityNetworkError,
  validateServeAuthorityNetwork,
} from "@/cli/cmd/serve-authority"
import { cliIt } from "../../lib/cli-process"

const HealthIdentity = Schema.Struct({
  processRole: Schema.String,
  runID: Schema.String,
  databaseID: Schema.String,
  eventBusID: Schema.String,
})

// Mirrors XDG_STATE_HOME in the child env (test/lib/cli-process.ts):
// "$home/.local/state/opencode/tui-coordinators/<key>.json".
function coordinatorRoot(home: string) {
  return path.join(home, ".local/state/opencode", "tui-coordinators")
}

async function readServeManifest(home: string) {
  const root = coordinatorRoot(home)
  const files = (await fs.readdir(root)).filter((file) => file.endsWith(".json"))
  expect(files.length, `expected one manifest in ${root}, got ${files.join(", ")}`).toBe(1)
  return parseCoordinatorManifest(await fs.readFile(path.join(root, files[0]), "utf8"))
}

function lanIPv4() {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    const address = interfaces[name]?.find((addr) => addr.family === "IPv4" && !addr.internal)
    if (address) return address.address
  }
  return undefined
}

describe("opencode serve authority (subprocess)", () => {
  cliIt.live(
    "publishes a v2 loopback manifest, stays up with no leases, and frees the database on SIGTERM",
    ({ opencode, home }) =>
      Effect.gen(function* () {
        const first = yield* opencode.serve({
          hostname: "0.0.0.0",
          env: {
            OPENCODE_RUN_ID: "serve-authority-wildcard",
            OPENCODE_SERVER_PASSWORD: "serve-test-password",
            OPENCODE_SERVER_ALLOW_INSECURE_LAN: "1",
          },
        })
        const manifest = yield* Effect.promise(() => readServeManifest(home))

        expect(manifest.version).toBe(2)
        expect(manifest.pid).toBePositive()
        expect(manifest.directory).not.toBe("")
        expect(manifest.database).not.toBe("")
        expect(isCoordinatorManifest(manifest)).toBe(true)
        expect(coordinatorHeaders(manifest).authorization).toMatch(/^Basic /)

        // Wildcard listener still publishes a loopback URL for local clients.
        const url = yield* Effect.sync(() => new URL(manifest.url))
        expect(url.protocol).toBe("http:")
        expect(url.hostname).toBe("127.0.0.1")
        expect(Number(url.port)).toBe(first.port)

        // The wildcard listener publishes its configured credentials only to
        // the owner-readable local manifest.
        expect(manifest.username).toBe("opencode")
        expect(manifest.password).toBe("serve-test-password")

        // Old readers must accept the manifest: schema stays v2 and the only
        // addition is the same additive serverVersion the coordinator uses.
        const health = yield* Effect.promise(() => fetchCoordinatorHealth(manifest))
        expect(health?.healthy).toBe(true)
        expect(
          checkCoordinatorCompatibility({
            manifest,
            clientVersion: InstallationVersion,
            healthVersion: health?.version,
          }).compatible,
        ).toBe(true)

        // Windows does not expose POSIX permission bits through stat.
        if (process.platform !== "win32") {
          const stat = yield* Effect.promise(() => fs.stat(path.join(coordinatorRoot(home), `${manifest.key}.json`)))
          expect(stat.mode & 0o777).toBe(0o600)
        }

        // The authority has been up the whole time with zero client leases -
        // serve does not idle-shutdown the way the lease-driven coordinator
        // does. SIGTERM now triggers token-matched cleanup + lock release.
        yield* Effect.sync(() => first.kill())
        yield* Effect.promise(() => first.exited)
        const survived = yield* Effect.promise(() =>
          fs
            .access(path.join(coordinatorRoot(home), `${manifest.key}.json`))
            .then(
              () => true as const,
              () => false as const,
            ),
        )
        if (process.platform !== "win32") expect(survived).toBe(false)

        // Handoff: a successor on the same database takes over cleanly.
        yield* opencode.serve({
          hostname: "0.0.0.0",
          env: {
            OPENCODE_SERVER_PASSWORD: "serve-test-password",
            OPENCODE_SERVER_ALLOW_INSECURE_LAN: "1",
          },
        })
        const successorManifest = yield* Effect.promise(() => readServeManifest(home))
        expect(successorManifest.key).toBe(manifest.key)
        expect(successorManifest.pid).toBePositive()
      }),
    120_000,
  )

  const lanIP = lanIPv4()
  const lanSuite = lanIP ? describe : describe.skip

  lanSuite("opencode serve authority (subprocess) LAN", () => {
    cliIt.live(
      "LAN listener gets a loopback companion sharing one event bus",
      ({ opencode, home }) =>
        Effect.gen(function* () {
          const server = yield* opencode.serve({
            hostname: lanIP,
            env: {
              OPENCODE_SERVER_PASSWORD: "serve-test-password",
              OPENCODE_SERVER_ALLOW_INSECURE_LAN: "true",
            },
          })
          const manifest = yield* Effect.promise(() => readServeManifest(home))
          const url = yield* Effect.sync(() => new URL(manifest.url))

          expect(url.hostname).toBe("127.0.0.1")
          // The companion is a separate ephemeral socket, not the LAN bind.
          expect(Number(url.port)).not.toBe(server.port)

          const primary = Schema.decodeUnknownSync(HealthIdentity)(
            yield* Effect.promise(() =>
              fetch(`${server.url}/global/health`, { headers: coordinatorHeaders(manifest) }).then((response) =>
                response.json(),
              ),
            ),
          )
          const companion = Schema.decodeUnknownSync(HealthIdentity)(
            yield* Effect.promise(() =>
              fetch(`${manifest.url}/global/health`, { headers: coordinatorHeaders(manifest) }).then((response) =>
                response.json(),
              ),
            ),
          )
          expect(primary.databaseID).toBe(companion.databaseID)
          // One in-process event bus: the companion is not a second authority.
          expect(primary.eventBusID).toBe(companion.eventBusID)
        }),
      90_000,
    )
  })

  cliIt.live(
    "distinct databases each get their own authority",
    ({ opencode }) =>
      Effect.gen(function* () {
        const first = yield* opencode.serve({ env: { OPENCODE_DB: "db-first.db" } })
        const second = yield* opencode.serve({ env: { OPENCODE_DB: "db-second.db" } })
        const client = yield* HttpClient.HttpClient
        const firstHealth = Schema.decodeUnknownSync(HealthIdentity)(
          yield* (yield* client.get(`${first.url}/global/health`)).json,
        )
        const secondHealth = Schema.decodeUnknownSync(HealthIdentity)(
          yield* (yield* client.get(`${second.url}/global/health`)).json,
        )
        expect(firstHealth.databaseID).not.toBe(secondHealth.databaseID)
        expect(firstHealth.eventBusID).not.toBe(secondHealth.eventBusID)
      }),
    90_000,
  )

  cliIt.live(
    "recovers a stale manifest whose owner pid is dead",
    ({ opencode, home }) =>
      Effect.gen(function* () {
        const first = yield* opencode.serve()
        const original = yield* Effect.promise(() => readServeManifest(home))
        yield* Effect.sync(() => first.kill())
        yield* Effect.promise(() => first.exited)

        // Simulate a crash that left the manifest behind: the pid is dead but
        // the file survives, so no live authority is actually serving.
        const stale = { ...original, pid: 9_999_999 }
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(coordinatorRoot(home), `${original.key}.json`),
            JSON.stringify(stale),
          ),
        )

        yield* opencode.serve()
        const replacement = yield* Effect.promise(() => readServeManifest(home))
        expect(replacement.key).toBe(original.key)
        expect(replacement.pid).toBePositive()
        expect(replacement.pid).not.toBe(stale.pid)
      }),
    90_000,
  )

  cliIt.live(
    "concurrent same-database startups yield exactly one authority; the loser fails without disturbing it",
    ({ opencode, home }) =>
      Effect.gen(function* () {
        // Both contenders boot at the same time and race for the same startup
        // and owner locks. Whichever wins becomes the authority; the other
        // must fail with the collision error rather than wedge or displace it.
        const scope = yield* Effect.scope
        const [aFiber, bFiber] = yield* Effect.all([
          Effect.forkIn(opencode.serve({ env: { OPENCODE_RUN_ID: "race-a" } }), scope),
          Effect.forkIn(opencode.serve({ env: { OPENCODE_RUN_ID: "race-b" } }), scope),
        ])
        const [aExit, bExit] = yield* Effect.all([Fiber.await(aFiber), Fiber.await(bFiber)])

        const [winnerExit, loserExit] = Exit.isSuccess(aExit) ? [aExit, bExit] : [bExit, aExit]
        if (!Exit.isSuccess(winnerExit)) throw new Error("expected exactly one concurrent startup to win the race")
        if (Exit.isSuccess(loserExit)) throw new Error("expected exactly one concurrent startup to lose the race")
        const winner = winnerExit.value

        // The race leaves exactly one manifest: the surviving authority.
        const manifest = yield* Effect.promise(() => readServeManifest(home))
        expect(manifest.version).toBe(2)

        // The loser exited with the collision error. The harness embeds the
        // tail of the loser's stderr in its readiness failure, so the clear
        // refusal message is visible even though the loser never listened.
        const failReason = loserExit.cause.reasons.find(Cause.isFailReason)
        const loserMessage = failReason?.error !== undefined ? String(failReason.error) : ""
        expect(loserMessage).toContain("A backend authority is already serving this database")

        // The winner survived the race untouched.
        const client = yield* HttpClient.HttpClient
        const health = Schema.decodeUnknownSync(HealthIdentity)(
          yield* (yield* client.get(`${winner.url}/global/health`)).json,
        )
        expect(health).toMatchObject({ processRole: "main" })
        expect(health.runID).toMatch(/^race-/)
      }),
    120_000,
  )
})

describe("serve-authority manifest URL helper", () => {
  test("0.0.0.0 publishes a loopback URL on the primary port", () => {
    expect(manifestURLFor("0.0.0.0", 1234)).toBe("http://127.0.0.1:1234/")
  })
  test(":: publishes a bracketed IPv6 loopback URL on the primary port", () => {
    expect(manifestURLFor("::", 1234)).toBe("http://[::1]:1234/")
  })
  test("loopback hostnames publish themselves", () => {
    expect(manifestURLFor("127.0.0.1", 1234)).toBe("http://127.0.0.1:1234/")
    expect(manifestURLFor("::1", 1234)).toBe("http://[::1]:1234/")
    expect(manifestURLFor("localhost", 1234)).toBe("http://localhost:1234/")
  })
})

describe("serve-authority network validation", () => {
  test("allows loopback without a password or insecure-LAN opt-in", () => {
    expect(Effect.runSync(validateServeAuthorityNetwork({ hostname: "127.0.0.1", password: "" }))).toBeUndefined()
  })

  test("rejects a non-loopback listener without a password", () => {
    const error = Effect.runSync(
      Effect.flip(validateServeAuthorityNetwork({ hostname: "0.0.0.0", password: "", allowInsecureLan: "1" })),
    )
    expect(error).toBeInstanceOf(ServeAuthorityNetworkError)
    expect(error.message).toContain("OPENCODE_SERVER_PASSWORD")
  })

  test("rejects a non-loopback listener without explicit insecure-LAN opt-in", () => {
    expect(() => Effect.runSync(validateServeAuthorityNetwork({ hostname: "192.0.2.1", password: "secret" }))).toThrow(
      "OPENCODE_SERVER_ALLOW_INSECURE_LAN",
    )
  })

  test("allows a password-protected non-loopback listener with explicit opt-in", () => {
    expect(() =>
      Effect.runSync(
        validateServeAuthorityNetwork({ hostname: "192.0.2.1", password: "secret", allowInsecureLan: "true" }),
      ),
    ).not.toThrow()
  })
})

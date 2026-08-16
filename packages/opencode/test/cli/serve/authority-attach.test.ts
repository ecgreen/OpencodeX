// Client attach-first contract against a running `opencode serve` authority.
//
// Serve publishes the same per-database v2 coordinator manifest as the TUI
// coordinator and the GUI sidecar. The one-writer invariant says clients that
// need a backend (`run`, `acp`, and the explicit-network TUI) must attach to
// that existing authority rather than racing a second one. These tests pin one
// database via OPENCODE_DB and assert that:
//   - the default `run` path attaches and the serve manifest stays the sole
//     authority,
//   - `acp` attaches and warns instead of opening a second backend,
//   - the explicit-network TUI (`--port`) attaches and warns instead of
//     binding a second backend.
import { describe, expect } from "bun:test"
import { coordinatorKey } from "@opencode-ai/sdk/coordinator"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"
import { awaitWithTimeout, pollWithTimeout } from "../../lib/effect"
import { createAcpClient } from "../acp/acp-test-client"
import { initialize } from "../acp/helpers"

const root = path.resolve(import.meta.dir, "../../..")
const cliEntry = path.join(root, "src", "index.ts")

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

// stateRoot mirrors the harness's XDG_STATE_HOME/opencode.
function stateRoot(home: string) {
  return path.join(home, ".local/state", "opencode")
}

function manifestFile(home: string, database: string) {
  return path.join(stateRoot(home), "tui-coordinators", `${coordinatorKey(database)}.json`)
}

function readManifest(home: string, database: string) {
  return Effect.tryPromise(() => fs.readFile(manifestFile(home, database), "utf8")).pipe(
    Effect.map((raw) => JSON.parse(raw) as Manifest),
    Effect.catch(() => Effect.succeed(undefined)),
  )
}

function manifestFiles(home: string) {
  return Effect.tryPromise(async () => {
    const dir = path.join(stateRoot(home), "tui-coordinators")
    return (await fs.readdir(dir)).filter((file) => file.endsWith(".json"))
  }).pipe(Effect.catch(() => Effect.succeed([])))
}

function coordinatorHeaders(manifest: Manifest) {
  return { authorization: `Basic ${Buffer.from(`${manifest.username}:${manifest.password}`).toString("base64")}` }
}

function urlPort(url: string) {
  return Number(new URL(url).port)
}

describe("clients attach-first against a running serve authority", () => {
  cliIt.live(
    "run attaches to serve instead of starting a second backend",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const database = path.join(home, "shared.db")
        const serve = yield* opencode.serve({ env: { OPENCODE_DB: database } })
        const serveManifest = yield* pollWithTimeout(
          readManifest(home, database),
          "serve did not publish a coordinator manifest",
          "30 seconds",
        )
        expect(urlPort(serveManifest.url)).toBe(serve.port)

        yield* llm.text("hello from the serve-attached run")
        const result = yield* opencode.run("say hi", { env: { OPENCODE_DB: database } })
        opencode.expectExit(result, 0)
        expect(result.stdout).toContain("hello from the serve-attached run")

        // One writer: serve is still the only authority and run published nothing.
        const after = yield* readManifest(home, database)
        expect(after).toMatchObject({ pid: serveManifest.pid, url: serveManifest.url })
        expect(yield* manifestFiles(home)).toHaveLength(1)

        const health = yield* Effect.promise(() => fetch(new URL("/global/health", serve.url)))
        expect(health.status).toBe(200)
      }),
    90_000,
  )

  cliIt.live(
    "acp attaches to serve and warns instead of opening a second backend",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const database = path.join(home, "shared.db")
        const serve = yield* opencode.serve({ env: { OPENCODE_DB: database } })
        const serveManifest = yield* pollWithTimeout(
          readManifest(home, database),
          "serve did not publish a coordinator manifest",
          "30 seconds",
        )
        const acp = yield* opencode.acp({ env: { OPENCODE_DB: database } })

        yield* pollWithTimeout(
          Effect.gen(function* () {
            const stderr = yield* Effect.sync(() => acp.stderr())
            return stderr.includes("already has an authority") ? (true as const) : undefined
          }),
          "acp did not warn about attaching to the existing authority",
          "30 seconds",
        )

        const after = yield* readManifest(home, database)
        expect(after).toMatchObject({ pid: serveManifest.pid, url: serveManifest.url })
        expect(urlPort(after!.url)).toBe(serve.port)
        yield* Effect.sync(() => acp.close())
        yield* awaitWithTimeout(
          Effect.promise(() => acp.exited),
          "acp did not exit after stdin closed",
          "10 seconds",
        )
      }),
    90_000,
  )

  cliIt.live(
    "explicit-network tui attaches to serve and warns instead of binding a second backend",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const database = path.join(home, "shared.db")
        const serve = yield* opencode.serve({ env: { OPENCODE_DB: database } })
        const serveManifest = yield* pollWithTimeout(
          readManifest(home, database),
          "serve did not publish a coordinator manifest",
          "30 seconds",
        )

        const tui = yield* spawnHeadlessTui(home, database)
        yield* pollWithTimeout(
          Effect.gen(function* () {
            return tui.stderr.includes("already has an authority") ? (true as const) : undefined
          }),
          "tui did not warn about attaching to the existing authority",
          "30 seconds",
        )

        const after = yield* readManifest(home, database)
        expect(after).toMatchObject({ pid: serveManifest.pid, url: serveManifest.url })
        expect(urlPort(after!.url)).toBe(serve.port)
      }),
    90_000,
  )

  cliIt.live(
    "explicit-network tui with no authority serves the database and publishes an authority manifest",
    ({ home }) =>
      Effect.gen(function* () {
        const database = path.join(home, "shared.db")
        yield* spawnHeadlessTui(home, database, {
          OPENCODE_SERVER_USERNAME: "lan-user",
          OPENCODE_SERVER_PASSWORD: "lan-secret",
        })

        const manifest = yield* pollWithTimeout(
          readManifest(home, database),
          "tui worker did not publish a coordinator manifest",
          "45 seconds",
        )
        const health = yield* Effect.promise(() =>
          fetch(new URL("/global/health", manifest.url), { headers: coordinatorHeaders(manifest) }),
        )
        expect(health.status).toBe(200)
        expect(manifest.pid).not.toBe(process.pid)
        expect(manifest.username).toBe("lan-user")
        expect(manifest.password).toBe("lan-secret")
      }),
    90_000,
  )

  cliIt.live(
    "fallback acp owns the database until it shuts down",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const database = path.join(home, "shared.db")
        const handle = yield* opencode.acp({ env: { OPENCODE_DB: database } })
        yield* initialize(createAcpClient(handle))

        const collision = yield* opencode.spawn(["serve", "--port", "0"], {
          env: { OPENCODE_DB: database },
          timeoutMs: 30_000,
        })
        expect(collision.exitCode).not.toBe(0)
        expect(collision.stderr).toContain("Timed out waiting for lock: tui-coordinator-owner:")

        handle.close()
        expect(
          yield* awaitWithTimeout(
            Effect.promise(() => handle.exited),
            "fallback acp did not release the database",
            "30 seconds",
          ),
        ).toBe(0)

        const serve = yield* opencode.serve({ env: { OPENCODE_DB: database } })
        expect(serve.port).toBePositive()
      }),
    120_000,
  )
})

function spawnHeadlessTui(home: string, database: string, extraEnv: Record<string, string> = {}) {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const workspace = path.join(home, "workspace")
      await fs.mkdir(workspace, { recursive: true })
      const tuiEnv = {
        HOME: home,
        OPENCODE_TEST_HOME: home,
        XDG_CONFIG_HOME: path.join(home, ".config"),
        XDG_DATA_HOME: path.join(home, ".local/share"),
        XDG_STATE_HOME: path.join(home, ".local/state"),
        XDG_CACHE_HOME: path.join(home, ".cache"),
        OPENCODE_CONFIG_CONTENT: JSON.stringify({}),
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_PURE: "1",
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_AUTOCOMPACT: "1",
        OPENCODE_DISABLE_MODELS_FETCH: "1",
        OPENCODE_AUTH_CONTENT: "{}",
        OPENCODE_DB: database,
        ...extraEnv,
      }
      const argv = [cliEntry, "--port", "0", "--prompt", "hello"]
      const command = process.env.OPENCODE_TEST_CLI_BUNDLE
        ? [process.env.OPENCODE_TEST_CLI_BUNDLE, ...argv.slice(1)]
        : ["bun", "run", "--conditions=browser", ...argv]
      const child = Bun.spawn(command, {
        cwd: workspace,
        env: { ...process.env, ...tuiEnv },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      })
      const stderrChunks: string[] = []
      void (async () => {
        try {
          const reader = child.stderr.getReader()
          const decoder = new TextDecoder()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            stderrChunks.push(decoder.decode(value, { stream: true }))
          }
        } catch {
          // stderr closing while the child is killed is expected.
        }
      })()
      return {
        process: child,
        get stderr() {
          return stderrChunks.join("")
        },
      }
    }),
    (tui) => {
      if (tui.process.exitCode !== null) return Effect.void
      return Effect.sync(() => tui.process.kill()).pipe(
        Effect.andThen(Effect.promise(() => tui.process.exited)),
        Effect.asVoid,
        Effect.ignore,
      )
    },
  )
}

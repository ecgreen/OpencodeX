// Subprocess integration tests for `opencode serve`. Spawns the real CLI in
// headless mode and exercises it over HTTP — this is the only test tier that
// catches bugs spanning argv → server boot → routing → instance loading.
//
// `serve` is long-lived: the harness returns a handle (url/port/kill/exited)
// and kills the process when the test scope closes. The OS-assigned port is
// parsed off the "listening on http://..." line.
import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { cliIt } from "../../lib/cli-process"

const HealthIdentity = Schema.Struct({
  processRole: Schema.String,
  runID: Schema.String,
  databaseID: Schema.String,
  eventBusID: Schema.String,
})

describe("opencode serve (subprocess)", () => {
  // Smoke test: server starts, binds a port, and /global/health responds.
  // If this fails, all other serve tests likely will too — debug here first.
  cliIt.live(
    "starts, binds a port, and serves /global/health",
    ({ opencode }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve()
        expect(server.port).toBeGreaterThan(0)
        expect(server.url).toMatch(/^http:\/\//)

        const client = yield* HttpClient.HttpClient
        const res = yield* client.get(`${server.url}/global/health`)
        expect(res.status).toBe(200)
        // GlobalHealth schema is { success: true, ... } | { success: false, error }.
        // We don't lock in further shape here — any 200 with parseable JSON is
        // enough proof the routing + auth-bypass + instance loading is alive.
        const body = yield* res.json
        expect(body).toBeDefined()
      }),
    60_000,
  )

  cliIt.live(
    "distinguishes process-local event buses sharing one database",
    ({ opencode }) =>
      Effect.gen(function* () {
        const first = yield* opencode.serve({ env: { OPENCODE_RUN_ID: "serve-first" } })
        const second = yield* opencode.serve({ env: { OPENCODE_RUN_ID: "serve-second" } })
        const client = yield* HttpClient.HttpClient
        const firstHealth = Schema.decodeUnknownSync(HealthIdentity)(
          yield* (yield* client.get(`${first.url}/global/health`)).json,
        )
        const secondHealth = Schema.decodeUnknownSync(HealthIdentity)(
          yield* (yield* client.get(`${second.url}/global/health`)).json,
        )

        expect(firstHealth).toMatchObject({ processRole: "main", runID: "serve-first" })
        expect(secondHealth).toMatchObject({ processRole: "main", runID: "serve-second" })
        expect(firstHealth).toHaveProperty("databaseID")
        expect(firstHealth).toHaveProperty("eventBusID")
        expect(secondHealth).toHaveProperty("databaseID", firstHealth.databaseID)
        expect(secondHealth.eventBusID).not.toBe(firstHealth.eventBusID)
      }),
    90_000,
  )

  // The scope-close finalizer must actually terminate the child. Without this
  // test a regression in the kill path (e.g. a future refactor that forgets
  // to wire the finalizer) would leak processes on every test run.
  cliIt.live(
    "kills the subprocess on scope close",
    ({ opencode }) =>
      Effect.gen(function* () {
        // Inner scope so we can observe `.exited` resolving after it closes.
        const exitedPromise = yield* Effect.scoped(
          Effect.gen(function* () {
            const server = yield* opencode.serve()
            // Capture the Promise, not the resolved value — scope closes after
            // this gen returns, at which point the finalizer kills the child.
            return server.exited
          }),
        )
        // After scope close: finalizer fired, process must have exited.
        const code = yield* Effect.promise(() => exitedPromise)
        // Bun reports the exit code; SIGTERM-killed processes return non-null
        // (typically 143 on POSIX). We just require resolution within a sane
        // window — anything else means the kill didn't take.
        expect(typeof code === "number" || code === null).toBe(true)
      }),
    60_000,
  )
})

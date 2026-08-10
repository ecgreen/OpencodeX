import { afterEach, describe, expect, mock, spyOn } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import path from "node:path"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SyncPaths } from "../../src/server/routes/instance/httpapi/groups/sync"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { Session } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

void Log.init({ print: false })

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const context = Context.empty() as Context.Context<unknown>
const it = testEffect(Layer.mergeAll(Session.defaultLayer, Database.defaultLayer, httpApiLayer))

afterEach(async () => {
  mock.restore()
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await disposeAllInstances()
  await resetDatabase()
})

describe("sync HttpApi", () => {
  it.instance(
    "serves sync routes",
    () =>
      Effect.gen(function* () {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const tmp = yield* TestInstance
        const headers = { "x-opencode-directory": tmp.directory, "content-type": "application/json" }
        const info = spyOn(Log.create({ service: "server.sync" }), "info")
        const session = yield* Session.use.create({ title: "sync" })

        const started = yield* requestInDirectory(SyncPaths.start, tmp.directory, { method: "POST", headers })
        expect(started.status).toBe(200)
        expect(yield* started.json).toBe(true)

        const history = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({ directory: tmp.directory, state: {} }),
        })
        expect(history.status).toBe(200)
        const rows = (yield* history.json) as Array<{
          id: string
          aggregate_id: string
          seq: number
          type: string
          data: Record<string, unknown>
        }>
        expect(rows.map((row) => row.aggregate_id)).toContain(session.id)

        const replayed = yield* requestInDirectory(SyncPaths.replay, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            directory: tmp.directory,
            events: rows
              .filter((row) => row.aggregate_id === session.id)
              .map((row) => ({
                id: row.id,
                aggregateID: row.aggregate_id,
                seq: row.seq,
                type: row.type,
                data: row.data,
              })),
          }),
        })
        expect(replayed.status).toBe(200)
        expect(yield* replayed.json).toEqual({ sessionID: session.id })
        expect(info.mock.calls.some(([message]) => message === "sync replay requested")).toBe(true)
        expect(info.mock.calls.some(([message]) => message === "sync replay complete")).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "scopes sync history to the requesting directory",
    () =>
      Effect.gen(function* () {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const tmp = yield* TestInstance
        const headers = { "x-opencode-directory": tmp.directory, "content-type": "application/json" }
        const sessionA = yield* Session.use.create({ title: "alpha" })
        const sessionB = yield* Session.use.create({ title: "beta" })

        // The hub DB is shared across projects; give sessionB a different
        // directory so we can prove history stays scoped per project.
        const { db } = yield* Database.Service
        const other = path.join(tmp.directory, "other-project")
        yield* db
          .update(SessionTable)
          .set({ directory: other })
          .where(eq(SessionTable.id, sessionB.id))
          .run()
          .pipe(Effect.orDie)

        const historyA = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({ directory: tmp.directory, state: {} }),
        })
        expect(historyA.status).toBe(200)
        const rowsA = (yield* historyA.json) as Array<{ aggregate_id: string }>
        expect(rowsA.map((row) => row.aggregate_id)).toContain(sessionA.id)
        expect(rowsA.map((row) => row.aggregate_id)).not.toContain(sessionB.id)

        const historyB = yield* requestInDirectory(SyncPaths.history, other, {
          method: "POST",
          headers: { "x-opencode-directory": other, "content-type": "application/json" },
          body: JSON.stringify({ directory: other, state: {} }),
        })
        expect(historyB.status).toBe(200)
        const rowsB = (yield* historyB.json) as Array<{ aggregate_id: string }>
        expect(rowsB.map((row) => row.aggregate_id)).toContain(sessionB.id)
        expect(rowsB.map((row) => row.aggregate_id)).not.toContain(sessionA.id)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "validates seq values",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const headers = { "x-opencode-directory": tmp.directory, "content-type": "application/json" }
        const cases = [
          {
            path: SyncPaths.history,
            body: { directory: tmp.directory, state: { "ses_1": -1 } },
          },
          {
            path: SyncPaths.history,
            body: { directory: tmp.directory, state: { "ses_1": 1.5 } },
          },
          {
            path: SyncPaths.replay,
            body: {
              directory: tmp.directory,
              events: [{ id: "event", aggregateID: "session", seq: -1, type: "session.created", data: {} }],
            },
          },
          {
            path: SyncPaths.replay,
            body: {
              directory: tmp.directory,
              events: [{ id: "event", aggregateID: "session", seq: 1.5, type: "session.created", data: {} }],
            },
          },
        ]

        for (const item of cases) {
          const response = yield* requestInDirectory(item.path, tmp.directory, {
            method: "POST",
            headers,
            body: JSON.stringify(item.body),
          })
          expect(response.status).toBe(400)
        }
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance.skip(
    "returns structured validation errors",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const response = yield* Effect.promise(() =>
          HttpApiApp.webHandler().handler(
            new Request(`http://localhost${SyncPaths.history}`, {
              method: "POST",
              headers: { "x-opencode-directory": tmp.directory, "content-type": "application/json" },
              body: JSON.stringify({ aggregate: -1 }),
            }),
            context,
          ),
        )

        expect(response.status).toBe(400)
        expect(response.headers.get("content-type") ?? "").toContain("application/json")
        const body = (yield* Effect.promise(() => response.json())) as Record<string, unknown>
        expect(body.success).toBe(false)
        expect(Array.isArray(body.error) || Array.isArray(body.errors)).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})

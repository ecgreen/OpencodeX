import { afterEach, describe, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Layer } from "effect"
import { HttpServer } from "effect/unstable/http"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { disposeAllInstances, tmpdirScoped } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"
import { httpApiLayer } from "./httpapi-layer"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const it = testEffect(
  Layer.mergeAll(
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)),
    Database.defaultLayer,
    httpApiLayer,
  ),
)

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
}

function stream(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("SSE response has no body")
  const decoder = new TextDecoder()
  let buffered = ""
  return {
    next: async () => {
      while (true) {
        const boundary = buffered.indexOf("\n\n")
        if (boundary >= 0) {
          const block = buffered.slice(0, boundary)
          buffered = buffered.slice(boundary + 2)
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
          if (data) return JSON.parse(data) as unknown
          continue
        }
        const chunk = await reader.read()
        if (chunk.done) throw new Error("SSE stream ended before the next frame")
        buffered += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n")
      }
    },
    close: () => {
      void reader.cancel().catch(() => undefined)
    },
  }
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("OpencodeX state HTTP API", () => {
  it.live("serves atomic snapshots and scoped replayable SSE", () =>
    Effect.gen(function* () {
      const firstDirectory = yield* tmpdirScoped({ git: true, config: { formatter: false, lsp: false } })
      const secondDirectory = yield* tmpdirScoped({ git: true, config: { formatter: false, lsp: false } })
      const server = yield* HttpServer.HttpServer
      const base = HttpServer.formatAddress(server.address)
      const request = (directory: string, path: string, init: RequestInit = {}) => {
        const headers = new Headers(init.headers)
        headers.set("x-opencode-directory", directory)
        if (init.body) headers.set("content-type", "application/json")
        return fetch(new URL(path, base), { ...init, headers })
      }

      const doc = yield* Effect.promise(() => request(firstDirectory, "/doc").then((response) => response.json()))
      const operations = Object.values(record(record(doc).paths)).flatMap((path) =>
        Object.values(record(path)).map((operation) => record(operation).operationId),
      )
      expect(operations).toContain("opencodex.state.snapshot")
      expect(operations).toContain("opencodex.state.session")
      expect(operations).toContain("opencodex.state.event")
      const schemas = record(record(doc).components).schemas
      for (const name of [
        "OpencodeXStateScope",
        "OpencodeXStateCursor",
        "OpencodeXStateSnapshot",
        "OpencodeXSessionSnapshot",
        "OpencodeXStateEvent",
        "OpencodeXStateStreamFrame",
      ]) {
        expect(record(schemas)).toHaveProperty(name)
      }

      const created = yield* Effect.promise(() =>
        request(firstDirectory, "/session", { method: "POST", body: JSON.stringify({ title: "state test" }) }).then(
          (response) => response.json(),
        ),
      )
      const sessionID = String(record(created).id)
      yield* Effect.promise(() =>
        Promise.all([
          request(firstDirectory, `/experimental/opencodex/session-state/${sessionID}`, {
            method: "PATCH",
            body: JSON.stringify({ seenAt: 10 }),
          }),
          request(firstDirectory, `/experimental/opencodex/session-state/${sessionID}`, {
            method: "PATCH",
            body: JSON.stringify({ reviewedFiles: ["src/app.tsx"] }),
          }),
        ]),
      )
      const snapshot = record(
        yield* Effect.promise(() =>
          request(firstDirectory, "/experimental/opencodex/state").then((response) => response.json()),
        ),
      )
      expect(record(snapshot.scope).directory).toBe(firstDirectory)
      expect(typeof record(snapshot.scope).projectID).toBe("string")
      expect(typeof snapshot.cursor).toBe("string")
      expect(typeof record(record(snapshot.domains).catalog).digest).toBe("string")
      expect(Array.isArray(record(record(snapshot.payloads).catalog).sessions)).toBe(true)
      expect(record(record(record(snapshot.payloads).catalog).sessionUiState)[sessionID]).toMatchObject({
        seenAt: 10,
        reviewedFiles: ["src/app.tsx"],
      })

      const session = record(
        yield* Effect.promise(() =>
          request(firstDirectory, `/experimental/opencodex/state/session/${sessionID}`).then((response) =>
            response.json(),
          ),
        ),
      )
      expect(record(session.session).id).toBe(sessionID)
      expect(Array.isArray(record(session.messages).items)).toBe(true)
      expect(record(session.messages).coverage).toEqual({})
      expect(typeof record(record(session.messages).boundary).hasMore).toBe("boolean")
      expect(Array.isArray(session.todos)).toBe(true)
      expect(Array.isArray(session.diff)).toBe(true)
      expect(Array.isArray(record(session.pendingInteractions).permissions)).toBe(true)
      expect(Array.isArray(record(session.pendingInteractions).questions)).toBe(true)
      expect(session.cursor).toBe(snapshot.cursor)

      const controller = new AbortController()
      const response = yield* Effect.promise(() =>
        request(
          firstDirectory,
          `/experimental/opencodex/state/event?after=${encodeURIComponent(String(snapshot.cursor))}`,
          { signal: controller.signal },
        ),
      )
      const events = stream(response)
      yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()))
      const ready = record(yield* Effect.promise(() => events.next()))
      expect(ready.type).toBe("ready")

      yield* Effect.promise(() =>
        request(firstDirectory, `/session/${sessionID}`, {
          method: "PATCH",
          body: JSON.stringify({ title: "updated" }),
        }),
      )
      const live = record(yield* Effect.promise(() => events.next()))
      expect(live.type).toBe("event")
      expect(record(live.event).scope).toEqual(snapshot.scope)
      expect(record(record(live.event).payload).aggregateID).toBe(sessionID)
      expect(record(record(live.event).payload).eventType).toBe("session.updated")
      const createdView = record(
        yield* Effect.promise(() =>
          request(firstDirectory, "/experimental/opencodex/view", {
            method: "POST",
            body: JSON.stringify({ title: "shared view", sessionIDs: [sessionID] }),
          }).then((value) => value.json()),
        ),
      )
      const viewLive = record(yield* Effect.promise(() => events.next()))
      expect(viewLive.type).toBe("event")
      expect(record(record(viewLive.event).payload).aggregateID).toBe(createdView.id)
      expect(record(record(viewLive.event).payload).eventType).toBe("opencodex.view.created")
      controller.abort()

      const second = yield* Effect.promise(() =>
        request(secondDirectory, "/session", { method: "POST", body: JSON.stringify({ title: "isolated" }) }).then(
          (value) => value.json(),
        ),
      )
      yield* Effect.promise(() =>
        request(secondDirectory, `/session/${String(record(second).id)}`, {
          method: "PATCH",
          body: JSON.stringify({ title: "isolated update" }),
        }),
      )
      yield* Effect.promise(() =>
        request(firstDirectory, `/session/${sessionID}`, {
          method: "PATCH",
          body: JSON.stringify({ title: "replayed" }),
        }),
      )

      const replayController = new AbortController()
      const replayResponse = yield* Effect.promise(() =>
        request(
          firstDirectory,
          `/experimental/opencodex/state/event?after=${encodeURIComponent(String(record(viewLive.event).cursor))}`,
          { signal: replayController.signal },
        ),
      )
      const replay = stream(replayResponse)
      yield* Effect.addFinalizer(() => Effect.sync(() => replayController.abort()))
      expect(record(yield* Effect.promise(() => replay.next())).type).toBe("ready")
      const replayed = record(yield* Effect.promise(() => replay.next()))
      expect(replayed.type).toBe("event")
      expect(record(record(replayed.event).scope).directory).toBe(firstDirectory)
      expect(record(record(replayed.event).payload).aggregateID).toBe(sessionID)
      replayController.abort()

      const resetController = new AbortController()
      const reset = stream(
        yield* Effect.promise(() =>
          request(firstDirectory, "/experimental/opencodex/state/event?after=invalid", {
            signal: resetController.signal,
          }),
        ),
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => resetController.abort()))
      expect(record(yield* Effect.promise(() => reset.next())).type).toBe("ready")
      expect(record(yield* Effect.promise(() => reset.next())).type).toBe("reset_required")
      resetController.abort()
    }),
  )
})

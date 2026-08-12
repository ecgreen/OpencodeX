import { afterEach, describe, expect } from "bun:test"
import { Effect, Queue, Schema, Stream } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

void Log.init({ print: false })

const EventData = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Any),
})

const GlobalEventData = Schema.Union([
  Schema.Struct({
    directory: Schema.String,
    project: Schema.optional(Schema.String),
    workspace: Schema.optional(Schema.String),
    payload: EventData,
  }),
  Schema.Struct({
    payload: Schema.Struct({
      id: Schema.optional(Schema.String),
      type: Schema.Literals(["server.connected", "server.heartbeat"]),
      properties: Schema.Record(Schema.String, Schema.Any),
    }),
  }),
])

const readEvent = (reader: Queue.Dequeue<Uint8Array>) =>
  Effect.gen(function* () {
    const value = yield* Queue.take(reader).pipe(
      Effect.timeoutOrElse({
        duration: "5 seconds",
        orElse: () => Effect.fail(new Error("timed out waiting for event")),
      }),
    )
    return Schema.decodeUnknownSync(EventData)(JSON.parse(new TextDecoder().decode(value).replace(/^data: /, "")))
  })

const openEventStream = (directory: string) =>
  Effect.gen(function* () {
    const response = yield* requestInDirectory(EventPaths.event, directory)
    const reader = yield* Queue.unbounded<Uint8Array>()
    yield* response.stream.pipe(
      Stream.runForEach((value) => Queue.offer(reader, value)),
      Effect.forkScoped,
    )
    return { response, reader }
  })

const readGlobalEvent = (reader: Queue.Dequeue<typeof GlobalEventData.Type>) =>
  Queue.take(reader).pipe(
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.fail(new Error("timed out waiting for global event")),
    }),
  )

const readGlobalEventMatching = (
  reader: Queue.Dequeue<typeof GlobalEventData.Type>,
  predicate: (event: typeof GlobalEventData.Type) => boolean,
): Effect.Effect<typeof GlobalEventData.Type, Error> =>
  Effect.suspend(() =>
    Queue.take(reader).pipe(
      Effect.flatMap((event) =>
        predicate(event) ? Effect.succeed(event) : readGlobalEventMatching(reader, predicate),
      ),
    ),
  ).pipe(
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.fail(new Error("timed out waiting for matching global event")),
    }),
  )

const openGlobalEventStream = (directory: string) =>
  Effect.gen(function* () {
    const response = yield* requestInDirectory(GlobalPaths.event, directory)
    const reader = yield* Queue.unbounded<typeof GlobalEventData.Type>()
    yield* response.stream.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.filter((line) => line.startsWith("data:")),
      Stream.map((line) => Schema.decodeUnknownSync(GlobalEventData)(JSON.parse(line.slice(5).trimStart()))),
      Stream.runForEach((value) => Queue.offer(reader, value)),
      Effect.forkScoped,
    )
    return { response, reader }
  })

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const it = testEffect(httpApiLayer)

describe("event HttpApi", () => {
  it.instance(
    "serves event stream",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { response, reader } = yield* openEventStream(directory)

        expect(response.status).toBe(200)
        expect(response.headers["content-type"]).toContain("text/event-stream")
        expect(response.headers["cache-control"]).toBe("no-cache, no-transform")
        expect(response.headers["x-accel-buffering"]).toBe("no")
        expect(response.headers["x-content-type-options"]).toBe("nosniff")
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "keeps the event stream open after the initial event",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        // If no second event arrives within 250ms, the stream is still open.
        const status = yield* Queue.take(reader).pipe(
          Effect.as("event" as const),
          Effect.timeoutOrElse({ duration: "250 millis", orElse: () => Effect.succeed("open" as const) }),
        )
        expect(status).toBe("open")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "delivers instance events after the initial event",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        const created = yield* requestInDirectory("/session", directory, { method: "POST" })
        expect(created.status).toBe(200)
        expect(yield* readEvent(reader)).toMatchObject({ type: "session.created" })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})

describe("global event HttpApi", () => {
  it.instance(
    "delivers another client's prompt to an existing subscriber without refetching",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const created = yield* requestInDirectory(SessionPaths.create, directory, { method: "POST" })
        expect(created.status).toBe(200)
        const session = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(yield* created.json)

        const { response, reader } = yield* openGlobalEventStream(directory)
        expect(response.status).toBe(200)
        expect(yield* readGlobalEvent(reader)).toMatchObject({
          payload: { type: "server.connected", properties: {} },
        })

        const text = "cross-client realtime prompt"
        const prompt = yield* requestInDirectory(
          SessionPaths.prompt.replace(":sessionID", session.id),
          directory,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ agent: "build", noReply: true, parts: [{ type: "text", text }] }),
          },
        )
        expect(prompt.status).toBe(200)

        const partEvent = yield* readGlobalEventMatching(reader, (event) => event.payload.type === "message.part.updated")
        expect(partEvent).toMatchObject({
          directory,
          payload: {
            type: "message.part.updated",
            properties: { part: { sessionID: session.id, type: "text", text } },
          },
        })

        const messages = yield* requestInDirectory(
          SessionPaths.messages.replace(":sessionID", session.id),
          directory,
        )
        expect(messages.status).toBe(200)
        expect(JSON.stringify(yield* messages.json)).toContain(text)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})

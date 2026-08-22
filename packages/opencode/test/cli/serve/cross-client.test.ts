import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { cliIt } from "../../lib/cli-process"
import path from "node:path"
import { mkdir } from "node:fs/promises"

const Session = Schema.Struct({ id: Schema.String, directory: Schema.String })
const Event = Schema.Struct({
  directory: Schema.optional(Schema.String),
  payload: Schema.Struct({
    type: Schema.String,
    properties: Schema.Record(Schema.String, Schema.Any),
  }),
})
const Messages = Schema.Array(
  Schema.Struct({
    info: Schema.Struct({ id: Schema.String, role: Schema.String }),
    parts: Schema.Array(Schema.Record(Schema.String, Schema.Any)),
  }),
)
const Permissions = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    sessionID: Schema.String,
    permission: Schema.String,
  }),
)
const Health = Schema.Struct({ databaseID: Schema.String })

function request(url: string, directory: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return fetch(new URL(path, url), { ...init, headers })
}

async function openGlobalEvents(url: string, directory: string) {
  const controller = new AbortController()
  const response = await request(url, directory, "/global/event", { signal: controller.signal })
  if (!response.ok || !response.body) throw new Error(`global event stream failed: HTTP ${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  const next = async () => {
    while (true) {
      const newline = buffer.indexOf("\n")
      if (newline >= 0) {
        const line = buffer.slice(0, newline).trimEnd()
        buffer = buffer.slice(newline + 1)
        if (line.startsWith("data:")) return Schema.decodeUnknownSync(Event)(JSON.parse(line.slice(5).trimStart()))
        continue
      }
      const chunk = await reader.read()
      if (chunk.done) throw new Error("global event stream closed")
      buffer += decoder.decode(chunk.value, { stream: true })
    }
  }

  return {
    next,
    close: async () => {
      controller.abort()
      await reader.cancel().catch(() => undefined)
    },
  }
}

async function matchingEvent(
  events: Awaited<ReturnType<typeof openGlobalEvents>>,
  predicate: (event: typeof Event.Type) => boolean,
) {
  while (true) {
    const event = await events.next()
    if (predicate(event)) return event
  }
}

function messageTexts(messages: typeof Messages.Type) {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : [])),
  )
}

async function eventsUntil(
  events: Awaited<ReturnType<typeof openGlobalEvents>>,
  predicate: (event: typeof Event.Type) => boolean,
) {
  const received: Array<typeof Event.Type> = []
  while (true) {
    const event = await events.next()
    received.push(event)
    if (predicate(event)) return received
  }
}

describe("canonical serve cross-client contract", () => {
  cliIt.live(
    "delivers live prompts once and converges after a disconnected gap",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve()
        yield* Effect.tryPromise(async () => {
          const directory = path.join(home, "routed-workspace")
          await mkdir(directory)
          const created = await request(server.url, directory, "/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "cross-client e2e" }),
          })
          expect(created.status).toBe(200)
          const session = Schema.decodeUnknownSync(Session)(await created.json())

          const events = await openGlobalEvents(server.url, directory)
          expect(await events.next()).toMatchObject({ payload: { type: "server.connected" } })

          const liveText = "live mobile-like prompt"
          const livePrompt = await request(server.url, directory, `/session/${session.id}/prompt_async`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messageID: "msg_cross_client_live",
              agent: "build",
              noReply: true,
              parts: [{ type: "text", text: liveText }],
            }),
          })
          expect(livePrompt.status).toBe(204)
          const sentinelTitle = "live delivery observed"
          const sentinel = await request(server.url, directory, `/session/${session.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: sentinelTitle }),
          })
          expect(sentinel.status).toBe(200)
          const delivered = await eventsUntil(
            events,
            (event) =>
              event.payload.type === "session.updated" &&
              JSON.stringify(event.payload.properties).includes(sentinelTitle),
          )
          const liveEvents = delivered.filter(
            (event) =>
              event.payload.type === "message.part.updated" &&
              JSON.stringify(event.payload.properties).includes(liveText),
          )
          expect(liveEvents).toHaveLength(1)
          expect(liveEvents[0]).toMatchObject({
            payload: {
              type: "message.part.updated",
              properties: { part: { sessionID: session.id, text: liveText } },
            },
          })
          await events.close()

          const missedText = "prompt sent while mobile-like client is disconnected"
          const missedPrompt = await request(server.url, directory, `/session/${session.id}/prompt_async`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messageID: "msg_cross_client_missed",
              agent: "build",
              noReply: true,
              parts: [{ type: "text", text: missedText }],
            }),
          })
          expect(missedPrompt.status).toBe(204)

          const reconnected = await openGlobalEvents(server.url, directory)
          expect(await reconnected.next()).toMatchObject({ payload: { type: "server.connected" } })
          const response = await request(server.url, directory, `/session/${session.id}/message`)
          expect(response.status).toBe(200)
          const texts = messageTexts(Schema.decodeUnknownSync(Messages)(await response.json()))
          expect(texts.filter((text) => text === liveText)).toHaveLength(1)
          expect(texts.filter((text) => text === missedText)).toHaveLength(1)
          await reconnected.close()
        })
      }),
    90_000,
  )

  cliIt.live(
    "recovers a pending permission after the event subscriber disconnects",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.tool("bash", { command: "pwd", description: "Show working directory" })
        const server = yield* opencode.serve()
        yield* Effect.tryPromise(async () => {
          const created = await request(server.url, home, "/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: "permission recovery e2e",
              permission: [{ permission: "bash", pattern: "*", action: "ask" }],
            }),
          })
          expect(created.status).toBe(200)
          const session = Schema.decodeUnknownSync(Session)(await created.json())
          const events = await openGlobalEvents(server.url, home)
          expect(await events.next()).toMatchObject({ payload: { type: "server.connected" } })

          const prompt = await request(server.url, home, `/session/${session.id}/prompt_async`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messageID: "msg_cross_client_permission",
              agent: "build",
              model: { providerID: "test", modelID: "test-model" },
              parts: [{ type: "text", text: "run pwd" }],
            }),
          })
          expect(prompt.status).toBe(204)
          const asked = await matchingEvent(events, (event) => event.payload.type === "permission.asked")
          expect(asked).toMatchObject({
            payload: {
              type: "permission.asked",
              properties: { sessionID: session.id, permission: "bash" },
            },
          })
          await events.close()

          const pendingResponse = await request(server.url, home, "/permission")
          expect(pendingResponse.status).toBe(200)
          const pending = Schema.decodeUnknownSync(Permissions)(await pendingResponse.json())
          expect(pending).toHaveLength(1)
          expect(pending[0]).toMatchObject({ sessionID: session.id, permission: "bash" })

          const reply = await request(server.url, home, `/permission/${pending[0].id}/reply`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reply: "reject" }),
          })
          expect(reply.status).toBe(200)
          expect(await reply.json()).toBe(true)

          const settledResponse = await request(server.url, home, "/permission")
          expect(Schema.decodeUnknownSync(Permissions)(await settledResponse.json())).toHaveLength(0)
        })
      }),
    90_000,
  )

  cliIt.live(
    "preserves transcript and reconciles pending permission across backend restart",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.tool("bash", { command: "pwd", description: "Show working directory" })
        const env = { OPENCODE_DB: path.join(home, "restart.db") }
        const first = yield* opencode.serve({ env })
        const state = yield* Effect.tryPromise(async () => {
          const firstHealth = Schema.decodeUnknownSync(Health)(
            await (await fetch(new URL("/global/health", first.url))).json(),
          )
          const created = await request(first.url, home, "/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: "restart recovery e2e",
              permission: [{ permission: "bash", pattern: "*", action: "ask" }],
            }),
          })
          const session = Schema.decodeUnknownSync(Session)(await created.json())
          const events = await openGlobalEvents(first.url, home)
          expect(await events.next()).toMatchObject({ payload: { type: "server.connected" } })
          const text = "persist this prompt across restart"
          const prompt = await request(first.url, home, `/session/${session.id}/prompt_async`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messageID: "msg_cross_client_restart",
              agent: "build",
              model: { providerID: "test", modelID: "test-model" },
              parts: [{ type: "text", text }],
            }),
          })
          expect(prompt.status).toBe(204)
          const asked = await matchingEvent(events, (event) => event.payload.type === "permission.asked")
          await events.close()
          return {
            sessionID: session.id,
            directory: session.directory,
            databaseID: firstHealth.databaseID,
            permissionID: String(asked.payload.properties.id),
            text,
          }
        })

        first.kill()
        yield* Effect.promise(() => first.exited)
        const second = yield* opencode.serve({ env })
        yield* Effect.tryPromise(async () => {
          const health = await fetch(new URL("/global/health", second.url))
          expect(health.status).toBe(200)
          expect(Schema.decodeUnknownSync(Health)(await health.json()).databaseID).toBe(state.databaseID)

          const messagesResponse = await request(second.url, state.directory, `/session/${state.sessionID}/message`)
          if (messagesResponse.status !== 200) {
            const listed = await request(second.url, state.directory, "/session?roots=true")
            throw new Error(
              `restarted session request failed: HTTP ${messagesResponse.status} ${await messagesResponse.text()}; sessions=${await listed.text()}`,
            )
          }
          const texts = messageTexts(Schema.decodeUnknownSync(Messages)(await messagesResponse.json()))
          expect(texts.filter((text) => text === state.text)).toHaveLength(1)

          const pendingResponse = await request(second.url, state.directory, "/permission")
          expect(pendingResponse.status).toBe(200)
          const pending = Schema.decodeUnknownSync(Permissions)(await pendingResponse.json())
          // POSIX SIGTERM runs graceful instance disposal, which rejects pending
          // interactions. Windows process termination is abrupt, so the durable
          // request remains available for successor recovery.
          if (process.platform !== "win32") {
            expect(pending).toHaveLength(0)
            return
          }
          expect(pending).toContainEqual({
            id: state.permissionID,
            sessionID: state.sessionID,
            permission: "bash",
          })
          const reply = await request(second.url, state.directory, `/permission/${state.permissionID}/reply`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reply: "reject" }),
          })
          expect(reply.status).toBe(200)
        })
      }),
    90_000,
  )
})

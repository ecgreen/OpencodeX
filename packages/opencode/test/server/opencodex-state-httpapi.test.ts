import { afterEach, describe, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import {
  OpencodeXJobTable,
  OpencodeXProjectSessionTable,
  OpencodeXSessionStateTable,
  OpencodeXViewSessionTable,
  OpencodeXViewTable,
} from "@opencode-ai/core/opencodex/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionID } from "../../src/session/schema"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { HttpServer } from "effect/unstable/http"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { disposeAllInstances, tmpdirScoped } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"
import { httpApiLayer } from "./httpapi-layer"
import { makeReader as makeSessionCardReader, MAX_RETAINED_IDS } from "../../src/opencodex/session-card"
import { AUTHORITY_EPOCH } from "../../src/opencodex/state-epoch"

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
  it.live("rejects stale reviewed-file replacements while merging timestamps", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true, config: { formatter: false, lsp: false } })
      const server = yield* HttpServer.HttpServer
      const base = HttpServer.formatAddress(server.address)
      const request = (path: string, init: RequestInit = {}) => {
        const headers = new Headers(init.headers)
        headers.set("x-opencode-directory", directory)
        if (init.body) headers.set("content-type", "application/json")
        return fetch(new URL(path, base), { ...init, headers })
      }
      const created = record(
        yield* Effect.promise(() =>
          request("/session", { method: "POST", body: JSON.stringify({ title: "review state" }) }).then((response) =>
            response.json(),
          ),
        ),
      )
      const sessionID = String(created.id)
      const initial = yield* Effect.promise(() =>
        request(`/experimental/opencodex/session-state/${sessionID}`, {
          method: "PATCH",
          body: JSON.stringify({ reviewedFiles: ["base.ts"], expectedReviewedFiles: [] }),
        }),
      )
      expect(initial.status).toBe(200)
      const responses = yield* Effect.promise(() =>
        Promise.all([
          request(`/experimental/opencodex/session-state/${sessionID}`, {
            method: "PATCH",
            body: JSON.stringify({ seenAt: 10 }),
          }),
          request(`/experimental/opencodex/session-state/${sessionID}`, {
            method: "PATCH",
            body: JSON.stringify({ reviewedFiles: ["first.ts"], expectedReviewedFiles: ["base.ts"] }),
          }),
          request(`/experimental/opencodex/session-state/${sessionID}`, {
            method: "PATCH",
            body: JSON.stringify({ reviewedFiles: ["second.ts"], expectedReviewedFiles: ["base.ts"] }),
          }),
        ]),
      )
      expect(responses.map((response) => response.status).toSorted()).toEqual([200, 200, 409])
      const snapshot = record(
        yield* Effect.promise(() =>
          request("/experimental/opencodex/state").then((response) => response.json()),
        ),
      )
      const state = record(record(record(record(snapshot).payloads).catalog).sessionUiState)[sessionID]
      expect(record(state).seenAt).toBe(10)
      expect([["first.ts"], ["second.ts"]]).toContainEqual(record(state).reviewedFiles)
    }),
  )

  it.live("rejects a stale concurrent view replacement", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true, config: { formatter: false, lsp: false } })
      const server = yield* HttpServer.HttpServer
      const base = HttpServer.formatAddress(server.address)
      const request = (path: string, init: RequestInit = {}) => {
        const headers = new Headers(init.headers)
        headers.set("x-opencode-directory", directory)
        if (init.body) headers.set("content-type", "application/json")
        return fetch(new URL(path, base), { ...init, headers })
      }
      const sessions = yield* Effect.promise(() =>
        Promise.all(
          ["left", "right"].map((title) =>
            request("/session", { method: "POST", body: JSON.stringify({ title }) }).then((response) =>
              response.json(),
            ),
          ),
        ),
      )
      const sessionIDs = sessions.map((item) => String(record(item).id))
      const view = record(
        yield* Effect.promise(() =>
          request("/experimental/opencodex/view", {
            method: "POST",
            body: JSON.stringify({ title: "original", sessionIDs: [sessionIDs[0]] }),
          }).then((response) => response.json()),
        ),
      )
      const responses = yield* Effect.promise(() =>
        Promise.all(
          [
            { title: "first", sessionIDs, focusedSessionID: sessionIDs[0] },
            { title: "second", sessionIDs: [sessionIDs[1]], focusedSessionID: sessionIDs[1] },
          ].map((update) =>
            request(`/experimental/opencodex/view/${String(view.id)}`, {
              method: "PATCH",
              body: JSON.stringify({ ...update, expectedTimeUpdated: Number(view.timeUpdated) }),
            }),
          ),
        ),
      )
      expect(responses.map((response) => response.status).toSorted()).toEqual([200, 409])
      const successful = responses.find((response) => response.ok)
      if (!successful) return yield* Effect.die(new Error("Concurrent view update had no winner"))
      const winner = record(yield* Effect.promise(() => successful.json()))
      const current = record(
        yield* Effect.promise(() =>
          request(`/experimental/opencodex/view/${String(view.id)}`).then((response) => response.json()),
        ),
      )
      expect(current.title).toBe(winner.title)
      expect(current.sessionIDs).toEqual(winner.sessionIDs)
      const { db } = yield* Database.Service
      const persisted = yield* db
        .select({ focusedSessionID: OpencodeXViewTable.focused_session_id })
        .from(OpencodeXViewTable)
        .where(eq(OpencodeXViewTable.id, String(view.id)))
        .get()
        .pipe(Effect.orDie)
      const assignments = yield* db
        .select({ sessionID: OpencodeXViewSessionTable.session_id })
        .from(OpencodeXViewSessionTable)
        .where(eq(OpencodeXViewSessionTable.view_id, String(view.id)))
        .all()
        .pipe(Effect.orDie)
      expect(assignments.map((item) => String(item.sessionID))).toContain(String(persisted?.focusedSessionID))
    }),
  )

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
      expect(operations).toContain("opencodex.state.operations")
      expect(operations).toContain("opencodex.state.capabilities")
      expect(operations).toContain("opencodex.state.session_cards")
      expect(operations).toContain("opencodex.state.session")
      expect(operations).toContain("opencodex.state.event")
      expect(operations).toContain("opencodex.terminal_session.create")
      expect(operations).toContain("opencodex.terminal_session.opened")
      const schemas = record(record(doc).components).schemas
      for (const name of [
        "OpencodeXStateScope",
        "OpencodeXStateCursor",
        "OpencodeXStateSnapshot",
        "OpencodeXOperationsSnapshot",
        "OpencodeXCapabilitiesSnapshot",
        "OpencodeXSessionSnapshot",
        "OpencodeXSessionCardPage",
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
      const createdTerminal = record(
        yield* Effect.promise(() =>
          request(firstDirectory, "/experimental/opencodex/terminal-session", {
            method: "POST",
            body: JSON.stringify({
              title: "Claude state test",
              directory: firstDirectory,
              installationID: crypto.randomUUID(),
            }),
          }).then((response) => response.json()),
        ),
      )
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
      expect(snapshot.epoch).toBe(AUTHORITY_EPOCH)
      expect(typeof record(snapshot.scope).projectID).toBe("string")
      expect(typeof snapshot.cursor).toBe("string")
      expect(typeof record(record(snapshot.domains).catalog).digest).toBe("string")
      expect(Array.isArray(record(record(record(snapshot.payloads).catalog).sessionCards).items)).toBe(true)
      expect(
        (record(record(snapshot.payloads).catalog).terminalSessions as unknown[])
          .map(record)
          .find((item) => item.id === createdTerminal.id),
      ).toMatchObject({ title: "Claude state test", directory: firstDirectory })
      expect(record(record(record(snapshot.payloads).catalog).sessionUiState)[sessionID]).toMatchObject({
        seenAt: 10,
        reviewedFiles: ["src/app.tsx"],
      })
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ title: "manual refresh title" })
        .where(eq(SessionTable.id, SessionID.make(sessionID)))
        .run()
        .pipe(Effect.orDie)
      const manuallyRefreshed = record(
        yield* Effect.promise(() =>
          request(firstDirectory, "/experimental/opencodex/state").then((response) => response.json()),
        ),
      )
      expect(record(record(manuallyRefreshed.domains).catalog).revision).toBe(
        record(record(snapshot.domains).catalog).revision,
      )
      expect(record(record(manuallyRefreshed.domains).catalog).digest).not.toBe(
        record(record(snapshot.domains).catalog).digest,
      )
      expect(
        (record(record(record(manuallyRefreshed.payloads).catalog).sessionCards).items as unknown[])
          .map(record)
          .find((item) => item.id === sessionID)?.title,
      ).toBe("manual refresh title")

      const capabilities = record(
        yield* Effect.promise(() =>
          request(firstDirectory, "/experimental/opencodex/state/capabilities").then((response) => response.json()),
        ),
      )
      expect(capabilities.scope).toEqual(snapshot.scope)
      expect(capabilities.epoch).toBe(AUTHORITY_EPOCH)
      expect(capabilities.revision).toBe(capabilities.digest)
      expect(typeof capabilities.revision).toBe("string")
      expect(Array.isArray(record(record(capabilities.payload).provider).all)).toBe(true)
      expect(Array.isArray(record(capabilities.payload).agents)).toBe(true)
      expect(Array.isArray(record(capabilities.payload).commands)).toBe(true)
      expect(Array.isArray(record(capabilities.payload).lsp)).toBe(true)
      expect(Array.isArray(record(capabilities.payload).formatter)).toBe(true)
      expect(Array.isArray(record(capabilities.payload).plugins)).toBe(true)
      expect(record(capabilities.payload).mcp).toEqual({})
      expect(record(capabilities.payload).mcpResources).toEqual({})

      const session = record(
        yield* Effect.promise(() =>
          request(firstDirectory, `/experimental/opencodex/state/session/${sessionID}`).then((response) =>
            response.json(),
          ),
        ),
      )
      expect(record(session.session).id).toBe(sessionID)
      expect(session.epoch).toBe(AUTHORITY_EPOCH)
      expect(Array.isArray(record(session.messages).items)).toBe(true)
      expect(record(session.messages).coverage).toEqual({})
      expect(typeof record(record(session.messages).boundary).hasMore).toBe("boolean")
      expect(Array.isArray(session.todos)).toBe(true)
      expect(Array.isArray(session.diff)).toBe(true)
      expect(Array.isArray(record(session.pendingInteractions).permissions)).toBe(true)
      expect(Array.isArray(record(session.pendingInteractions).questions)).toBe(true)
      expect(session.cursor).toBe(snapshot.cursor)

      const cards = record(
        yield* Effect.promise(() =>
          request(
            firstDirectory,
            `/experimental/opencodex/state/session-card?ids=${encodeURIComponent(sessionID)}`,
          ).then((response) => response.json()),
        ),
      )
      expect(Array.isArray(cards.items) && cards.items.map((item) => record(item).id)).toEqual([sessionID])
      expect(cards.missing).toEqual([])
      expect(record(cards.sessionUiState)[sessionID]).toMatchObject({
        sessionID,
        seenAt: 10,
        reviewedFiles: ["src/app.tsx"],
      })
      const malformedCardCursor = yield* Effect.promise(() =>
        request(firstDirectory, "/experimental/opencodex/state/session-card?cursor=malformed").then(
          (response) => response.status,
        ),
      )
      expect(malformedCardCursor).toBe(400)

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
      expect(ready.epoch).toBe(AUTHORITY_EPOCH)

      yield* Effect.promise(() =>
        request(firstDirectory, `/session/${sessionID}`, {
          method: "PATCH",
          body: JSON.stringify({ title: "updated" }),
        }),
      )
      const live = record(yield* Effect.promise(() => events.next()))
      expect(live.type).toBe("event")
      expect(record(live.event).epoch).toBe(AUTHORITY_EPOCH)
      expect(record(live.event).scope).toEqual(snapshot.scope)
      expect(record(live.event).domain).toBe("catalog")
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
      yield* Effect.promise(() =>
        request(firstDirectory, `/experimental/opencodex/terminal-session/${createdTerminal.id}`, {
          method: "PATCH",
          body: JSON.stringify({ expectedTimeUpdated: createdTerminal.timeUpdated, title: "Claude renamed" }),
        }),
      )
      const terminalLive = record(yield* Effect.promise(() => events.next()))
      expect(record(terminalLive.event).domain).toBe("catalog")
      expect(record(record(terminalLive.event).payload).aggregateID).toBe(createdTerminal.id)
      expect(record(record(terminalLive.event).payload).eventType).toBe("opencodex.terminal_session.updated")
      const beforeJob = record(
        yield* Effect.promise(() =>
          request(firstDirectory, "/experimental/opencodex/state").then((value) => value.json()),
        ),
      )

      const createdJob = record(
        yield* Effect.promise(() =>
          request(firstDirectory, "/experimental/opencodex/job", {
            method: "POST",
            body: JSON.stringify({ kind: "test.atomic", idempotencyKey: `atomic-${sessionID}` }),
          }).then((value) => value.json()),
        ),
      )
      const jobLive = record(yield* Effect.promise(() => events.next()))
      expect(record(jobLive.event).domain).toBe("operations")
      expect(record(record(jobLive.event).payload).aggregateID).toBe(createdJob.id)
      expect(record(record(jobLive.event).payload).eventType).toBe("opencodex.job.created")
      const afterJob = record(
        yield* Effect.promise(() =>
          request(firstDirectory, "/experimental/opencodex/state").then((value) => value.json()),
        ),
      )
      const operationJobs = record(record(afterJob.payloads).operations).jobs
      expect(Array.isArray(operationJobs) && operationJobs.some((job) => record(job).id === createdJob.id)).toBe(true)
      expect(record(record(afterJob.domains).catalog).revision).toBe(record(record(beforeJob.domains).catalog).revision)
      expect(record(record(afterJob.domains).operations).revision).not.toBe(
        record(record(beforeJob.domains).operations).revision,
      )
      const operationSnapshot = record(
        yield* Effect.promise(() =>
          request(firstDirectory, "/experimental/opencodex/state/operations").then((value) => value.json()),
        ),
      )
      expect(operationSnapshot.scope).toEqual(snapshot.scope)
      expect(operationSnapshot.revision).not.toBe(operationSnapshot.digest)
      expect(typeof operationSnapshot.cursor).toBe("string")
      const operationSnapshotJobs = record(operationSnapshot.payload).jobs
      expect(
        Array.isArray(operationSnapshotJobs) && operationSnapshotJobs.some((job) => record(job).id === createdJob.id),
      ).toBe(true)
      yield* db
        .update(OpencodeXJobTable)
        .set({ title: "manually refreshed operation" })
        .where(eq(OpencodeXJobTable.id, String(createdJob.id)))
        .run()
        .pipe(Effect.orDie)
      const manuallyRefreshedOperations = record(
        yield* Effect.promise(() =>
          request(firstDirectory, "/experimental/opencodex/state/operations").then((value) => value.json()),
        ),
      )
      expect(manuallyRefreshedOperations.revision).toBe(operationSnapshot.revision)
      expect(manuallyRefreshedOperations.digest).not.toBe(operationSnapshot.digest)
      expect(
        (record(manuallyRefreshedOperations.payload).jobs as unknown[])
          .map(record)
          .find((job) => job.id === createdJob.id)?.title,
      ).toBe("manually refreshed operation")
      const second = yield* Effect.promise(() =>
        request(secondDirectory, "/session", { method: "POST", body: JSON.stringify({ title: "isolated" }) }).then(
          (value) => value.json(),
        ),
      )
      const crossDirectoryCreated = record(yield* Effect.promise(() => events.next()))
      expect(record(crossDirectoryCreated.event).visibility).toBe("global")
      expect(record(crossDirectoryCreated.event).scope).toEqual(snapshot.scope)
      expect(record(record(crossDirectoryCreated.event).payload).aggregateID).toBe(String(record(second).id))
      const [firstGlobalSnapshot, secondGlobalSnapshot] = yield* Effect.promise(() =>
        Promise.all(
          [firstDirectory, secondDirectory].map((directory) =>
            request(directory, "/experimental/opencodex/state").then((response) => response.json()),
          ),
        ),
      )
      expect(record(record(record(firstGlobalSnapshot).domains).catalog).digest).toBe(
        record(record(record(secondGlobalSnapshot).domains).catalog).digest,
      )
      yield* Effect.promise(() =>
        request(secondDirectory, `/session/${String(record(second).id)}`, {
          method: "PATCH",
          body: JSON.stringify({ title: "isolated update" }),
        }),
      )
      const crossDirectoryUpdated = record(yield* Effect.promise(() => events.next()))
      expect(record(crossDirectoryUpdated.event).visibility).toBe("global")
      expect(record(record(crossDirectoryUpdated.event).payload).eventType).toBe("session.updated")
      controller.abort()

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
          `/experimental/opencodex/state/event?after=${encodeURIComponent(String(record(jobLive.event).cursor))}`,
          { signal: replayController.signal },
        ),
      )
      const replay = stream(replayResponse)
      yield* Effect.addFinalizer(() => Effect.sync(() => replayController.abort()))
      expect(record(yield* Effect.promise(() => replay.next())).type).toBe("ready")
      const replayed = yield* Effect.promise(() => Promise.all([replay.next(), replay.next(), replay.next()]))
      const replayedEvents = replayed.map(record).map((frame) => record(frame.event))
      expect(replayedEvents.map((event) => record(event.scope).directory)).toEqual([
        firstDirectory,
        firstDirectory,
        firstDirectory,
      ])
      expect(replayedEvents.map((event) => record(event.payload).aggregateID)).toEqual([
        String(record(second).id),
        String(record(second).id),
        sessionID,
      ])
      expect(Number(replayedEvents[2]?.aggregateSequence)).toBe(Number(record(live.event).aggregateSequence) + 1)
      replayController.abort()

      const headerController = new AbortController()
      const headerReplay = stream(
        yield* Effect.promise(() =>
          request(firstDirectory, "/experimental/opencodex/state/event", {
            signal: headerController.signal,
            headers: { "last-event-id": String(record(jobLive.event).cursor) },
          }),
        ),
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => headerController.abort()))
      expect(record(yield* Effect.promise(() => headerReplay.next())).type).toBe("ready")
      expect(
        record(record(yield* Effect.promise(() => headerReplay.next())).event).cursor,
      ).toBe(record(replayedEvents[0]).cursor)
      headerController.abort()

      const resetController = new AbortController()
      const reset = stream(
        yield* Effect.promise(() =>
          request(firstDirectory, "/experimental/opencodex/state/event?after=invalid", {
            signal: resetController.signal,
            headers: { "last-event-id": String(record(jobLive.event).cursor) },
          }),
        ),
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => resetController.abort()))
      expect(record(yield* Effect.promise(() => reset.next())).type).toBe("ready")
      expect(record(yield* Effect.promise(() => reset.next())).type).toBe("reset_required")
      resetController.abort()
    }),
  )

  it.live("hands replay off to live delivery without dropping or duplicating an event", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true, config: { formatter: false, lsp: false } })
      const server = yield* HttpServer.HttpServer
      const base = HttpServer.formatAddress(server.address)
      const request = (path: string, init: RequestInit = {}) => {
        const headers = new Headers(init.headers)
        headers.set("x-opencode-directory", directory)
        if (init.body) headers.set("content-type", "application/json")
        return fetch(new URL(path, base), { ...init, headers })
      }
      const created = record(
        yield* Effect.promise(() =>
          request("/session", { method: "POST", body: JSON.stringify({ title: "handoff" }) }).then((response) =>
            response.json(),
          ),
        ),
      )
      const sessionID = String(created.id)
      const snapshot = record(
        yield* Effect.promise(() => request("/experimental/opencodex/state").then((response) => response.json())),
      )
      const controller = new AbortController()
      yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()))
      const [response] = yield* Effect.promise(() =>
        Promise.all([
          request(`/experimental/opencodex/state/event?after=${encodeURIComponent(String(snapshot.cursor))}`, {
            signal: controller.signal,
          }),
          request(`/session/${sessionID}`, {
            method: "PATCH",
            body: JSON.stringify({ title: "during handoff" }),
          }),
        ]),
      )
      const events = stream(response)
      expect(record(yield* Effect.promise(() => events.next())).type).toBe("ready")
      const first = record(record(yield* Effect.promise(() => events.next())).event)
      expect(first.visibility).toBe("global")
      expect(record(first.payload).aggregateID).toBe(sessionID)

      yield* Effect.promise(() =>
        request(`/session/${sessionID}`, {
          method: "PATCH",
          body: JSON.stringify({ title: "after handoff" }),
        }),
      )
      const second = record(record(yield* Effect.promise(() => events.next())).event)
      expect(second.id).not.toBe(first.id)
      expect(Number(second.position)).toBeGreaterThan(Number(first.position))
      expect(Number(second.aggregateSequence)).toBe(Number(first.aggregateSequence) + 1)
      controller.abort()
    }),
  )

  it.live("pages more than 5,000 cards with stable ties and retains old assignment IDs", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true, config: { formatter: false, lsp: false } })
      const server = yield* HttpServer.HttpServer
      const base = HttpServer.formatAddress(server.address)
      const request = (path: string, init: RequestInit = {}) => {
        const headers = new Headers(init.headers)
        headers.set("x-opencode-directory", directory)
        if (init.body) headers.set("content-type", "application/json")
        return fetch(new URL(path, base), { ...init, headers })
      }
      const created = record(
        yield* Effect.promise(() =>
          request("/session", { method: "POST", body: JSON.stringify({ title: "pagination anchor" }) }).then(
            (response) => response.json(),
          ),
        ),
      )
      const { db } = yield* Database.Service
      const source = yield* db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, SessionID.make(String(created.id))))
        .get()
        .pipe(Effect.orDie)
      if (!source) return yield* Effect.die("pagination fixture session was not persisted")
      const ids = Array.from({ length: 5_001 }, (_, index) => SessionID.make(`ses_card_${String(index).padStart(5, "0")}`))
      yield* Effect.forEach(
        Array.from({ length: Math.ceil(ids.length / 200) }, (_, index) => ids.slice(index * 200, (index + 1) * 200)),
        (chunk) =>
          db
            .insert(SessionTable)
            .values(
              chunk.map((id) => ({
                ...source,
                id,
                slug: id,
                title: id,
                metadata: null,
                time_created: 1_000,
                time_updated: 1_000,
              })),
            )
            .run()
            .pipe(Effect.orDie),
        { discard: true },
      )

      const reviewedID = ids.at(-1)
      const retainedUnseenID = ids.at(-150)
      if (!reviewedID || !retainedUnseenID) return yield* Effect.die("pagination fixture IDs were not created")
      yield* db
        .insert(OpencodeXSessionStateTable)
        .values({
          session_id: reviewedID,
          seen_at: 1_001,
          reviewed_at: 1_001,
          reviewed_files: [],
          time_created: 1_001,
          time_updated: 1_001,
        })
        .run()
        .pipe(Effect.orDie)

      const cardReader = makeSessionCardReader(db)
      const recent = yield* cardReader.page()
      const unseenReviewIDs = yield* cardReader.unseenReviewIDs()
      expect(unseenReviewIDs).toHaveLength(MAX_RETAINED_IDS)
      expect(unseenReviewIDs).not.toContain(reviewedID)
      expect(recent.items.map((item) => item.id)).not.toContain(retainedUnseenID)
      expect(unseenReviewIDs).toContain(retainedUnseenID)
      const bounded = yield* cardReader.initial(ids)
      const expectedInitialIDs = new Set([
        ...ids.slice(0, MAX_RETAINED_IDS),
        ...recent.items.map((item) => item.id),
      ])
      expect(bounded.items).toHaveLength(expectedInitialIDs.size)
      expect(new Set(bounded.items.map((item) => item.id))).toEqual(expectedInitialIDs)

      const root = record(
        yield* Effect.promise(() =>
          request("/experimental/opencodex/state").then((response) => response.json()),
        ),
      )
      const initialCards = record(record(record(root.payloads).catalog).sessionCards)
      expect(Array.isArray(initialCards.items) ? initialCards.items.length : 0).toBe(MAX_RETAINED_IDS + 1)
      expect(initialCards.hasMore).toBe(true)

      const pagination = yield* Effect.promise(async () => {
        const collect = async (cursor?: string, pageIDs: string[] = []): Promise<{ pageIDs: string[]; terminal: Record<string, unknown> }> => {
          const page = record(
            await request(
              `/experimental/opencodex/state/session-card?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
            ).then((response) => response.json()),
          )
          const nextIDs = [
            ...pageIDs,
            ...(Array.isArray(page.items) ? page.items.map((item) => String(record(item).id)) : []),
          ]
          if (page.hasMore) return collect(String(page.next), nextIDs)
          return { pageIDs: nextIDs, terminal: page }
        }
        return collect()
      })
      const pageIDs = pagination.pageIDs
      expect(pageIDs).toHaveLength(ids.length + 1)
      expect(new Set(pageIDs).size).toBe(pageIDs.length)
      expect(pageIDs.slice(1)).toEqual(pageIDs.slice(1).toSorted((left, right) => right.localeCompare(left)))
      expect(pagination.terminal.hasMore).toBe(false)
      expect(pagination.terminal.next).toBeUndefined()

      const oldID = ids[0]
      const retained = record(
        yield* Effect.promise(() =>
          request(`/experimental/opencodex/state/session-card?ids=${encodeURIComponent(oldID)}`).then((response) =>
            response.json(),
          ),
        ),
      )
      expect(Array.isArray(retained.items) && retained.items.map((item) => record(item).id)).toEqual([oldID])

      const overlay = record(
        yield* Effect.promise(() =>
          request("/experimental/opencodex/project", {
            method: "POST",
            body: JSON.stringify({ name: "Paged", folders: [directory] }),
          }).then((response) => response.json()),
        ),
      )
      yield* db
        .insert(OpencodeXProjectSessionTable)
        .values({
          session_id: oldID,
          opencodex_project_id: String(overlay.id),
          path: directory,
          time_created: 1_000,
          time_updated: 1_000,
        })
        .run()
        .pipe(Effect.orDie)
      const associated = record(
        yield* Effect.promise(() =>
          request("/experimental/opencodex/state").then((response) => response.json()),
        ),
      )
      const project = (record(record(associated.payloads).catalog).projects as unknown[])
        .map(record)
        .find((item) => item.id === overlay.id)
      expect(project?.sessionIDs).toContain(oldID)
      expect(
        (record(record(record(associated.payloads).catalog).sessionCards).items as unknown[])
          .map(record)
          .some((item) => item.id === oldID),
      ).toBe(false)

      const createdView = record(
        yield* Effect.promise(() =>
          request("/experimental/opencodex/view", {
            method: "POST",
            body: JSON.stringify({ title: "Paged view", sessionIDs: [oldID] }),
          }).then((response) => response.json()),
        ),
      )
      const withView = record(
        yield* Effect.promise(() => request("/experimental/opencodex/state").then((response) => response.json())),
      )
      const catalog = record(record(withView.payloads).catalog)
      expect((catalog.views as unknown[]).map(record).find((item) => item.id === createdView.id)?.sessionIDs).toContain(oldID)

      yield* db.update(SessionTable).set({ time_archived: 2_000 }).where(eq(SessionTable.id, oldID)).run().pipe(Effect.orDie)
      const archived = record(
        yield* Effect.promise(() => request("/experimental/opencodex/state").then((response) => response.json())),
      )
      const archivedCatalog = record(record(archived.payloads).catalog)
      expect((archivedCatalog.projects as unknown[]).map(record).find((item) => item.id === overlay.id)?.sessionIDs).not.toContain(oldID)
      expect((archivedCatalog.views as unknown[]).map(record).find((item) => item.id === createdView.id)?.sessionIDs).not.toContain(oldID)
      const archivedExact = record(
        yield* Effect.promise(() =>
          request(`/experimental/opencodex/state/session-card?ids=${encodeURIComponent(oldID)}`).then((response) =>
            response.json(),
          ),
        ),
      )
      expect(archivedExact.missing).toEqual([oldID])
      expect(yield* db.select().from(OpencodeXProjectSessionTable).where(eq(OpencodeXProjectSessionTable.session_id, oldID)).get().pipe(Effect.orDie)).toBeDefined()
      expect(yield* db.select().from(OpencodeXViewSessionTable).where(eq(OpencodeXViewSessionTable.session_id, oldID)).get().pipe(Effect.orDie)).toBeDefined()

      yield* db
        .update(SessionTable)
        .set({ time_archived: null, metadata: { opencodex: { swarmID: "swarm-1" } } })
        .where(eq(SessionTable.id, oldID))
        .run()
        .pipe(Effect.orDie)
      const swarm = record(
        yield* Effect.promise(() => request("/experimental/opencodex/state").then((response) => response.json())),
      )
      const swarmCatalog = record(record(swarm.payloads).catalog)
      expect((swarmCatalog.projects as unknown[]).map(record).find((item) => item.id === overlay.id)?.sessionIDs).not.toContain(oldID)
      expect((swarmCatalog.views as unknown[]).map(record).find((item) => item.id === createdView.id)?.sessionIDs).not.toContain(oldID)

      yield* db.update(SessionTable).set({ metadata: null }).where(eq(SessionTable.id, oldID)).run().pipe(Effect.orDie)
      const restored = record(
        yield* Effect.promise(() => request("/experimental/opencodex/state").then((response) => response.json())),
      )
      const restoredCatalog = record(record(restored.payloads).catalog)
      expect((restoredCatalog.projects as unknown[]).map(record).find((item) => item.id === overlay.id)?.sessionIDs).toContain(oldID)
      expect((restoredCatalog.views as unknown[]).map(record).find((item) => item.id === createdView.id)?.sessionIDs).toContain(oldID)
    }),
  )
})

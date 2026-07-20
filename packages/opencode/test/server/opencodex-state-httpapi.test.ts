import { afterEach, describe, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { OpencodeXProjectSessionTable, OpencodeXSessionStateTable, OpencodeXViewSessionTable } from "@opencode-ai/core/opencodex/sql"
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
      expect(operations).toContain("opencodex.state.operations")
      expect(operations).toContain("opencodex.state.capabilities")
      expect(operations).toContain("opencodex.state.session_cards")
      expect(operations).toContain("opencodex.state.session")
      expect(operations).toContain("opencodex.state.event")
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
      expect(Array.isArray(record(record(record(snapshot.payloads).catalog).sessionCards).items)).toBe(true)
      expect(record(record(record(snapshot.payloads).catalog).sessionUiState)[sessionID]).toMatchObject({
        seenAt: 10,
        reviewedFiles: ["src/app.tsx"],
      })

      const capabilities = record(
        yield* Effect.promise(() =>
          request(firstDirectory, "/experimental/opencodex/state/capabilities").then((response) => response.json()),
        ),
      )
      expect(capabilities.scope).toEqual(snapshot.scope)
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

      yield* Effect.promise(() =>
        request(firstDirectory, `/session/${sessionID}`, {
          method: "PATCH",
          body: JSON.stringify({ title: "updated" }),
        }),
      )
      const live = record(yield* Effect.promise(() => events.next()))
      expect(live.type).toBe("event")
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
      expect(operationSnapshot.revision).toBe(operationSnapshot.digest)
      expect(typeof operationSnapshot.cursor).toBe("string")
      const operationSnapshotJobs = record(operationSnapshot.payload).jobs
      expect(
        Array.isArray(operationSnapshotJobs) && operationSnapshotJobs.some((job) => record(job).id === createdJob.id),
      ).toBe(true)
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
          `/experimental/opencodex/state/event?after=${encodeURIComponent(String(record(jobLive.event).cursor))}`,
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
      expect(Number(record(replayed.event).aggregateSequence)).toBe(Number(record(live.event).aggregateSequence) + 1)
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

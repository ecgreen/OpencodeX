import { describe, expect } from "bun:test"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Deferred, Effect, Exit, Layer } from "effect"
import { Session as SessionNs } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Storage } from "@/storage/storage"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { eq } from "drizzle-orm"
import {
  DELEGATION_RECORD_VERSION,
  delegationRecord,
  settleDelegation,
  type DelegationRecord,
} from "../../src/session/delegation-outcome"

void Log.init({ print: false })

const it = testEffect(
  Layer.mergeAll(
    SessionNs.layer.pipe(
      Layer.provide(Storage.defaultLayer),
      Layer.provide(Database.defaultLayer),
      Layer.provideMerge(EventV2Bridge.defaultLayer),
      Layer.provide(SessionProjector.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
      Layer.provide(BackgroundJob.defaultLayer),
    ),
    Database.defaultLayer,
    EventV2Bridge.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    testInstanceStoreLayer,
  ),
)

const awaitDeferred = <T>(deferred: Deferred.Deferred<T>, message: string) =>
  Effect.race(
    Deferred.await(deferred),
    Effect.sleep("2 seconds").pipe(Effect.flatMap(() => Effect.fail(new Error(message)))),
  )

const remove = (id: SessionID) => SessionNs.use.remove(id)

describe("session.created event", () => {
  it.instance("should emit session.created event when session is created", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const events = yield* EventV2Bridge.Service
      const received = yield* Deferred.make<SessionNs.Info>()

      const unsub = yield* events.listen((event) => {
        if (event.type === SessionNs.Event.Created.type)
          Deferred.doneUnsafe(
            received,
            Effect.succeed((event.data as typeof SessionNs.Event.Created.data.Type).info as SessionNs.Info),
          )
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsub)

      const info = yield* session.create({})
      const receivedInfo = yield* awaitDeferred(received, "timed out waiting for session.created")

      expect(receivedInfo.id).toBe(info.id)
      expect(receivedInfo.projectID).toBe(info.projectID)
      expect(receivedInfo.directory).toBe(info.directory)
      expect(receivedInfo.path).toBe(info.path)
      expect(receivedInfo.title).toBe(info.title)

      yield* session.remove(info.id)
    }),
  )

  it.instance("session.created event should be emitted before session.updated", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const source = yield* EventV2Bridge.Service
      const events: string[] = []
      const received = yield* Deferred.make<string[]>()
      const push = (event: string) => {
        events.push(event)
        if (events.includes("created") && events.includes("updated")) {
          Deferred.doneUnsafe(received, Effect.succeed(events))
        }
      }

      const unsubscribe = yield* source.listen((event) => {
        if (event.type === SessionNs.Event.Created.type) push("created")
        if (event.type === SessionNs.Event.Updated.type) push("updated")
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)

      const info = yield* session.create({})
      yield* session.setTitle({ sessionID: info.id, title: "updated" })
      const receivedEvents = yield* awaitDeferred(received, "timed out waiting for session created/updated events")

      expect(receivedEvents).toContain("created")
      expect(receivedEvents).toContain("updated")
      expect(receivedEvents.indexOf("created")).toBeLessThan(receivedEvents.indexOf("updated"))

      yield* session.remove(info.id)
    }),
  )
})

describe("session deletion", () => {
  it.instance("retains the durable tombstone and ignores stale creation replay", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const events = yield* EventV2Bridge.Service
      const { db } = yield* Database.Service
      const info = yield* session.create({})
      const created = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, info.id))
        .get()
        .pipe(Effect.orDie)
      if (!created) return yield* Effect.die(new Error("missing session creation event"))

      yield* session.remove(info.id)
      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, info.id))
        .all()
        .pipe(Effect.orDie)
      yield* events.replay({
        id: created.id,
        aggregateID: created.aggregate_id,
        seq: created.seq,
        type: created.type,
        data: created.data,
      })

      expect(rows.map((row) => row.type)).toContain(EventV2.versionedType(SessionLegacy.Event.Deleted.type, 1))
      expect((yield* session.get(info.id).pipe(Effect.flip))._tag).toBe("NotFoundError")
    }),
  )

  it.instance("serializes independent session field updates", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const info = yield* session.create({ title: "Original" })

      yield* Effect.all(
        [
          session.setTitle({ sessionID: info.id, title: "Renamed" }),
          session.setArchived({ sessionID: info.id, time: 123 }),
        ],
        { concurrency: "unbounded", discard: true },
      )

      const updated = yield* session.get(info.id)
      expect(updated.title).toBe("Renamed")
      expect(updated.time.archived).toBe(123)
    }),
  )
})

describe("step-finish token propagation via event", () => {
  it.instance(
    "non-zero tokens propagate through PartUpdated event",
    () =>
      Effect.gen(function* () {
        const session = yield* SessionNs.Service
        const events = yield* EventV2Bridge.Service
        const info = yield* session.create({})

        const messageID = MessageID.ascending()
        yield* session.updateMessage({
          id: messageID,
          sessionID: info.id,
          role: "user",
          time: { created: Date.now() },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
          tools: {},
          mode: "",
        } as unknown as SessionLegacy.Info)

        // Event subscribers receive readonly Schema.Type payloads; `SessionLegacy.Part`
        // is the mutable domain type. Cast bridges the two — safe because the
        // test only reads the value afterwards.
        const received = yield* Deferred.make<SessionLegacy.Part>()
        const unsub = yield* events.listen((event) => {
          if (event.type === MessageV2.Event.PartUpdated.type)
            Deferred.doneUnsafe(
              received,
              Effect.succeed((event.data as typeof MessageV2.Event.PartUpdated.data.Type).part as SessionLegacy.Part),
            )
          return Effect.void
        })
        yield* Effect.addFinalizer(() => unsub)

        const tokens = {
          total: 1500,
          input: 500,
          output: 800,
          reasoning: 200,
          cache: { read: 100, write: 50 },
        }

        const partInput = {
          id: PartID.ascending(),
          messageID,
          sessionID: info.id,
          type: "step-finish" as const,
          reason: "stop",
          cost: 0.005,
          tokens,
        }

        yield* session.updatePart(partInput)
        const receivedPart = yield* awaitDeferred(received, "timed out waiting for message.part.updated")

        expect(receivedPart.type).toBe("step-finish")
        const finish = receivedPart as SessionLegacy.StepFinishPart
        expect(finish.tokens.input).toBe(500)
        expect(finish.tokens.output).toBe(800)
        expect(finish.tokens.reasoning).toBe(200)
        expect(finish.tokens.total).toBe(1500)
        expect(finish.tokens.cache.read).toBe(100)
        expect(finish.tokens.cache.write).toBe(50)
        expect(finish.cost).toBe(0.005)
        expect(receivedPart).not.toBe(partInput)

        yield* session.remove(info.id)
      }),
    { timeout: 30000 },
  )
})

describe("Session", () => {
  it.live("remove works without an instance", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const dir = yield* tmpdirScoped({ git: true })
      const info = yield* provideInstance(dir)(session.create({ title: "remove-without-instance" }))

      const removeExit = yield* remove(info.id).pipe(Effect.exit)
      expect(Exit.isSuccess(removeExit)).toBe(true)

      const getExit = yield* session.get(info.id).pipe(Effect.exit)
      expect(Exit.isFailure(getExit)).toBe(true)
    }),
  )

  it.instance("persists metadata and copies it on fork by default", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const meta = { source: "sdk", trace: { id: "abc" } }
      const created = yield* Effect.acquireRelease(session.create({ title: "with-meta", metadata: meta }), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )
      const saved = yield* session.get(created.id)
      const fork = yield* Effect.acquireRelease(session.fork({ sessionID: created.id }), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )

      expect(saved.metadata).toEqual(meta)
      expect(fork.metadata).toEqual(meta)
      expect(fork.metadata).not.toBe(meta)
    }),
  )

  it.instance("omits metadata when not provided", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const created = yield* Effect.acquireRelease(session.create({ title: "empty-meta" }), (info) =>
        session.remove(info.id).pipe(Effect.ignore),
      )
      const saved = yield* session.get(created.id)

      expect(created.metadata).toBeUndefined()
      expect(saved.metadata).toBeUndefined()
    }),
  )
})

describe("transient part updates", () => {
  it.instance("broadcast the same payload without touching the journal", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const events = yield* EventV2Bridge.Service
      const { db } = yield* Database.Service
      const info = yield* Effect.acquireRelease(session.create({ title: "transient" }), (created) =>
        session.remove(created.id).pipe(Effect.ignore),
      )
      const messageID = MessageID.ascending()
      yield* session.updateMessage({
        id: messageID,
        sessionID: info.id,
        role: "user",
        time: { created: Date.now() },
        agent: "user",
        model: { providerID: "test", modelID: "test" },
      } as unknown as SessionLegacy.Info)

      const seen: EventV2.Payload[] = []
      const unsub = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === MessageV2.Event.PartUpdated.type) seen.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsub)

      const part = {
        id: PartID.ascending(),
        messageID,
        sessionID: info.id,
        type: "text" as const,
        text: "durable",
      }
      yield* session.updatePart(part)
      const rowsAfterDurable = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, info.id))
        .all()
        .pipe(Effect.orDie)

      yield* session.updatePart({ ...part, text: "transient" }, { transient: true })
      const rowsAfterTransient = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, info.id))
        .all()
        .pipe(Effect.orDie)

      // Both revisions reach subscribers, and the wire payload is the same
      // shape either way - only the durable one lands in the journal.
      expect(seen).toHaveLength(2)
      expect(Object.keys(seen[1]!).sort()).toEqual(Object.keys(seen[0]!).sort())
      expect(seen[1]!.version).toBe(seen[0]!.version)
      expect(seen[1]!.location).toEqual(seen[0]!.location)
      expect((seen[1]!.data as { part: { text: string } }).part.text).toBe("transient")
      expect(rowsAfterTransient.map((row) => row.seq)).toEqual(rowsAfterDurable.map((row) => row.seq))

      // The durable projection still shows the last journaled revision, which
      // is exactly what makes a dropped intermediate revision unobservable
      // once the terminal write lands.
      const stored = yield* session.getPart({ sessionID: info.id, messageID, partID: part.id })
      expect(stored?.type === "text" ? stored.text : undefined).toBe("durable")
    }),
  )
})

describe("session delegation stamping", () => {
  const record = (overrides: Partial<DelegationRecord> = {}): DelegationRecord => ({
    version: DELEGATION_RECORD_VERSION,
    runID: "run_a",
    parentSessionID: "ses_parent",
    attempt: 1,
    phase: "running",
    startedAt: 100,
    ...overrides,
  })

  it.instance("compare-and-set rejects stale runs and double settles", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const info = yield* session.create({ metadata: { note: "keep" } })

      // Run A claims the session and settles once.
      expect(yield* session.stampDelegation({ sessionID: info.id, record: record() })).toBe(true)
      expect(
        yield* session.stampDelegation({
          sessionID: info.id,
          record: settleDelegation(record(), { outcome: "completed", summary: "first" }),
          expectRunID: "run_a",
        }),
      ).toBe(true)
      // A second settle from the same run is declined: the first settle won.
      expect(
        yield* session.stampDelegation({
          sessionID: info.id,
          record: settleDelegation(record(), { outcome: "errored" }),
          expectRunID: "run_a",
        }),
      ).toBe(false)
      // Run B claims the session; a late write from run A is now stale.
      expect(
        yield* session.stampDelegation({ sessionID: info.id, record: record({ runID: "run_b", attempt: 2 }) }),
      ).toBe(true)
      expect(
        yield* session.stampDelegation({
          sessionID: info.id,
          record: settleDelegation(record(), { outcome: "errored" }),
          expectRunID: "run_a",
        }),
      ).toBe(false)

      const current = yield* session.get(info.id)
      expect(delegationRecord(current.metadata)).toMatchObject({ runID: "run_b", attempt: 2, phase: "running" })
      // The merge preserved unrelated metadata across every write.
      expect(current.metadata?.note).toBe("keep")

      yield* session.remove(info.id)
    }),
  )

  it.instance("delivery marks compare-and-set on the run identity", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const info = yield* session.create({})
      yield* session.stampDelegation({
        sessionID: info.id,
        record: settleDelegation(record(), { outcome: "completed", deliveryOutcome: "pending" }),
      })

      // A late mark from another run cannot touch this record.
      expect(
        yield* session.stampDelegationDelivery({ sessionID: info.id, runID: "run_zzz", outcome: "delivered" }),
      ).toBe(false)
      expect(
        yield* session.stampDelegationDelivery({ sessionID: info.id, runID: "run_a", outcome: "delivered", at: 555 }),
      ).toBe(true)

      const current = delegationRecord((yield* session.get(info.id)).metadata)
      expect(current).toMatchObject({ outcome: "completed", deliveryOutcome: "delivered", deliveredAt: 555 })

      yield* session.remove(info.id)
    }),
  )

  it.instance("a fork does not inherit the source's delegation record", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const info = yield* session.create({ metadata: { opencodex: { swarmID: "swm_1", swarmRole: "Builder" } } })
      yield* session.stampDelegation({
        sessionID: info.id,
        record: settleDelegation(record(), { outcome: "completed", summary: "the source's run" }),
      })

      const forked = yield* session.fork({ sessionID: info.id })
      // The copied stamp described the source session's run under its own
      // parent; the fork keeps the swarm bookkeeping but not the provenance.
      expect(delegationRecord(forked.metadata)).toBeUndefined()
      expect(forked.metadata?.opencodex).toMatchObject({ swarmID: "swm_1", swarmRole: "Builder" })

      yield* session.remove(forked.id)
      yield* session.remove(info.id)
    }),
  )
})

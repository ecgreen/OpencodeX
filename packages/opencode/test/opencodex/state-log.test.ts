import { afterEach, describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { OpencodeXStateAggregateSequenceTable, OpencodeXStateEventTable } from "@opencode-ai/core/opencodex/sql"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { makeStateLog } from "../../src/opencodex/state-log"
import { OpencodeXPlugin } from "../../src/opencodex/plugin"
import { OpencodeXSettings } from "../../src/opencodex/settings"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { disposeAllInstances, provideInstance, tmpdirScoped } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { pollWithTimeout, testEffect } from "../lib/effect"

const GlobalInvalidation = EventV2.define({
  type: "opencodex.job.state_coherence_test",
  schema: { id: Schema.String },
})
const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const it = testEffect(
  Layer.mergeAll(
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)),
    Database.defaultLayer,
  ),
)

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("OpencodeX state log", () => {
  it.live("tails global rows across event graphs while capabilities remain exact-scope", () =>
    Effect.gen(function* () {
      const firstDirectory = yield* tmpdirScoped({ git: true })
      const secondDirectory = yield* tmpdirScoped({ git: true })
      const database = yield* Database.Service
      const eventLayer = EventV2.layer.pipe(Layer.provide(Layer.succeed(Database.Service, database)))
      const firstEvents = Context.get(yield* Layer.build(Layer.fresh(eventLayer)), EventV2.Service)
      const secondEvents = Context.get(yield* Layer.build(Layer.fresh(eventLayer)), EventV2.Service)
      expect(firstEvents).not.toBe(secondEvents)
      const firstLog = yield* makeStateLog(database.db, firstEvents)
      yield* makeStateLog(database.db, secondEvents)
      const firstScopeEvents = new Array<{ visibility: string; directory: string; aggregateSequence: number }>()
      const secondScopeEvents = new Array<{ visibility: string; directory: string; aggregateSequence: number }>()
      yield* firstLog
        .listen((event) =>
          firstScopeEvents.push({
            visibility: event.visibility,
            directory: event.scope.directory,
            aggregateSequence: event.aggregateSequence,
          }),
        )
        .pipe(provideInstance(firstDirectory))
      yield* firstLog
        .listen((event) =>
          secondScopeEvents.push({
            visibility: event.visibility,
            directory: event.scope.directory,
            aggregateSequence: event.aggregateSequence,
          }),
        )
        .pipe(provideInstance(secondDirectory))

      yield* secondEvents.publish(GlobalInvalidation, { id: "shared-operation" })
      yield* pollWithTimeout(
        Effect.sync(() => (firstScopeEvents.length === 1 && secondScopeEvents.length === 1 ? true : undefined)),
        "global state event was not drained by the other graph",
      )
      expect(firstScopeEvents[0]).toEqual({ visibility: "global", directory: firstDirectory, aggregateSequence: 0 })
      expect(secondScopeEvents[0]).toEqual({ visibility: "global", directory: secondDirectory, aggregateSequence: 0 })
      const cursor = yield* firstLog.cursor().pipe(provideInstance(firstDirectory))
      const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString())
      const incompatible = Buffer.from(JSON.stringify({ ...record(decoded), databaseID: "another-database" })).toString(
        "base64url",
      )
      expect(yield* firstLog.replay(incompatible).pipe(provideInstance(firstDirectory))).toMatchObject({
        reset: true,
        reason: "cursor epoch, database, or scope mismatch",
      })

      yield* secondEvents
        .publish(
          PluginV2.Event.Added,
          { id: PluginV2.ID.make("state-coherence-plugin") },
          { location: { directory: AbsolutePath.make(secondDirectory) } },
        )
        .pipe(provideInstance(secondDirectory))
      yield* pollWithTimeout(
        Effect.sync(() => (secondScopeEvents.some((event) => event.visibility === "instance") ? true : undefined)),
        "instance capability event was not delivered",
      )
      expect(firstScopeEvents.some((event) => event.visibility === "instance")).toBe(false)
      expect(secondScopeEvents.find((event) => event.visibility === "instance")?.directory).toBe(secondDirectory)
    }),
  )

  it.live("keeps aggregate sequence after retained event rows are removed", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const eventLayer = EventV2.layer.pipe(Layer.provide(Layer.succeed(Database.Service, database)))
      const events = Context.get(yield* Layer.build(eventLayer), EventV2.Service)
      yield* makeStateLog(database.db, events)

      yield* events.publish(GlobalInvalidation, { id: "pruned-operation" })
      yield* database.db
        .delete(OpencodeXStateEventTable)
        .where(eq(OpencodeXStateEventTable.aggregate_id, "pruned-operation"))
        .run()
        .pipe(Effect.orDie)
      yield* events.publish(GlobalInvalidation, { id: "pruned-operation" })

      const event = yield* database.db
        .select({ sequence: OpencodeXStateEventTable.aggregate_sequence })
        .from(OpencodeXStateEventTable)
        .where(eq(OpencodeXStateEventTable.aggregate_id, "pruned-operation"))
        .get()
        .pipe(Effect.orDie)
      const aggregate = yield* database.db
        .select({ sequence: OpencodeXStateAggregateSequenceTable.aggregate_sequence })
        .from(OpencodeXStateAggregateSequenceTable)
        .where(
          and(
            eq(OpencodeXStateAggregateSequenceTable.visibility, "global"),
            eq(OpencodeXStateAggregateSequenceTable.aggregate_id, "pruned-operation"),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      expect(event?.sequence).toBe(1)
      expect(aggregate?.sequence).toBe(1)
    }),
  )

  it.live("scopes settings and plugin config invalidations to their persistence authority", () =>
    Effect.gen(function* () {
      const firstDirectory = yield* tmpdirScoped({ git: true })
      const secondDirectory = yield* tmpdirScoped({ git: true })
      const database = yield* Database.Service
      const eventLayer = EventV2.layer.pipe(Layer.provide(Layer.succeed(Database.Service, database)))
      const events = Context.get(yield* Layer.build(eventLayer), EventV2.Service)
      const log = yield* makeStateLog(database.db, events)
      const first: string[] = []
      const second: string[] = []
      yield* log.listen((event) => first.push(event.payload.eventType)).pipe(provideInstance(firstDirectory))
      yield* log.listen((event) => second.push(event.payload.eventType)).pipe(provideInstance(secondDirectory))

      yield* events.publish(OpencodeXSettings.Event.Updated, { revision: "settings-1" })
      yield* events
        .publish(OpencodeXPlugin.Event.Updated, { global: false, spec: "local-plugin" })
        .pipe(provideInstance(secondDirectory))
      yield* events.publish(OpencodeXPlugin.Event.Updated, { global: true, spec: "global-plugin" })
      yield* pollWithTimeout(
        Effect.sync(() => (first.length === 2 && second.length === 3 ? true : undefined)),
        "settings and plugin invalidations were not delivered to the expected scopes",
      )

      expect(first).toEqual(["opencodex.settings.updated", "opencodex.plugin_config.updated"])
      expect(second).toEqual([
        "opencodex.settings.updated",
        "opencodex.plugin_config.updated",
        "opencodex.plugin_config.updated",
      ])
    }),
  )

  it.live("prunes bounded batches without making the current cursor unsatisfiable", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const database = yield* Database.Service
      const eventLayer = EventV2.layer.pipe(Layer.provide(Layer.succeed(Database.Service, database)))
      const events = Context.get(yield* Layer.build(eventLayer), EventV2.Service)
      const log = yield* makeStateLog(database.db, events, {
        retentionMs: 1,
        retentionEvents: 1,
        maintenanceBatchSize: 1,
        maintenanceIntervalMs: 60_000,
      })

      yield* Effect.forEach(
        ["first", "second", "third", "fourth"],
        (id) => events.publish(GlobalInvalidation, { id }),
        { discard: true },
      )
      yield* log.maintain()
      expect(yield* database.db.select().from(OpencodeXStateEventTable).all().pipe(Effect.orDie)).toHaveLength(3)

      yield* log.maintain()
      yield* log.maintain()
      const retained = yield* database.db.select().from(OpencodeXStateEventTable).all().pipe(Effect.orDie)
      expect(retained).toHaveLength(1)

      yield* database.db
        .update(OpencodeXStateEventTable)
        .set({ created_at: 0 })
        .run()
        .pipe(Effect.orDie)
      yield* log.maintain()
      expect(yield* database.db.select().from(OpencodeXStateEventTable).all().pipe(Effect.orDie)).toHaveLength(0)

      const scope = yield* log.scope().pipe(provideInstance(directory))
      const cursor = yield* log.cursor().pipe(provideInstance(directory))
      expect(yield* log.replay(cursor).pipe(provideInstance(directory))).toMatchObject({
        reset: false,
        events: [],
        position: 4,
      })
      expect(yield* log.replay(log.cursorAt(scope, 0)).pipe(provideInstance(directory))).toMatchObject({
        reset: true,
        reason: "cursor is not retained",
        position: 4,
      })
      expect(yield* log.revisionVector(scope)).toEqual({
        capabilities: 4,
        catalog: 4,
        operations: 4,
        session: 4,
      })
    }),
  )

  it.live("periodically catches up journal retention", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const eventLayer = EventV2.layer.pipe(Layer.provide(Layer.succeed(Database.Service, database)))
      const events = Context.get(yield* Layer.build(eventLayer), EventV2.Service)
      yield* makeStateLog(database.db, events, {
        retentionEvents: 1,
        maintenanceBatchSize: 1,
        maintenanceIntervalMs: 10,
      })

      yield* Effect.forEach(
        ["first", "second", "third"],
        (id) => events.publish(GlobalInvalidation, { id }),
        { discard: true },
      )
      yield* pollWithTimeout(
        database.db
          .select({ position: OpencodeXStateEventTable.position })
          .from(OpencodeXStateEventTable)
          .all()
          .pipe(Effect.orDie, Effect.map((rows) => (rows.length === 1 ? true : undefined))),
        "state journal was not pruned by periodic maintenance",
      )
    }),
  )

  it.live("resets replay that exceeds the bounded window", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const database = yield* Database.Service
      const eventLayer = EventV2.layer.pipe(Layer.provide(Layer.succeed(Database.Service, database)))
      const events = Context.get(yield* Layer.build(eventLayer), EventV2.Service)
      const log = yield* makeStateLog(database.db, events, {
        maxReplayEvents: 2,
        maintenanceIntervalMs: 60_000,
      })

      yield* Effect.forEach(
        ["first", "second", "third"],
        (id) => events.publish(GlobalInvalidation, { id }),
        { discard: true },
      )
      const scope = yield* log.scope().pipe(provideInstance(directory))
      expect(yield* log.replay(log.cursorAt(scope, 0)).pipe(provideInstance(directory))).toMatchObject({
        reset: true,
        reason: "replay exceeds bounded window",
        position: 3,
      })
    }),
  )
})

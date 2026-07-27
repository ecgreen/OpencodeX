import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import {
  OpencodeXStateAggregateSequenceTable,
  OpencodeXStateEventTable,
  OpencodeXStateMetadataTable,
} from "@opencode-ai/core/opencodex/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { and, asc, desc, eq, gt, inArray, lt, lte, max, or } from "drizzle-orm"
import { Duration, Effect, Option, Schedule, Schema, Semaphore } from "effect"
import {
  aggregateID,
  currentStateScope,
  durableDomain,
  encodeCursor,
  eventVisibility,
  hydrateStateEvent,
  sameScope,
  whereVisible,
} from "./state-event"
import {
  CursorPayload,
  EPOCH,
  type OpencodeXStateCursor,
  type OpencodeXStateEvent,
  type OpencodeXStateScope,
  type Replay,
} from "./state-schema"

const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
const RETENTION_EVENTS = 100_000
const MAINTENANCE_INTERVAL_MS = 60_000
const MAINTENANCE_BATCH_SIZE = 5_000
const MAX_REPLAY_EVENTS = 512
const DRAIN_EVENTS = 1_024
const MAX_CURSOR_LENGTH = 4_096
const JOURNAL_RETENTION_KEY = "retention:journal"
const GLOBAL_SCOPE_VALUE = "__opencodex_global__"
const GLOBAL_SCOPE: OpencodeXStateScope = {
  projectID: ProjectV2.ID.make(GLOBAL_SCOPE_VALUE),
  directory: GLOBAL_SCOPE_VALUE,
}
const decodeCursorPayload = Schema.decodeUnknownOption(Schema.fromJsonString(CursorPayload))

export type StateLogOptions = {
  retentionMs?: number
  retentionEvents?: number
  maintenanceIntervalMs?: number
  maintenanceBatchSize?: number
  maxReplayEvents?: number
  drainEvents?: number
}

export interface StateLog {
  scope: typeof currentStateScope
  position: (scope: OpencodeXStateScope) => Effect.Effect<number>
  revisionVector: (scope: OpencodeXStateScope) => Effect.Effect<{
    capabilities: number
    catalog: number
    operations: number
    session: number
  }>
  cursorAt: (scope: OpencodeXStateScope, position: number) => OpencodeXStateCursor
  cursor: () => Effect.Effect<OpencodeXStateCursor>
  replay: (after?: string) => Effect.Effect<Replay>
  listen: (listener: (event: OpencodeXStateEvent) => void) => Effect.Effect<Effect.Effect<void>>
  maintain: () => Effect.Effect<void>
}

export const makeStateLog = Effect.fn("OpencodeXState.makeLog")(function* (
  db: Database.Interface["db"],
  events: EventV2.Interface,
  options?: StateLogOptions,
) {
  const settings = {
    retentionMs: Math.max(1, options?.retentionMs ?? RETENTION_MS),
    retentionEvents: Math.max(1, options?.retentionEvents ?? RETENTION_EVENTS),
    maintenanceIntervalMs: Math.max(1, options?.maintenanceIntervalMs ?? MAINTENANCE_INTERVAL_MS),
    maintenanceBatchSize: Math.max(1, options?.maintenanceBatchSize ?? MAINTENANCE_BATCH_SIZE),
    maxReplayEvents: Math.max(1, options?.maxReplayEvents ?? MAX_REPLAY_EVENTS),
    drainEvents: Math.max(1, options?.drainEvents ?? DRAIN_EVENTS),
  }
  const listeners = new Array<{
    scope: OpencodeXStateScope
    listener: (event: OpencodeXStateEvent) => void
  }>()
  const drainLock = Semaphore.makeUnsafe(1)
  const storedDatabaseID = yield* db
    .select({ value: OpencodeXStateMetadataTable.value })
    .from(OpencodeXStateMetadataTable)
    .where(eq(OpencodeXStateMetadataTable.key, "database_uuid"))
    .get()
    .pipe(Effect.orDie)
  const databaseID = storedDatabaseID
    ? storedDatabaseID.value
    : yield* Effect.gen(function* () {
        const generated = crypto.randomUUID()
        yield* db
          .insert(OpencodeXStateMetadataTable)
          .values({ key: "database_uuid", value: generated })
          .onConflictDoNothing({ target: OpencodeXStateMetadataTable.key })
          .run()
          .pipe(Effect.orDie)
        return (
          (yield* db
            .select({ value: OpencodeXStateMetadataTable.value })
            .from(OpencodeXStateMetadataTable)
            .where(eq(OpencodeXStateMetadataTable.key, "database_uuid"))
            .get()
            .pipe(Effect.orDie))?.value ?? generated
        )
      })
  let lastObservedPosition =
    (yield* db
      .select({ value: max(OpencodeXStateEventTable.position) })
      .from(OpencodeXStateEventTable)
      .get()
      .pipe(Effect.orDie))?.value ?? 0

  const cursorAt = (scope: OpencodeXStateScope, position: number) => encodeCursor(databaseID, scope, position)

  const retentionKey = (visibility: "global" | "instance", scope: OpencodeXStateScope) =>
    JSON.stringify([
      "retention",
      visibility,
      visibility === "global" ? GLOBAL_SCOPE_VALUE : scope.projectID,
      visibility === "global" ? "" : (scope.workspaceID ?? ""),
      visibility === "global" ? GLOBAL_SCOPE_VALUE : scope.directory,
    ])

  const retentionFloor = Effect.fn("OpencodeXState.retentionFloor")(function* (scope: OpencodeXStateScope) {
    const rows = yield* db
      .select({ value: OpencodeXStateMetadataTable.value })
      .from(OpencodeXStateMetadataTable)
      .where(
        or(
          eq(OpencodeXStateMetadataTable.key, JOURNAL_RETENTION_KEY),
          eq(OpencodeXStateMetadataTable.key, retentionKey("global", scope)),
          eq(OpencodeXStateMetadataTable.key, retentionKey("instance", scope)),
        ),
      )
      .all()
      .pipe(Effect.orDie)
    return Math.max(0, ...rows.map((row) => Number(row.value)).filter(Number.isFinite))
  })

  const position = Effect.fn("OpencodeXState.position")(function* (scope: OpencodeXStateScope) {
    const retained =
      (yield* db
        .select({ value: max(OpencodeXStateEventTable.position) })
        .from(OpencodeXStateEventTable)
        .where(whereVisible(scope))
        .get()
        .pipe(Effect.orDie))?.value ?? 0
    return Math.max(retained, yield* retentionFloor(scope))
  })

  const revisionVector = Effect.fn("OpencodeXState.revisionVector")(function* (scope: OpencodeXStateScope) {
    const rows = yield* db
      .select({ domain: OpencodeXStateEventTable.domain, value: max(OpencodeXStateEventTable.position) })
      .from(OpencodeXStateEventTable)
      .where(whereVisible(scope))
      .groupBy(OpencodeXStateEventTable.domain)
      .all()
      .pipe(Effect.orDie)
    const floor = yield* retentionFloor(scope)
    const value = (name: "capabilities" | "catalog" | "operations" | "session") =>
      Math.max(rows.find((row) => row.domain === name)?.value ?? 0, floor)
    return {
      capabilities: value("capabilities"),
      catalog: value("catalog"),
      operations: value("operations"),
      session: value("session"),
    }
  })

  const cursor = Effect.fn("OpencodeXState.cursor")(function* () {
    const scope = yield* currentStateScope()
    return cursorAt(scope, yield* position(scope))
  })

  const maintain = Effect.fn("OpencodeXState.maintain")(function* () {
    yield* events.barrier(
      db
        .transaction(
          (transaction) =>
            Effect.gen(function* () {
              const boundary = yield* transaction
                .select({ position: OpencodeXStateEventTable.position })
                .from(OpencodeXStateEventTable)
                .orderBy(desc(OpencodeXStateEventTable.position))
                .limit(1)
                .offset(settings.retentionEvents - 1)
                .get()
              const expired = lt(OpencodeXStateEventTable.created_at, Date.now() - settings.retentionMs)
              const removable = boundary
                ? or(expired, lt(OpencodeXStateEventTable.position, boundary.position))
                : expired
              const rows = yield* transaction
                .select({ position: OpencodeXStateEventTable.position })
                .from(OpencodeXStateEventTable)
                .where(removable)
                .orderBy(asc(OpencodeXStateEventTable.position))
                .limit(settings.maintenanceBatchSize)
                .all()
              if (rows.length === 0) return
              const floor = Math.max(...rows.map((row) => row.position))
              yield* transaction
                .delete(OpencodeXStateEventTable)
                .where(inArray(OpencodeXStateEventTable.position, rows.map((row) => row.position)))
                .run()
              const previous = yield* transaction
                .select({ value: OpencodeXStateMetadataTable.value })
                .from(OpencodeXStateMetadataTable)
                .where(eq(OpencodeXStateMetadataTable.key, JOURNAL_RETENTION_KEY))
                .get()
              const previousFloor = Number(previous?.value ?? 0)
              const nextFloor = Math.max(Number.isFinite(previousFloor) ? previousFloor : 0, floor)
              yield* transaction
                .insert(OpencodeXStateMetadataTable)
                .values({ key: JOURNAL_RETENTION_KEY, value: String(nextFloor) })
                .onConflictDoUpdate({
                  target: OpencodeXStateMetadataTable.key,
                  set: { value: String(nextFloor) },
                })
                .run()
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie),
    )
  })

  const persistStateEvent = Effect.fn("OpencodeXState.persistEvent")(function* (event: EventV2.Payload) {
    const domain = durableDomain(event)
    if (!domain) return
    const visibility = eventVisibility(event, domain)
    const instance = yield* InstanceRef
    if (!instance && visibility === "instance") return
    const workspaceID = instance ? (event.location?.workspaceID ?? (yield* WorkspaceRef)) : undefined
    const scope = instance
      ? {
          projectID: ProjectV2.ID.make(instance.project.id),
          ...(workspaceID ? { workspaceID: WorkspaceV2.ID.make(workspaceID) } : {}),
          directory: event.location?.directory ?? instance.directory,
        }
      : GLOBAL_SCOPE
    const aggregate = aggregateID(event)
    const existing = yield* db
      .select({ position: OpencodeXStateEventTable.position })
      .from(OpencodeXStateEventTable)
      .where(eq(OpencodeXStateEventTable.id, event.id))
      .get()
      .pipe(Effect.orDie)
    if (existing) return
    const sequenceScope = visibility === "global" ? GLOBAL_SCOPE : scope
    const aggregateWhere = and(
      eq(OpencodeXStateAggregateSequenceTable.visibility, visibility),
      eq(OpencodeXStateAggregateSequenceTable.project_id, sequenceScope.projectID),
      eq(OpencodeXStateAggregateSequenceTable.workspace_id, sequenceScope.workspaceID ?? ""),
      eq(OpencodeXStateAggregateSequenceTable.directory, sequenceScope.directory),
      eq(OpencodeXStateAggregateSequenceTable.aggregate_id, aggregate),
    )
    const previous = yield* db
      .select({ value: OpencodeXStateAggregateSequenceTable.aggregate_sequence })
      .from(OpencodeXStateAggregateSequenceTable)
      .where(aggregateWhere)
      .get()
      .pipe(Effect.orDie)
    const next = (previous?.value ?? -1) + 1
    yield* db
      .insert(OpencodeXStateAggregateSequenceTable)
      .values({
        visibility,
        project_id: sequenceScope.projectID,
        workspace_id: sequenceScope.workspaceID ?? "",
        directory: sequenceScope.directory,
        aggregate_id: aggregate,
        aggregate_sequence: next,
      })
      .onConflictDoUpdate({
        target: [
          OpencodeXStateAggregateSequenceTable.visibility,
          OpencodeXStateAggregateSequenceTable.project_id,
          OpencodeXStateAggregateSequenceTable.workspace_id,
          OpencodeXStateAggregateSequenceTable.directory,
          OpencodeXStateAggregateSequenceTable.aggregate_id,
        ],
        set: { aggregate_sequence: next },
      })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(OpencodeXStateEventTable)
      .values({
        id: event.id,
        visibility,
        project_id: scope.projectID,
        workspace_id: scope.workspaceID,
        directory: scope.directory,
        aggregate_id: aggregate,
        aggregate_sequence: next,
        domain,
        event_type: event.type,
        operation: "invalidate",
        payload: { aggregateID: aggregate, eventType: event.type },
        created_at: Date.now(),
      })
      .onConflictDoNothing({ target: OpencodeXStateEventTable.id })
      .run()
      .pipe(Effect.orDie)
  })

  const drain = Effect.fn("OpencodeXState.drain")(function* () {
    yield* drainLock.withPermit(
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(OpencodeXStateEventTable)
          .where(gt(OpencodeXStateEventTable.position, lastObservedPosition))
          .orderBy(asc(OpencodeXStateEventTable.position))
          .limit(settings.drainEvents)
          .all()
          .pipe(Effect.orDie)
        rows.forEach((row) => {
          listeners.forEach((item) => {
            const visible =
              row.visibility === "global" ||
              (row.project_id === item.scope.projectID &&
                row.workspace_id === (item.scope.workspaceID ?? null) &&
                row.directory === item.scope.directory)
            if (visible) item.listener(hydrateStateEvent(row, databaseID, item.scope))
          })
          lastObservedPosition = row.position
        })
      }),
    )
  })

  const unsubscribeSync = yield* events.sync(persistStateEvent, (event) => durableDomain(event) !== undefined)
  const unsubscribeListener = yield* events.listen((event) =>
    durableDomain(event) === undefined ? Effect.void : drain(),
  )
  yield* maintain()
  yield* Effect.sleep(Duration.seconds(1)).pipe(
    Effect.andThen(drain()),
    Effect.repeat(Schedule.forever),
    Effect.forkScoped,
  )
  yield* Effect.sleep(Duration.millis(settings.maintenanceIntervalMs)).pipe(
    Effect.andThen(maintain()),
    Effect.repeat(Schedule.forever),
    Effect.forkScoped,
  )
  yield* Effect.addFinalizer(() => Effect.all([unsubscribeSync, unsubscribeListener], { discard: true }))

  const listen: StateLog["listen"] = (listener) =>
    Effect.gen(function* () {
      const item = { scope: yield* currentStateScope(), listener }
      listeners.push(item)
      return Effect.sync(() => {
        const index = listeners.indexOf(item)
        if (index >= 0) listeners.splice(index, 1)
      })
    })

  const replay = Effect.fn("OpencodeXState.replay")(function* (after?: string) {
    const scope = yield* currentStateScope()
    const latest = yield* position(scope)
    const cursor = cursorAt(scope, latest)
    if (!after) return { reset: false as const, events: [], cursor, position: latest }
    if (after.length > MAX_CURSOR_LENGTH) {
      return { reset: true as const, reason: "cursor is not valid", cursor, position: latest }
    }
    const decoded = Option.getOrUndefined(decodeCursorPayload(Buffer.from(after, "base64url").toString()))
    if (!decoded || decoded.epoch !== EPOCH || decoded.databaseID !== databaseID || !sameScope(decoded.scope, scope)) {
      return { reset: true as const, reason: "cursor epoch, database, or scope mismatch", cursor, position: latest }
    }
    if (decoded.position > latest) {
      return { reset: true as const, reason: "cursor is not satisfiable", cursor, position: latest }
    }
    if (decoded.position < (yield* retentionFloor(scope))) {
      return { reset: true as const, reason: "cursor is not retained", cursor, position: latest }
    }
    const rows = yield* db
      .select()
      .from(OpencodeXStateEventTable)
      .where(
        and(
          whereVisible(scope),
          gt(OpencodeXStateEventTable.position, decoded.position),
          lte(OpencodeXStateEventTable.position, latest),
        ),
      )
      .orderBy(asc(OpencodeXStateEventTable.position))
      .limit(settings.maxReplayEvents + 1)
      .all()
      .pipe(Effect.orDie)
    if (rows.length > settings.maxReplayEvents) {
      return { reset: true as const, reason: "replay exceeds bounded window", cursor, position: latest }
    }
    return {
      reset: false as const,
      events: rows.map((row) => hydrateStateEvent(row, databaseID, scope)),
      cursor,
      position: latest,
    }
  })

  return { scope: currentStateScope, position, revisionVector, cursorAt, cursor, replay, listen, maintain } satisfies StateLog
})

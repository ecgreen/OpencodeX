import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { OpencodeXStateEventTable } from "@opencode-ai/core/opencodex/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { and, asc, desc, eq, gt, lt, max } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import {
  aggregateID,
  currentStateScope,
  durableDomain,
  encodeCursor,
  hydrateStateEvent,
  sameScope,
  whereScope,
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
const decodeCursorPayload = Schema.decodeUnknownOption(Schema.fromJsonString(CursorPayload))

export interface StateLog {
  scope: typeof currentStateScope
  position: (scope: OpencodeXStateScope) => Effect.Effect<number>
  revisionVector: (scope: OpencodeXStateScope) => Effect.Effect<{
    capabilities: number
    catalog: number
    operations: number
    session: number
  }>
  cursor: () => Effect.Effect<OpencodeXStateCursor>
  replay: (after?: string) => Effect.Effect<Replay>
  listen: (listener: (event: OpencodeXStateEvent) => void) => Effect.Effect<Effect.Effect<void>>
}

export const makeStateLog = Effect.fn("OpencodeXState.makeLog")(function* (
  db: Database.Interface["db"],
  events: EventV2.Interface,
) {
  const listeners = new Array<(event: OpencodeXStateEvent) => void>()
  const lastPruned = new Map<string, number>()

  const position = Effect.fn("OpencodeXState.position")(function* (scope: OpencodeXStateScope) {
    return (
      (yield* db
        .select({ value: max(OpencodeXStateEventTable.position) })
        .from(OpencodeXStateEventTable)
        .where(whereScope(scope))
        .get()
        .pipe(Effect.orDie))?.value ?? 0
    )
  })

  const revisionVector = Effect.fn("OpencodeXState.revisionVector")(function* (scope: OpencodeXStateScope) {
    const rows = yield* db
      .select({ domain: OpencodeXStateEventTable.domain, value: max(OpencodeXStateEventTable.position) })
      .from(OpencodeXStateEventTable)
      .where(whereScope(scope))
      .groupBy(OpencodeXStateEventTable.domain)
      .all()
      .pipe(Effect.orDie)
    const value = (name: "capabilities" | "catalog" | "operations" | "session") =>
      rows.find((row) => row.domain === name)?.value ?? 0
    return {
      capabilities: value("capabilities"),
      catalog: value("catalog"),
      operations: value("operations"),
      session: value("session"),
    }
  })

  const cursor = Effect.fn("OpencodeXState.cursor")(function* () {
    const scope = yield* currentStateScope()
    return encodeCursor(scope, yield* position(scope))
  })

  const prune = Effect.fn("OpencodeXState.prune")(function* (scope: OpencodeXStateScope) {
    const key = `${scope.projectID}\0${scope.workspaceID ?? ""}\0${scope.directory}`
    const now = Date.now()
    if ((lastPruned.get(key) ?? 0) + 60_000 > now) return
    const boundary = yield* db
      .select({ position: OpencodeXStateEventTable.position })
      .from(OpencodeXStateEventTable)
      .where(whereScope(scope))
      .orderBy(desc(OpencodeXStateEventTable.position))
      .limit(1)
      .offset(RETENTION_EVENTS - 1)
      .get()
      .pipe(Effect.orDie)
    yield* Effect.all(
      [
        db
          .delete(OpencodeXStateEventTable)
          .where(and(whereScope(scope), lt(OpencodeXStateEventTable.created_at, now - RETENTION_MS)))
          .run()
          .pipe(Effect.orDie),
        boundary
          ? db
              .delete(OpencodeXStateEventTable)
              .where(and(whereScope(scope), lt(OpencodeXStateEventTable.position, boundary.position)))
              .run()
              .pipe(Effect.orDie)
          : Effect.void,
      ],
      { concurrency: "unbounded", discard: true },
    )
    lastPruned.set(key, now)
  })

  const persistStateEvent = Effect.fn("OpencodeXState.persistEvent")(function* (event: EventV2.Payload) {
    const eventDomain = durableDomain(event)
    if (!eventDomain) return
    const instance = yield* InstanceRef
    if (!instance) return
    const workspaceID = event.location?.workspaceID ?? (yield* WorkspaceRef)
    const scope = {
      projectID: ProjectV2.ID.make(instance.project.id),
      ...(workspaceID ? { workspaceID: WorkspaceV2.ID.make(workspaceID) } : {}),
      directory: event.location?.directory ?? instance.directory,
    }
    const aggregate = aggregateID(event)
    const existing = yield* db
      .select({ position: OpencodeXStateEventTable.position })
      .from(OpencodeXStateEventTable)
      .where(eq(OpencodeXStateEventTable.id, event.id))
      .get()
      .pipe(Effect.orDie)
    if (existing) return
    const next =
      ((yield* db
        .select({ value: max(OpencodeXStateEventTable.aggregate_sequence) })
        .from(OpencodeXStateEventTable)
        .where(and(whereScope(scope), eq(OpencodeXStateEventTable.aggregate_id, aggregate)))
        .get()
        .pipe(Effect.orDie))?.value ?? -1) + 1
    yield* db
      .insert(OpencodeXStateEventTable)
      .values({
        id: event.id,
        project_id: scope.projectID,
        workspace_id: scope.workspaceID,
        directory: scope.directory,
        aggregate_id: aggregate,
        aggregate_sequence: next,
        domain: eventDomain,
        event_type: event.type,
        operation: "invalidate",
        payload: { aggregateID: aggregate, eventType: event.type },
        created_at: Date.now(),
      })
      .onConflictDoNothing({ target: OpencodeXStateEventTable.id })
      .run()
      .pipe(Effect.orDie)
    yield* prune(scope)
  })

  const unsubscribeSync = yield* events.sync(persistStateEvent, (event) => durableDomain(event) !== undefined)
  const unsubscribeListener = yield* events.listen((event) =>
    Effect.gen(function* () {
      const row = yield* db
        .select()
        .from(OpencodeXStateEventTable)
        .where(eq(OpencodeXStateEventTable.id, event.id))
        .get()
        .pipe(Effect.orDie)
      if (!row) return
      const persisted = hydrateStateEvent(row)
      listeners.forEach((listener) => listener(persisted))
    }),
  )
  yield* Effect.addFinalizer(() => Effect.all([unsubscribeSync, unsubscribeListener], { discard: true }))

  const listen: StateLog["listen"] = (listener) =>
    Effect.sync(() => {
      listeners.push(listener)
      return Effect.sync(() => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      })
    })

  const replay = Effect.fn("OpencodeXState.replay")(function* (after?: string) {
    const scope = yield* currentStateScope()
    const latest = yield* position(scope)
    if (!after) return { reset: false as const, events: [], cursor: encodeCursor(scope, latest) }
    const decoded = Option.getOrUndefined(decodeCursorPayload(Buffer.from(after, "base64url").toString()))
    if (!decoded || decoded.epoch !== EPOCH || !sameScope(decoded.scope, scope)) {
      return { reset: true as const, reason: "cursor epoch or scope mismatch", cursor: encodeCursor(scope, latest) }
    }
    if (decoded.position > latest) {
      return { reset: true as const, reason: "cursor is not satisfiable", cursor: encodeCursor(scope, latest) }
    }
    const retained =
      decoded.position === 0 ||
      Boolean(
        yield* db
          .select({ position: OpencodeXStateEventTable.position })
          .from(OpencodeXStateEventTable)
          .where(and(whereScope(scope), eq(OpencodeXStateEventTable.position, decoded.position)))
          .get()
          .pipe(Effect.orDie),
      )
    if (!retained) {
      return { reset: true as const, reason: "cursor is not retained", cursor: encodeCursor(scope, latest) }
    }
    const rows = yield* db
      .select()
      .from(OpencodeXStateEventTable)
      .where(and(whereScope(scope), gt(OpencodeXStateEventTable.position, decoded.position)))
      .orderBy(asc(OpencodeXStateEventTable.position))
      .all()
      .pipe(Effect.orDie)
    return { reset: false as const, events: rows.map(hydrateStateEvent), cursor: encodeCursor(scope, latest) }
  })

  return { scope: currentStateScope, position, revisionVector, cursor, replay, listen } satisfies StateLog
})

import { OpencodeXViewSessionTable, OpencodeXViewTable } from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Context, Effect, Layer, Option, Schema, Semaphore, Struct } from "effect"
import { and, asc, eq, inArray, max } from "drizzle-orm"
import { renderableSessionWhere } from "./session-filter"

const Metadata = Schema.Record(Schema.String, Schema.Any)
const decodeMetadata = Schema.decodeUnknownOption(Schema.fromJsonString(Metadata))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasPendingSessions(metadata: Record<string, unknown> | undefined) {
  const opencodex = metadata?.opencodex
  if (!isRecord(opencodex)) return false
  const pending = opencodex.pendingSessions
  return Array.isArray(pending) && pending.length > 0
}

export const SessionAssignment = Schema.Struct({
  sessionID: SessionID,
  sortOrder: Schema.Number,
}).annotate({ identifier: "OpencodeXViewSessionAssignment" })
export type SessionAssignment = Schema.Schema.Type<typeof SessionAssignment>

export const Info = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  focusedSessionID: Schema.optional(SessionID),
  layout: Schema.String,
  sessions: Schema.Array(Session.GlobalInfo),
  sessionIDs: Schema.Array(SessionID),
  metadata: Schema.optional(Metadata),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "OpencodeXView" })
export type Info = Schema.Schema.Type<typeof Info>

export const CatalogInfo = Schema.Struct({
  ...Struct.omit(Info.fields, ["sessions"]),
}).annotate({ identifier: "OpencodeXCatalogView" })
export type CatalogInfo = Schema.Schema.Type<typeof CatalogInfo>

export const CreateInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  sessionIDs: Schema.Array(SessionID),
  focusedSessionID: Schema.optional(SessionID),
  layout: Schema.optional(Schema.String),
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXViewCreateInput" })
export type CreateInput = Schema.Schema.Type<typeof CreateInput>

export const UpdateInput = Schema.Struct({
  id: Schema.String,
  expectedTimeUpdated: NonNegativeInt,
  title: Schema.optional(Schema.String),
  sessionIDs: Schema.optional(Schema.Array(SessionID)),
  focusedSessionID: Schema.optional(SessionID),
  layout: Schema.optional(Schema.String),
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXViewUpdateInput" })
export type UpdateInput = Schema.Schema.Type<typeof UpdateInput>

export const ReorderInput = Schema.Struct({
  viewIDs: Schema.Array(Schema.String),
}).annotate({ identifier: "OpencodeXViewReorderInput" })
export type ReorderInput = Schema.Schema.Type<typeof ReorderInput>

export const Event = {
  Created: EventV2.define({
    type: "opencodex.view.created",
    sync: { aggregate: "viewID", version: 1 },
    schema: { viewID: Schema.String },
  }),
  Updated: EventV2.define({
    type: "opencodex.view.updated",
    sync: { aggregate: "viewID", version: 1 },
    schema: { viewID: Schema.String },
  }),
  Reordered: EventV2.define({
    type: "opencodex.view.reordered",
    sync: { aggregate: "collectionID", version: 1 },
    schema: { collectionID: Schema.String },
  }),
  Deleted: EventV2.define({
    type: "opencodex.view.deleted",
    sync: { aggregate: "viewID", version: 1 },
    schema: { viewID: Schema.String },
  }),
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("OpencodeX.View.NotFoundError", {
  viewID: Schema.String,
}) {}

export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()("OpencodeX.View.ValidationError", {
  message: Schema.String,
}) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("OpencodeX.View.ConflictError", {
  viewID: Schema.String,
}) {}

export interface Interface {
  readonly list: (input?: { sessions?: Session.GlobalInfo[] }) => Effect.Effect<Info[]>
  readonly listCatalog: () => Effect.Effect<CatalogInfo[]>
  readonly get: (viewID: string) => Effect.Effect<Info, NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info, ValidationError | Session.NotFound>
  readonly update: (
    input: UpdateInput,
  ) => Effect.Effect<Info, NotFoundError | ValidationError | ConflictError | Session.NotFound>
  readonly reorder: (input: ReorderInput) => Effect.Effect<Info[]>
  readonly remove: (viewID: string) => Effect.Effect<boolean, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXView") {}

function serializeMetadata(metadata: Record<string, unknown> | undefined) {
  return metadata ? JSON.stringify(metadata) : undefined
}

function normalizeSessionIDs(sessionIDs: readonly SessionID[]) {
  return [...new Set(sessionIDs)]
}

function validateSessionIDs(sessionIDs: readonly SessionID[], options?: { allowEmpty?: boolean }) {
  const normalized = normalizeSessionIDs(sessionIDs)
  if (normalized.length === 0 && !options?.allowEmpty) {
    return Effect.fail(new ValidationError({ message: "A view needs at least one session." }))
  }
  if (normalized.length > 8) {
    return Effect.fail(new ValidationError({ message: "A view can include at most eight sessions." }))
  }
  return Effect.succeed(normalized)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const session = yield* Session.Service
    const events = yield* EventV2Bridge.Service
    const mutationLock = Semaphore.makeUnsafe(1)

    const listAssignments = Effect.fn("OpencodeXView.listAssignments")(function* (
      rows: (typeof OpencodeXViewTable.$inferSelect)[],
    ) {
      if (rows.length === 0) return []
      return yield* db
        .select({
          view_id: OpencodeXViewSessionTable.view_id,
          session_id: OpencodeXViewSessionTable.session_id,
          sort_order: OpencodeXViewSessionTable.sort_order,
        })
        .from(OpencodeXViewSessionTable)
        .innerJoin(SessionTable, eq(SessionTable.id, OpencodeXViewSessionTable.session_id))
        .where(
          and(
            inArray(
              OpencodeXViewSessionTable.view_id,
              rows.map((row) => row.id),
            ),
            renderableSessionWhere(),
          ),
        )
        .orderBy(OpencodeXViewSessionTable.view_id, OpencodeXViewSessionTable.sort_order)
        .all()
        .pipe(Effect.orDie)
    })

    const hydrateMany = Effect.fn("OpencodeXView.hydrateMany")(function* (
      rows: (typeof OpencodeXViewTable.$inferSelect)[],
      input?: { sessions?: Session.GlobalInfo[] },
    ) {
      if (rows.length === 0) return []
      const assignments = yield* listAssignments(rows)
      const all =
        assignments.length === 0
          ? []
          : (input?.sessions ?? (yield* session.listGlobalByIDs(assignments.map((item) => item.session_id))))
      const byID = new Map(all.map((item) => [item.id, item]))
      const byView = Map.groupBy(assignments, (assignment) => assignment.view_id)
      return rows.map((row) => {
        const assigned = byView.get(row.id) ?? []
        const sessions = assigned
          .map((assignment) => byID.get(assignment.session_id))
          .filter((item): item is Session.GlobalInfo => item !== undefined)
        return {
          id: row.id,
          title: row.title,
          focusedSessionID:
            row.focused_session_id && assigned.some((item) => item.session_id === row.focused_session_id)
              ? row.focused_session_id
              : assigned[0]?.session_id,
          layout: row.layout,
          sessions,
          sessionIDs: assigned.map((item) => item.session_id),
          metadata: row.metadata_json ? Option.getOrUndefined(decodeMetadata(row.metadata_json)) : undefined,
          timeCreated: row.time_created,
          timeUpdated: row.time_updated,
        }
      })
    })

    const hydrateCatalogMany = Effect.fn("OpencodeXView.hydrateCatalogMany")(function* (
      rows: (typeof OpencodeXViewTable.$inferSelect)[],
    ) {
      const byView = Map.groupBy(yield* listAssignments(rows), (assignment) => assignment.view_id)
      return rows.map((row) => {
        const sessionIDs = (byView.get(row.id) ?? []).map((assignment) => assignment.session_id)
        return {
          id: row.id,
          title: row.title,
          focusedSessionID:
            row.focused_session_id && sessionIDs.includes(row.focused_session_id)
              ? row.focused_session_id
              : sessionIDs[0],
          layout: row.layout,
          sessionIDs,
          metadata: row.metadata_json ? Option.getOrUndefined(decodeMetadata(row.metadata_json)) : undefined,
          timeCreated: row.time_created,
          timeUpdated: row.time_updated,
        }
      })
    })

    const hydrate = Effect.fn("OpencodeXView.hydrate")(function* (row: typeof OpencodeXViewTable.$inferSelect) {
      return (yield* hydrateMany([row]))[0]
    })

    const replaceSessions = Effect.fnUntraced(function* (
      database: Parameters<Parameters<Database.Interface["db"]["transaction"]>[0]>[0],
      viewID: string,
      sessionIDs: readonly SessionID[],
    ) {
      const now = Date.now()
      yield* database.delete(OpencodeXViewSessionTable).where(eq(OpencodeXViewSessionTable.view_id, viewID)).run()
      if (sessionIDs.length === 0) return
      yield* database
        .insert(OpencodeXViewSessionTable)
        .values(
          sessionIDs.map((sessionID, index) => ({
            view_id: viewID,
            session_id: sessionID,
            sort_order: index,
            time_created: now,
            time_updated: now,
          })),
        )
        .run()
    })

    const list = Effect.fn("OpencodeXView.list")(function* (input?: { sessions?: Session.GlobalInfo[] }) {
      return yield* hydrateMany(
        yield* db
          .select()
          .from(OpencodeXViewTable)
          .orderBy(asc(OpencodeXViewTable.sort_order), asc(OpencodeXViewTable.time_created), asc(OpencodeXViewTable.id))
          .all()
          .pipe(Effect.orDie),
        input,
      )
    })

    const listCatalog = Effect.fn("OpencodeXView.listCatalog")(function* () {
      return yield* hydrateCatalogMany(
        yield* db
          .select()
          .from(OpencodeXViewTable)
          .orderBy(asc(OpencodeXViewTable.sort_order), asc(OpencodeXViewTable.time_created), asc(OpencodeXViewTable.id))
          .all()
          .pipe(Effect.orDie),
      )
    })

    const get = Effect.fn("OpencodeXView.get")(function* (viewID: string) {
      const row = yield* db
        .select()
        .from(OpencodeXViewTable)
        .where(eq(OpencodeXViewTable.id, viewID))
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ viewID })
      return yield* hydrate(row)
    })

    const createUnlocked = Effect.fnUntraced(function* (input: CreateInput) {
      const sessionIDs = yield* validateSessionIDs(input.sessionIDs, { allowEmpty: hasPendingSessions(input.metadata) })
      const focusedSessionID =
        input.focusedSessionID && sessionIDs.includes(input.focusedSessionID) ? input.focusedSessionID : sessionIDs[0]
      yield* Effect.forEach(sessionIDs, (sessionID) => session.get(sessionID), {
        concurrency: "unbounded",
        discard: true,
      })
      const now = Date.now()
      const id = input.id ?? `oxv_${Identifier.ascending()}`
      const event = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              const sortOrder =
                ((yield* transaction.select({ value: max(OpencodeXViewTable.sort_order) }).from(OpencodeXViewTable).get())
                  ?.value ?? -1) + 1
              yield* transaction
                .insert(OpencodeXViewTable)
                .values({
                  id,
                  title: input.title?.trim() || "Multi-session view",
                  focused_session_id: focusedSessionID,
                  layout: input.layout ?? "auto",
                  sort_order: sortOrder,
                  metadata_json: serializeMetadata(input.metadata),
                  time_created: now,
                  time_updated: now,
                })
                .run()
              yield* replaceSessions(transaction, id, sessionIDs)
              return yield* events.commit(Event.Created, { viewID: id })
            }),
          { behavior: "immediate" },
        ).pipe(
          Effect.catchTag("SqlError", Effect.die),
          Effect.catchTag("EffectDrizzleQueryError", Effect.die),
        ),
      )
      const result = yield* get(id).pipe(Effect.orDie)
      yield* events.broadcast(event)
      return result
    })

    const create = Effect.fn("OpencodeXView.create")(function* (input: CreateInput) {
      return yield* mutationLock.withPermits(1)(createUnlocked(input))
    })

    const updateUnlocked = Effect.fnUntraced(function* (input: UpdateInput) {
      const requestedSessionIDs = input.sessionIDs ? normalizeSessionIDs(input.sessionIDs) : undefined
      if (requestedSessionIDs) {
        yield* Effect.forEach(requestedSessionIDs, (sessionID) => session.get(sessionID), {
          concurrency: "unbounded",
          discard: true,
        })
      }
      const event = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              const current = yield* transaction
                .select()
                .from(OpencodeXViewTable)
                .where(eq(OpencodeXViewTable.id, input.id))
                .get()
              if (!current) return yield* new NotFoundError({ viewID: input.id })
              if (current.time_updated !== input.expectedTimeUpdated) {
                return yield* new ConflictError({ viewID: input.id })
              }
              const currentSessionIDs = (
                yield* transaction
                  .select({ sessionID: OpencodeXViewSessionTable.session_id })
                  .from(OpencodeXViewSessionTable)
                  .where(eq(OpencodeXViewSessionTable.view_id, input.id))
                  .orderBy(asc(OpencodeXViewSessionTable.sort_order))
                  .all()
              ).map((item) => item.sessionID)
              const metadata =
                input.metadata ??
                (current.metadata_json ? Option.getOrUndefined(decodeMetadata(current.metadata_json)) : undefined)
              const sessionIDs = yield* validateSessionIDs(requestedSessionIDs ?? currentSessionIDs, {
                allowEmpty: hasPendingSessions(metadata),
              })
              const focusedSessionID =
                input.focusedSessionID && sessionIDs.includes(input.focusedSessionID)
                  ? input.focusedSessionID
                  : current.focused_session_id && sessionIDs.includes(current.focused_session_id)
                    ? current.focused_session_id
                    : sessionIDs[0]
              if (requestedSessionIDs) yield* replaceSessions(transaction, input.id, sessionIDs)
              yield* transaction
                .update(OpencodeXViewTable)
                .set({
                  title: input.title?.trim() || undefined,
                  focused_session_id: focusedSessionID,
                  layout: input.layout,
                  metadata_json: input.metadata ? serializeMetadata(input.metadata) : undefined,
                  time_updated: Math.max(Date.now(), current.time_updated + 1),
                })
                .where(eq(OpencodeXViewTable.id, input.id))
                .run()
              return yield* events.commit(Event.Updated, { viewID: input.id })
            }),
          { behavior: "immediate" },
        ).pipe(
          Effect.catchTag("SqlError", Effect.die),
          Effect.catchTag("EffectDrizzleQueryError", Effect.die),
        ),
      )
      const result = yield* get(input.id)
      yield* events.broadcast(event)
      return result
    })

    const update = Effect.fn("OpencodeXView.update")(function* (input: UpdateInput) {
      return yield* mutationLock.withPermits(1)(updateUnlocked(input))
    })

    const reorderUnlocked = Effect.fnUntraced(function* (input: ReorderInput) {
      const event = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              const current = yield* transaction
                .select()
                .from(OpencodeXViewTable)
                .orderBy(
                  asc(OpencodeXViewTable.sort_order),
                  asc(OpencodeXViewTable.time_created),
                  asc(OpencodeXViewTable.id),
                )
                .all()
              const knownIDs = new Set(current.map((row) => row.id))
              const requestedIDs = [...new Set(input.viewIDs)].filter((id) => knownIDs.has(id))
              const orderedIDs = [
                ...requestedIDs,
                ...current.map((row) => row.id).filter((id) => !requestedIDs.includes(id)),
              ]
              yield* Effect.forEach(
                orderedIDs.map((id, index) => ({ id, index })),
                ({ id, index }) =>
                  transaction
                    .update(OpencodeXViewTable)
                    .set({ sort_order: index, time_updated: Date.now() })
                    .where(eq(OpencodeXViewTable.id, id))
                    .run(),
                { discard: true },
              )
              return yield* events.commit(Event.Reordered, { collectionID: "opencodex.views" })
            }),
          { behavior: "immediate" },
        ).pipe(
          Effect.catchTag("SqlError", Effect.die),
          Effect.catchTag("EffectDrizzleQueryError", Effect.die),
        ),
      )
      const result = yield* list()
      yield* events.broadcast(event)
      return result
    })

    const reorder = Effect.fn("OpencodeXView.reorder")(function* (input: ReorderInput) {
      return yield* mutationLock.withPermits(1)(reorderUnlocked(input))
    })

    const removeUnlocked = Effect.fnUntraced(function* (viewID: string) {
      const event = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              const current = yield* transaction
                .select({ id: OpencodeXViewTable.id })
                .from(OpencodeXViewTable)
                .where(eq(OpencodeXViewTable.id, viewID))
                .get()
              if (!current) return yield* new NotFoundError({ viewID })
              yield* transaction.delete(OpencodeXViewTable).where(eq(OpencodeXViewTable.id, viewID)).run()
              return yield* events.commit(Event.Deleted, { viewID })
            }),
          { behavior: "immediate" },
        ).pipe(
          Effect.catchTag("SqlError", Effect.die),
          Effect.catchTag("EffectDrizzleQueryError", Effect.die),
        ),
      )
      yield* events.broadcast(event)
      return true
    })

    const remove = Effect.fn("OpencodeXView.remove")(function* (viewID: string) {
      return yield* mutationLock.withPermits(1)(removeUnlocked(viewID))
    })

    return Service.of({ list, listCatalog, get, create, update, reorder, remove })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
)

export * as OpencodeXView from "./view"

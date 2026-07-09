import { OpencodeXViewSessionTable, OpencodeXViewTable } from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { asc, eq, inArray, max } from "drizzle-orm"

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

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (viewID: string) => Effect.Effect<Info, NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info, ValidationError | Session.NotFound>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, NotFoundError | ValidationError | Session.NotFound>
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

    const hydrateMany = Effect.fn("OpencodeXView.hydrateMany")(function* (
      rows: (typeof OpencodeXViewTable.$inferSelect)[],
    ) {
      if (rows.length === 0) return []
      const assignments = yield* db
        .select()
        .from(OpencodeXViewSessionTable)
        .where(
          inArray(
            OpencodeXViewSessionTable.view_id,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(OpencodeXViewSessionTable.view_id, OpencodeXViewSessionTable.sort_order)
        .all()
        .pipe(Effect.orDie)
      const all = assignments.length === 0 ? [] : yield* session.listGlobal({ limit: 5_000 })
      const byID = new Map(all.map((item) => [item.id, item]))
      const byView = Map.groupBy(assignments, (assignment) => assignment.view_id)
      return rows.map((row) => {
        const sessions = (byView.get(row.id) ?? [])
          .map((assignment) => byID.get(assignment.session_id))
          .filter((item): item is Session.GlobalInfo => item !== undefined)
        return {
          id: row.id,
          title: row.title,
          focusedSessionID: row.focused_session_id ?? sessions[0]?.id,
          layout: row.layout,
          sessions,
          sessionIDs: sessions.map((item) => item.id),
          metadata: row.metadata_json ? Option.getOrUndefined(decodeMetadata(row.metadata_json)) : undefined,
          timeCreated: row.time_created,
          timeUpdated: row.time_updated,
        }
      })
    })

    const hydrate = Effect.fn("OpencodeXView.hydrate")(function* (row: typeof OpencodeXViewTable.$inferSelect) {
      return (yield* hydrateMany([row]))[0]!
    })

    const replaceSessions = Effect.fn("OpencodeXView.replaceSessions")(function* (
      viewID: string,
      sessionIDs: readonly SessionID[],
      options?: { allowEmpty?: boolean },
    ) {
      const normalized = yield* validateSessionIDs(sessionIDs, options)
      yield* Effect.forEach(normalized, (sessionID) => session.get(sessionID), {
        concurrency: "unbounded",
        discard: true,
      })
      const now = Date.now()
      yield* db
        .transaction(
          (tx) =>
            Effect.gen(function* () {
              yield* tx.delete(OpencodeXViewSessionTable).where(eq(OpencodeXViewSessionTable.view_id, viewID)).run()
              if (normalized.length > 0) {
                yield* tx
                  .insert(OpencodeXViewSessionTable)
                  .values(
                    normalized.map((sessionID, index) => ({
                      view_id: viewID,
                      session_id: sessionID,
                      sort_order: index,
                      time_created: now,
                      time_updated: now,
                    })),
                  )
                  .run()
              }
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
      return normalized
    })

    const list = Effect.fn("OpencodeXView.list")(function* () {
      return yield* hydrateMany(
        yield* db
          .select()
          .from(OpencodeXViewTable)
          .orderBy(asc(OpencodeXViewTable.sort_order), asc(OpencodeXViewTable.time_created))
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

    const create = Effect.fn("OpencodeXView.create")(function* (input: CreateInput) {
      const sessionIDs = yield* validateSessionIDs(input.sessionIDs, { allowEmpty: hasPendingSessions(input.metadata) })
      const focusedSessionID =
        input.focusedSessionID && sessionIDs.includes(input.focusedSessionID) ? input.focusedSessionID : sessionIDs[0]
      yield* Effect.forEach(sessionIDs, (sessionID) => session.get(sessionID), {
        concurrency: "unbounded",
        discard: true,
      })
      const now = Date.now()
      const id = input.id ?? `oxv_${Identifier.ascending()}`
      const sortOrder =
        ((yield* db
          .select({ value: max(OpencodeXViewTable.sort_order) })
          .from(OpencodeXViewTable)
          .get()
          .pipe(Effect.orDie))?.value ?? -1) + 1
      yield* db
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
        .pipe(Effect.orDie)
      yield* replaceSessions(id, sessionIDs, { allowEmpty: hasPendingSessions(input.metadata) })
      const result = yield* get(id).pipe(Effect.orDie)
      yield* events.publish(Event.Created, { viewID: id })
      return result
    })

    const update = Effect.fn("OpencodeXView.update")(function* (input: UpdateInput) {
      const current = yield* get(input.id)
      const metadata = input.metadata ?? current.metadata
      const sessionIDs = input.sessionIDs
        ? yield* replaceSessions(input.id, input.sessionIDs, { allowEmpty: hasPendingSessions(metadata) })
        : current.sessionIDs
      const focusedSessionID =
        input.focusedSessionID && sessionIDs.includes(input.focusedSessionID)
          ? input.focusedSessionID
          : current.focusedSessionID && sessionIDs.includes(current.focusedSessionID)
            ? current.focusedSessionID
            : sessionIDs[0]
      const result = yield* db
        .update(OpencodeXViewTable)
        .set({
          title: input.title?.trim() || undefined,
          focused_session_id: focusedSessionID,
          layout: input.layout,
          metadata_json: input.metadata ? serializeMetadata(input.metadata) : undefined,
          time_updated: Date.now(),
        })
        .where(eq(OpencodeXViewTable.id, input.id))
        .returning()
        .get()
        .pipe(Effect.orDie, Effect.flatMap(hydrate))
      yield* events.publish(Event.Updated, { viewID: input.id })
      return result
    })

    const reorder = Effect.fn("OpencodeXView.reorder")(function* (input: ReorderInput) {
      const current = yield* db
        .select()
        .from(OpencodeXViewTable)
        .orderBy(asc(OpencodeXViewTable.sort_order), asc(OpencodeXViewTable.time_created))
        .all()
        .pipe(Effect.orDie)
      const knownIDs = new Set(current.map((row) => row.id))
      const requestedIDs = [...new Set(input.viewIDs)].filter((id) => knownIDs.has(id))
      const orderedIDs = [...requestedIDs, ...current.map((row) => row.id).filter((id) => !requestedIDs.includes(id))]
      yield* Effect.forEach(
        orderedIDs.map((id, index) => ({ id, index })),
        ({ id, index }) =>
          db
            .update(OpencodeXViewTable)
            .set({ sort_order: index })
            .where(eq(OpencodeXViewTable.id, id))
            .run()
            .pipe(Effect.orDie),
        { discard: true },
      )
      const result = yield* list()
      yield* events.publish(Event.Reordered, { collectionID: "opencodex.views" })
      return result
    })

    const remove = Effect.fn("OpencodeXView.remove")(function* (viewID: string) {
      yield* get(viewID)
      yield* db.delete(OpencodeXViewTable).where(eq(OpencodeXViewTable.id, viewID)).run().pipe(Effect.orDie)
      yield* events.publish(Event.Deleted, { viewID })
      return true
    })

    return Service.of({ list, get, create, update, reorder, remove })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
)

export * as OpencodeXView from "./view"

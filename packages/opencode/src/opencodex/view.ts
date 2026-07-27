import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import {
  OpencodeXTerminalSessionTable,
  OpencodeXViewSessionTable,
  OpencodeXViewTable,
  OpencodeXViewTerminalSessionTable,
} from "@opencode-ai/core/opencodex/sql"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { and, asc, eq, inArray, max } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema, Semaphore, Struct } from "effect"
import { renderableSessionWhere } from "./session-filter"
import { OpencodeXTerminalSession } from "./terminal-session"
import {
  Member,
  memberValidationMessage,
  normalizeMembers,
  replaceLegacySessionSlots,
  resolveFocus,
  sessionMembers,
} from "./view-member"

const Metadata = Schema.Record(Schema.String, Schema.Any)
const decodeMetadata = Schema.decodeUnknownOption(Schema.fromJsonString(Metadata))

export const SessionAssignment = Schema.Struct({
  sessionID: SessionID,
  sortOrder: Schema.Number,
}).annotate({ identifier: "OpencodeXViewSessionAssignment" })
export type SessionAssignment = Schema.Schema.Type<typeof SessionAssignment>

export const TerminalSessionAssignment = Schema.Struct({
  terminalSessionID: Schema.String,
  sortOrder: Schema.Number,
}).annotate({ identifier: "OpencodeXViewTerminalSessionAssignment" })
export type TerminalSessionAssignment = Schema.Schema.Type<typeof TerminalSessionAssignment>

export const Info = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  focusedSessionID: Schema.optional(SessionID),
  focusedItemID: Schema.optional(Schema.String),
  layout: Schema.String,
  sessions: Schema.Array(Session.GlobalInfo),
  terminalSessions: Schema.Array(OpencodeXTerminalSession.Info),
  sessionIDs: Schema.Array(SessionID),
  members: Schema.Array(Member),
  metadata: Schema.optional(Metadata),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "OpencodeXView" })
export type Info = Schema.Schema.Type<typeof Info>

export const CatalogInfo = Schema.Struct({
  ...Struct.omit(Info.fields, ["sessions", "terminalSessions"]),
}).annotate({ identifier: "OpencodeXCatalogView" })
export type CatalogInfo = Schema.Schema.Type<typeof CatalogInfo>

export const CreateInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  sessionIDs: Schema.optional(Schema.Array(SessionID)),
  members: Schema.optional(Schema.Array(Member)),
  focusedSessionID: Schema.optional(SessionID),
  focusedItemID: Schema.optional(Schema.String),
  layout: Schema.optional(Schema.String),
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXViewCreateInput" })
export type CreateInput = Schema.Schema.Type<typeof CreateInput>

export const UpdateInput = Schema.Struct({
  id: Schema.String,
  expectedTimeUpdated: NonNegativeInt,
  title: Schema.optional(Schema.String),
  sessionIDs: Schema.optional(Schema.Array(SessionID)),
  members: Schema.optional(Schema.Array(Member)),
  focusedSessionID: Schema.optional(SessionID),
  focusedItemID: Schema.optional(Schema.String),
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
  readonly list: (input?: {
    sessions?: Session.GlobalInfo[]
    terminalSessions?: OpencodeXTerminalSession.Info[]
  }) => Effect.Effect<Info[]>
  readonly listCatalog: () => Effect.Effect<CatalogInfo[]>
  readonly get: (viewID: string) => Effect.Effect<Info, NotFoundError>
  readonly create: (
    input: CreateInput,
  ) => Effect.Effect<Info, ValidationError | Session.NotFound | OpencodeXTerminalSession.NotFoundError>
  readonly update: (
    input: UpdateInput,
  ) => Effect.Effect<
    Info,
    NotFoundError | ValidationError | ConflictError | Session.NotFound | OpencodeXTerminalSession.NotFoundError
  >
  readonly reorder: (input: ReorderInput) => Effect.Effect<Info[]>
  readonly remove: (viewID: string) => Effect.Effect<boolean, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXView") {}

type Assignment = {
  view_id: string
  kind: "session" | "terminal"
  id: string
  sort_order: number
}

type Transaction = Parameters<Parameters<Database.Interface["db"]["transaction"]>[0]>[0]
type DatabaseService = Database.Interface["db"] | Transaction

function serializeMetadata(metadata: Record<string, unknown> | undefined) {
  return metadata ? JSON.stringify(metadata) : undefined
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const session = yield* Session.Service
    const terminalSession = yield* OpencodeXTerminalSession.Service
    const events = yield* EventV2Bridge.Service
    const mutationLock = Semaphore.makeUnsafe(1)

    const listAssignments = Effect.fn("OpencodeXView.listAssignments")(function* (
      rows: (typeof OpencodeXViewTable.$inferSelect)[],
    ) {
      if (rows.length === 0) return []
      const viewIDs = rows.map((row) => row.id)
      const [sessions, terminals] = yield* Effect.all(
        [
          db
            .select({
              view_id: OpencodeXViewSessionTable.view_id,
              id: OpencodeXViewSessionTable.session_id,
              sort_order: OpencodeXViewSessionTable.sort_order,
            })
            .from(OpencodeXViewSessionTable)
            .innerJoin(SessionTable, eq(SessionTable.id, OpencodeXViewSessionTable.session_id))
            .where(and(inArray(OpencodeXViewSessionTable.view_id, viewIDs), renderableSessionWhere()))
            .all()
            .pipe(Effect.orDie),
          db
            .select({
              view_id: OpencodeXViewTerminalSessionTable.view_id,
              id: OpencodeXViewTerminalSessionTable.terminal_session_id,
              sort_order: OpencodeXViewTerminalSessionTable.sort_order,
            })
            .from(OpencodeXViewTerminalSessionTable)
            .innerJoin(
              OpencodeXTerminalSessionTable,
              eq(OpencodeXTerminalSessionTable.id, OpencodeXViewTerminalSessionTable.terminal_session_id),
            )
            .where(inArray(OpencodeXViewTerminalSessionTable.view_id, viewIDs))
            .all()
            .pipe(Effect.orDie),
        ],
        { concurrency: "unbounded" },
      )
      return [
        ...sessions.map((assignment) => ({ ...assignment, kind: "session" as const })),
        ...terminals.map((assignment) => ({ ...assignment, kind: "terminal" as const })),
      ].sort((a, b) => a.view_id.localeCompare(b.view_id) || a.sort_order - b.sort_order || a.id.localeCompare(b.id))
    })

    const hydrateMany = Effect.fn("OpencodeXView.hydrateMany")(function* (
      rows: (typeof OpencodeXViewTable.$inferSelect)[],
      input?: { sessions?: Session.GlobalInfo[]; terminalSessions?: OpencodeXTerminalSession.Info[] },
    ) {
      if (rows.length === 0) return []
      const assignments = yield* listAssignments(rows)
      const sessionIDs = assignments.filter((item) => item.kind === "session").map((item) => SessionID.make(item.id))
      const terminalSessionIDs = assignments.filter((item) => item.kind === "terminal").map((item) => item.id)
      const [allSessions, allTerminals] = yield* Effect.all(
        [
          input?.sessions ? Effect.succeed(input.sessions) : session.listGlobalByIDs(sessionIDs),
          input?.terminalSessions
            ? Effect.succeed(input.terminalSessions)
            : terminalSession.listByIDs(terminalSessionIDs),
        ],
        { concurrency: "unbounded" },
      )
      const sessionByID = new Map(allSessions.map((item) => [item.id, item]))
      const terminalByID = new Map(allTerminals.map((item) => [item.id, item]))
      const byView = Map.groupBy(assignments, (assignment) => assignment.view_id)
      return rows.map((row) => hydrateRow(row, byView.get(row.id) ?? [], sessionByID, terminalByID))
    })

    const hydrateCatalogMany = Effect.fn("OpencodeXView.hydrateCatalogMany")(function* (
      rows: (typeof OpencodeXViewTable.$inferSelect)[],
    ) {
      const byView = Map.groupBy(yield* listAssignments(rows), (assignment) => assignment.view_id)
      return rows.map((row) => hydrateCatalogRow(row, byView.get(row.id) ?? []))
    })

    const list = Effect.fn("OpencodeXView.list")(function* (input?: {
      sessions?: Session.GlobalInfo[]
      terminalSessions?: OpencodeXTerminalSession.Info[]
    }) {
      return yield* hydrateMany(yield* listRows(db), input)
    })

    const listCatalog = Effect.fn("OpencodeXView.listCatalog")(function* () {
      return yield* hydrateCatalogMany(yield* listRows(db))
    })

    const get = Effect.fn("OpencodeXView.get")(function* (viewID: string) {
      const row = yield* db.select().from(OpencodeXViewTable).where(eq(OpencodeXViewTable.id, viewID)).get().pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ viewID })
      return (yield* hydrateMany([row]))[0]
    })

    const validateMembers = Effect.fn("OpencodeXView.validateMembers")(function* (
      requested: readonly Member[],
      metadata: Record<string, unknown> | undefined,
    ) {
      const members = normalizeMembers(requested)
      const validation = memberValidationMessage(members, metadata)
      if (validation) return yield* new ValidationError({ message: validation })
      yield* Effect.forEach(
        members,
        (member) => validateMemberEntity(member, session, terminalSession),
        { concurrency: "unbounded", discard: true },
      )
      return members
    })

    const createUnlocked = Effect.fnUntraced(function* (input: CreateInput) {
      const members = yield* validateMembers(input.members ?? sessionMembers(input.sessionIDs ?? []), input.metadata)
      const focus = resolveFocus(members, input.focusedItemID, input.focusedSessionID)
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
                  focused_session_id: focus.focusedSessionID,
                  focused_item_id: focus.focusedItemID,
                  layout: input.layout ?? "auto",
                  sort_order: sortOrder,
                  metadata_json: serializeMetadata(input.metadata),
                  time_created: now,
                  time_updated: now,
                })
                .run()
              yield* replaceMembers(transaction, id, members)
              return yield* events.commit(Event.Created, { viewID: id })
            }),
          { behavior: "immediate" },
        ).pipe(Effect.catchTag("SqlError", Effect.die), Effect.catchTag("EffectDrizzleQueryError", Effect.die)),
      )
      const result = yield* get(id).pipe(Effect.orDie)
      yield* events.broadcast(event)
      return result
    })

    const create = Effect.fn("OpencodeXView.create")(function* (input: CreateInput) {
      return yield* mutationLock.withPermits(1)(createUnlocked(input))
    })

    const updateUnlocked = Effect.fnUntraced(function* (input: UpdateInput) {
      if (input.members !== undefined) yield* validateMemberEntities(input.members, session, terminalSession)
      if (input.members === undefined && input.sessionIDs !== undefined) {
        yield* Effect.forEach(input.sessionIDs, (sessionID) => session.get(sessionID), {
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
              if (current.time_updated !== input.expectedTimeUpdated) return yield* new ConflictError({ viewID: input.id })
              const currentMembers = yield* readStoredMembers(transaction, input.id)
              const metadata =
                input.metadata ??
                (current.metadata_json ? Option.getOrUndefined(decodeMetadata(current.metadata_json)) : undefined)
              const members = normalizeMembers(
                input.members ??
                  (input.sessionIDs === undefined
                    ? currentMembers
                    : replaceLegacySessionSlots(currentMembers, input.sessionIDs)),
              )
              // Re-validate only what the request touches. A stored view that
              // predates the cap must stay renamable - rejecting its current
              // membership on a title-only PATCH would leave no way to fix it.
              const touchesMembership =
                input.members !== undefined || input.sessionIDs !== undefined || input.metadata !== undefined
              const validation = touchesMembership ? memberValidationMessage(members, metadata) : undefined
              if (validation) return yield* new ValidationError({ message: validation })
              const requestedFocus =
                (input.focusedItemID && members.some((member) => member.id === input.focusedItemID)
                  ? input.focusedItemID
                  : undefined) ??
                (input.focusedSessionID &&
                members.some((member) => member.kind === "session" && member.id === input.focusedSessionID)
                  ? input.focusedSessionID
                  : undefined) ??
                (current.focused_item_id && members.some((member) => member.id === current.focused_item_id)
                  ? current.focused_item_id
                  : current.focused_session_id ?? undefined)
              const focus = resolveFocus(members, requestedFocus)
              if (input.members !== undefined || input.sessionIDs !== undefined) {
                yield* replaceMembers(transaction, input.id, members)
              }
              yield* transaction
                .update(OpencodeXViewTable)
                .set({
                  title: input.title?.trim() || undefined,
                  focused_session_id: focus.focusedSessionID,
                  focused_item_id: focus.focusedItemID,
                  layout: input.layout,
                  metadata_json: input.metadata === undefined ? undefined : serializeMetadata(input.metadata),
                  time_updated: Math.max(Date.now(), current.time_updated + 1),
                })
                .where(eq(OpencodeXViewTable.id, input.id))
                .run()
              return yield* events.commit(Event.Updated, { viewID: input.id })
            }),
          { behavior: "immediate" },
        ).pipe(Effect.catchTag("SqlError", Effect.die), Effect.catchTag("EffectDrizzleQueryError", Effect.die)),
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
              const current = yield* listRows(transaction)
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
        ).pipe(Effect.catchTag("SqlError", Effect.die), Effect.catchTag("EffectDrizzleQueryError", Effect.die)),
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
        ).pipe(Effect.catchTag("SqlError", Effect.die), Effect.catchTag("EffectDrizzleQueryError", Effect.die)),
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

function hydrateRow(
  row: typeof OpencodeXViewTable.$inferSelect,
  assignments: Assignment[],
  sessionByID: ReadonlyMap<string, Session.GlobalInfo>,
  terminalByID: ReadonlyMap<string, OpencodeXTerminalSession.Info>,
) {
  const members = assignments.map(toMember)
  const requestedFocus =
    (row.focused_item_id && members.some((member) => member.id === row.focused_item_id)
      ? row.focused_item_id
      : undefined) ?? row.focused_session_id ?? undefined
  const focus = resolveFocus(members, requestedFocus)
  return {
    id: row.id,
    title: row.title,
    ...focus,
    layout: row.layout,
    sessions: assignments.flatMap((assignment) =>
      assignment.kind === "session" ? (sessionByID.get(assignment.id) ?? []) : [],
    ),
    terminalSessions: assignments.flatMap((assignment) =>
      assignment.kind === "terminal" ? (terminalByID.get(assignment.id) ?? []) : [],
    ),
    sessionIDs: members.flatMap((member) => (member.kind === "session" ? [member.id] : [])),
    members,
    metadata: row.metadata_json ? Option.getOrUndefined(decodeMetadata(row.metadata_json)) : undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function hydrateCatalogRow(row: typeof OpencodeXViewTable.$inferSelect, assignments: Assignment[]): CatalogInfo {
  const members = assignments.map(toMember)
  const requestedFocus =
    (row.focused_item_id && members.some((member) => member.id === row.focused_item_id)
      ? row.focused_item_id
      : undefined) ?? row.focused_session_id ?? undefined
  return {
    id: row.id,
    title: row.title,
    ...resolveFocus(members, requestedFocus),
    layout: row.layout,
    sessionIDs: members.flatMap((member) => (member.kind === "session" ? [member.id] : [])),
    members,
    metadata: row.metadata_json ? Option.getOrUndefined(decodeMetadata(row.metadata_json)) : undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function toMember(assignment: Assignment): Member {
  if (assignment.kind === "terminal") return { kind: "terminal", id: assignment.id }
  return { kind: "session", id: SessionID.make(assignment.id) }
}

function listRows(database: DatabaseService) {
  return database
    .select()
    .from(OpencodeXViewTable)
    .orderBy(asc(OpencodeXViewTable.sort_order), asc(OpencodeXViewTable.time_created), asc(OpencodeXViewTable.id))
    .all()
    .pipe(Effect.orDie)
}

function readStoredMembers(
  database: Transaction,
  viewID: string,
): Effect.Effect<Member[]> {
  return Effect.gen(function* () {
    const [sessions, terminals] = yield* Effect.all([
      database
        .select({ id: OpencodeXViewSessionTable.session_id, sortOrder: OpencodeXViewSessionTable.sort_order })
        .from(OpencodeXViewSessionTable)
        .where(eq(OpencodeXViewSessionTable.view_id, viewID))
        .all(),
      database
        .select({ id: OpencodeXViewTerminalSessionTable.terminal_session_id, sortOrder: OpencodeXViewTerminalSessionTable.sort_order })
        .from(OpencodeXViewTerminalSessionTable)
        .where(eq(OpencodeXViewTerminalSessionTable.view_id, viewID))
        .all(),
    ])
    return [
      ...sessions.map((item) => ({ kind: "session" as const, ...item })),
      ...terminals.map((item) => ({ kind: "terminal" as const, ...item })),
    ]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map<Member>(({ kind, id }) =>
        kind === "session" ? { kind, id: SessionID.make(id) } : { kind, id },
      )
  }).pipe(Effect.orDie)
}

function replaceMembers(
  database: Transaction,
  viewID: string,
  members: readonly Member[],
) {
  return Effect.gen(function* () {
    const now = Date.now()
    yield* database.delete(OpencodeXViewSessionTable).where(eq(OpencodeXViewSessionTable.view_id, viewID)).run()
    yield* database
      .delete(OpencodeXViewTerminalSessionTable)
      .where(eq(OpencodeXViewTerminalSessionTable.view_id, viewID))
      .run()
    const sessions = members.flatMap((member, sortOrder) =>
      member.kind === "session"
        ? [{ view_id: viewID, session_id: member.id, sort_order: sortOrder, time_created: now, time_updated: now }]
        : [],
    )
    const terminals = members.flatMap((member, sortOrder) =>
      member.kind === "terminal"
        ? [
            {
              view_id: viewID,
              terminal_session_id: member.id,
              sort_order: sortOrder,
              time_created: now,
              time_updated: now,
            },
          ]
        : [],
    )
    if (sessions.length > 0) yield* database.insert(OpencodeXViewSessionTable).values(sessions).run()
    if (terminals.length > 0) yield* database.insert(OpencodeXViewTerminalSessionTable).values(terminals).run()
  })
}

function validateMemberEntities(
  members: readonly Member[],
  session: Session.Interface,
  terminalSession: OpencodeXTerminalSession.Interface,
) {
  return Effect.forEach(
    normalizeMembers(members),
    (member) => validateMemberEntity(member, session, terminalSession),
    { concurrency: "unbounded", discard: true },
  )
}

function validateMemberEntity(
  member: Member,
  session: Session.Interface,
  terminalSession: OpencodeXTerminalSession.Interface,
): Effect.Effect<void, Session.NotFound | OpencodeXTerminalSession.NotFoundError> {
  if (member.kind === "session") return session.get(member.id).pipe(Effect.asVoid)
  return terminalSession.get(member.id).pipe(Effect.asVoid)
}

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(OpencodeXTerminalSession.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
)

export * as OpencodeXView from "./view"

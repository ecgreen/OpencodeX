import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { OpencodeXStateEventTable } from "@opencode-ai/core/opencodex/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { and, asc, eq, gt, isNull, max } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { MessageV2 } from "@/session/message-v2"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Todo } from "@/session/todo"
import { Snapshot } from "@/snapshot"
import { OpencodeXProject } from "./project"
import { OpencodeXSessionState } from "./session-state"
import { OpencodeXView } from "./view"

export const EPOCH = "2026-07-09.1"

export const OpencodeXStateScope = Schema.Struct({
  projectID: ProjectV2.ID,
  workspaceID: Schema.optional(WorkspaceV2.ID),
  directory: Schema.String,
}).annotate({ identifier: "OpencodeXStateScope" })
export type OpencodeXStateScope = Schema.Schema.Type<typeof OpencodeXStateScope>

export const OpencodeXStateCursor = Schema.String.pipe(Schema.brand("OpencodeXStateCursor")).annotate({
  identifier: "OpencodeXStateCursor",
})
export type OpencodeXStateCursor = Schema.Schema.Type<typeof OpencodeXStateCursor>

const MessagePage = Schema.Struct({
  items: Schema.Array(SessionLegacy.WithParts),
  coverage: Schema.Struct({
    firstMessageID: Schema.optional(Schema.String),
    lastMessageID: Schema.optional(Schema.String),
  }),
  boundary: Schema.Struct({
    hasMore: Schema.Boolean,
    next: Schema.optional(Schema.String),
  }),
})

const StateDomainRevision = Schema.Struct({
  revision: Schema.String,
  digest: Schema.String,
})

export const OpencodeXStateSnapshot = Schema.Struct({
  scope: OpencodeXStateScope,
  epoch: Schema.String,
  cursor: OpencodeXStateCursor,
  digest: Schema.String,
  domains: Schema.Struct({
    catalog: StateDomainRevision,
  }),
  payloads: Schema.Struct({
    catalog: OpencodeXSessionState.SyncSnapshot,
  }),
}).annotate({ identifier: "OpencodeXStateSnapshot" })
export type OpencodeXStateSnapshot = Schema.Schema.Type<typeof OpencodeXStateSnapshot>

export const OpencodeXSessionSnapshot = Schema.Struct({
  scope: OpencodeXStateScope,
  epoch: Schema.String,
  cursor: OpencodeXStateCursor,
  digest: Schema.String,
  session: Session.Info,
  messages: MessagePage,
  todos: Schema.Array(Todo.Info),
  diff: Schema.Array(Snapshot.FileDiff),
  pendingInteractions: Schema.Struct({
    permissions: Schema.Array(Permission.Request),
    questions: Schema.Array(Question.Request),
  }),
}).annotate({ identifier: "OpencodeXSessionSnapshot" })
export type OpencodeXSessionSnapshot = Schema.Schema.Type<typeof OpencodeXSessionSnapshot>

const StateEventPayload = Schema.Struct({
  aggregateID: Schema.String,
  eventType: Schema.String,
})

export const OpencodeXStateEvent = Schema.Struct({
  id: EventV2.ID,
  scope: OpencodeXStateScope,
  epoch: Schema.String,
  cursor: OpencodeXStateCursor,
  aggregateSequence: NonNegativeInt,
  domain: Schema.Literals(["catalog", "session"]),
  operation: Schema.Literal("invalidate"),
  payload: StateEventPayload,
}).annotate({ identifier: "OpencodeXStateEvent" })
export type OpencodeXStateEvent = Schema.Schema.Type<typeof OpencodeXStateEvent>

export const OpencodeXStateStreamFrame = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("ready"),
    scope: OpencodeXStateScope,
    epoch: Schema.String,
    cursor: OpencodeXStateCursor,
  }),
  Schema.Struct({
    type: Schema.Literal("event"),
    event: OpencodeXStateEvent,
  }),
  Schema.Struct({
    type: Schema.Literal("reset_required"),
    scope: OpencodeXStateScope,
    epoch: Schema.String,
    cursor: OpencodeXStateCursor,
    reason: Schema.String,
  }),
]).annotate({ identifier: "OpencodeXStateStreamFrame" })
export type OpencodeXStateStreamFrame = Schema.Schema.Type<typeof OpencodeXStateStreamFrame>

type Replay =
  | { readonly reset: true; readonly reason: string; readonly cursor: OpencodeXStateCursor }
  | { readonly reset: false; readonly events: readonly OpencodeXStateEvent[]; readonly cursor: OpencodeXStateCursor }

export interface Interface {
  readonly scope: () => Effect.Effect<OpencodeXStateScope>
  readonly barrier: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly cursor: () => Effect.Effect<OpencodeXStateCursor>
  readonly replay: (after?: string) => Effect.Effect<Replay>
  readonly listen: (listener: (event: OpencodeXStateEvent) => void) => Effect.Effect<Effect.Effect<void>>
  readonly snapshot: () => Effect.Effect<OpencodeXStateSnapshot>
  readonly session: (input: {
    sessionID: SessionID
    limit?: number
    before?: string
  }) => Effect.Effect<OpencodeXSessionSnapshot, Session.NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXState") {}

const CursorPayload = Schema.Struct({
  epoch: Schema.String,
  scope: OpencodeXStateScope,
  position: NonNegativeInt,
})

function encodeCursor(scope: OpencodeXStateScope, position: number) {
  return OpencodeXStateCursor.make(Buffer.from(JSON.stringify({ epoch: EPOCH, scope, position })).toString("base64url"))
}

function sameScope(left: OpencodeXStateScope, right: OpencodeXStateScope) {
  return (
    left.projectID === right.projectID && left.workspaceID === right.workspaceID && left.directory === right.directory
  )
}

function aggregateID(event: EventV2.Payload) {
  const definition = EventV2.registry.get(event.type)
  const configured = definition?.sync ? (event.data as Record<string, unknown>)[definition.sync.aggregate] : undefined
  if (typeof configured === "string") return configured
  for (const key of ["sessionID", "projectID", "messageID", "requestID", "id"]) {
    const value = (event.data as Record<string, unknown>)[key]
    if (typeof value === "string") return value
  }
  return event.id
}

function domain(event: EventV2.Payload): "catalog" | "session" {
  if (
    (typeof event.data === "object" && event.data !== null && "sessionID" in event.data) ||
    event.type.startsWith("session.") ||
    event.type.startsWith("message.")
  )
    return "session"
  return "catalog"
}

function whereScope(scope: OpencodeXStateScope) {
  return and(
    eq(OpencodeXStateEventTable.project_id, scope.projectID),
    scope.workspaceID === undefined
      ? isNull(OpencodeXStateEventTable.workspace_id)
      : eq(OpencodeXStateEventTable.workspace_id, scope.workspaceID),
    eq(OpencodeXStateEventTable.directory, scope.directory),
  )
}

function hydrate(row: typeof OpencodeXStateEventTable.$inferSelect): OpencodeXStateEvent {
  const scope = {
    projectID: ProjectV2.ID.make(row.project_id),
    ...(row.workspace_id === null ? {} : { workspaceID: WorkspaceV2.ID.make(row.workspace_id) }),
    directory: row.directory,
  }
  return {
    id: EventV2.ID.make(row.id),
    scope,
    epoch: EPOCH,
    cursor: encodeCursor(scope, row.position),
    aggregateSequence: row.aggregate_sequence,
    domain: row.domain === "session" ? "session" : "catalog",
    operation: "invalidate",
    payload: {
      aggregateID: row.aggregate_id,
      eventType: row.event_type,
    },
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const { db } = database
    const events = yield* EventV2Bridge.Service
    const projects = yield* OpencodeXProject.Service
    const sessions = yield* Session.Service
    const views = yield* OpencodeXView.Service
    const statuses = yield* SessionStatus.Service
    const permissions = yield* Permission.Service
    const questions = yield* Question.Service
    const sessionState = yield* OpencodeXSessionState.Service
    const todos = yield* Todo.Service
    const listeners = new Array<(event: OpencodeXStateEvent) => void>()

    const scope = Effect.fn("OpencodeXState.scope")(function* () {
      const instance = yield* InstanceRef
      if (!instance) return yield* Effect.die("OpencodeX state requires an instance scope")
      const workspaceID = yield* WorkspaceRef
      return {
        projectID: ProjectV2.ID.make(instance.project.id),
        ...(workspaceID ? { workspaceID } : {}),
        directory: instance.directory,
      }
    })

    const position = Effect.fn("OpencodeXState.position")(function* (current: OpencodeXStateScope) {
      return (
        (yield* db
          .select({ value: max(OpencodeXStateEventTable.position) })
          .from(OpencodeXStateEventTable)
          .where(whereScope(current))
          .get()
          .pipe(Effect.orDie))?.value ?? 0
      )
    })

    const cursor = Effect.fn("OpencodeXState.cursor")(function* () {
      const current = yield* scope()
      return encodeCursor(current, yield* position(current))
    })

    const unsubscribe = yield* events.listen((event) =>
      Effect.gen(function* () {
        if (
          event.type === MessageV2.Event.PartDelta.type ||
          event.type.startsWith("session.next.") ||
          event.type.startsWith("tui.") ||
          event.type.startsWith("terminal.")
        )
          return
        const instance = yield* InstanceRef
        if (!instance) return
        const workspaceID = event.location?.workspaceID ?? (yield* WorkspaceRef)
        const current = {
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
        const sync = EventV2.registry.get(event.type)?.sync
        const canonical = sync
          ? yield* db
              .select({ seq: EventTable.seq })
              .from(EventTable)
              .where(eq(EventTable.id, event.id))
              .get()
              .pipe(Effect.orDie)
          : undefined
        const next =
          canonical?.seq ??
          ((yield* db
            .select({ value: max(OpencodeXStateEventTable.aggregate_sequence) })
            .from(OpencodeXStateEventTable)
            .where(and(whereScope(current), eq(OpencodeXStateEventTable.aggregate_id, aggregate)))
            .get()
            .pipe(Effect.orDie))?.value ?? -1) + 1
        yield* db
          .insert(OpencodeXStateEventTable)
          .values({
            id: event.id,
            project_id: current.projectID,
            workspace_id: current.workspaceID,
            directory: current.directory,
            aggregate_id: aggregate,
            aggregate_sequence: next,
            domain: domain(event),
            event_type: event.type,
            operation: "invalidate",
            payload: { aggregateID: aggregate, eventType: event.type },
          })
          .onConflictDoNothing({ target: OpencodeXStateEventTable.id })
          .run()
          .pipe(Effect.orDie)
        const row = yield* db
          .select()
          .from(OpencodeXStateEventTable)
          .where(eq(OpencodeXStateEventTable.id, event.id))
          .get()
          .pipe(Effect.orDie)
        if (!row) return
        const persisted = hydrate(row)
        for (const listener of listeners) listener(persisted)
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)

    const listen: Interface["listen"] = (listener) =>
      Effect.sync(() => {
        listeners.push(listener)
        return Effect.sync(() => {
          const index = listeners.indexOf(listener)
          if (index >= 0) listeners.splice(index, 1)
        })
      })

    const replay = Effect.fn("OpencodeXState.replay")(function* (after?: string) {
      const current = yield* scope()
      const latest = yield* position(current)
      if (!after) return { reset: false as const, events: [], cursor: encodeCursor(current, latest) }
      const decoded = Option.getOrUndefined(
        yield* Effect.try({
          try: () => Schema.decodeUnknownSync(CursorPayload)(JSON.parse(Buffer.from(after, "base64url").toString())),
          catch: (cause) => cause,
        }).pipe(Effect.option),
      )
      if (!decoded || decoded.epoch !== EPOCH || !sameScope(decoded.scope, current)) {
        return { reset: true as const, reason: "cursor epoch or scope mismatch", cursor: encodeCursor(current, latest) }
      }
      if (decoded.position > latest) {
        return { reset: true as const, reason: "cursor is not satisfiable", cursor: encodeCursor(current, latest) }
      }
      const retained =
        decoded.position === 0
          ? true
          : Boolean(
              yield* db
                .select({ position: OpencodeXStateEventTable.position })
                .from(OpencodeXStateEventTable)
                .where(and(whereScope(current), eq(OpencodeXStateEventTable.position, decoded.position)))
                .get()
                .pipe(Effect.orDie),
            )
      if (!retained) {
        return { reset: true as const, reason: "cursor is not retained", cursor: encodeCursor(current, latest) }
      }
      const rows = yield* db
        .select()
        .from(OpencodeXStateEventTable)
        .where(and(whereScope(current), gt(OpencodeXStateEventTable.position, decoded.position)))
        .orderBy(asc(OpencodeXStateEventTable.position))
        .all()
        .pipe(Effect.orDie)
      return { reset: false as const, events: rows.map(hydrate), cursor: encodeCursor(current, latest) }
    })

    const snapshot = Effect.fn("OpencodeXState.snapshot")(function* () {
      return yield* events.barrier(
        Effect.gen(function* () {
          const current = yield* scope()
          const [projectList, sessionList, viewList, statusList, permissionList, questionList] = yield* Effect.all(
            [
              projects.list(),
              sessions.list({ scope: "project" }),
              views.list(),
              statuses.list(),
              permissions.list(),
              questions.list(),
            ],
            { concurrency: "unbounded" },
          )
          const state = yield* sessionState.list(sessionList.map((session) => session.id))
          const catalog = {
            projects: projectList,
            sessions: sessionList,
            views: viewList,
            sessionStatus: Object.fromEntries(statusList),
            permissions: permissionList,
            questions: questionList,
            sessionUiState: Object.fromEntries(
              sessionList.map((session) => [
                session.id,
                OpencodeXSessionState.deriveUiState({
                  session,
                  status: statusList.get(session.id),
                  permissions: permissionList.filter((item) => item.sessionID === session.id),
                  questions: questionList.filter((item) => item.sessionID === session.id),
                  state: state[session.id],
                }),
              ]),
            ),
          }
          const stateCursor = encodeCursor(current, yield* position(current))
          const digest = Bun.hash(JSON.stringify(catalog)).toString(36)
          return {
            scope: current,
            epoch: EPOCH,
            cursor: stateCursor,
            digest,
            domains: { catalog: { revision: digest, digest } },
            payloads: { catalog },
          }
        }),
      )
    })

    const session = Effect.fn("OpencodeXState.session")(function* (input: {
      sessionID: SessionID
      limit?: number
      before?: string
    }) {
      return yield* events.barrier(
        Effect.gen(function* () {
          const current = yield* scope()
          const [info, page, todoList, diff, permissionList, questionList] = yield* Effect.all(
            [
              sessions.get(input.sessionID),
              MessageV2.page({ sessionID: input.sessionID, limit: input.limit ?? 50, before: input.before }).pipe(
                Effect.provideService(Database.Service, database),
              ),
              todos.get(input.sessionID),
              sessions.diff(input.sessionID),
              permissions
                .list()
                .pipe(Effect.map((items) => items.filter((item) => item.sessionID === input.sessionID))),
              questions.list().pipe(Effect.map((items) => items.filter((item) => item.sessionID === input.sessionID))),
            ],
            { concurrency: "unbounded" },
          )
          const stateCursor = encodeCursor(current, yield* position(current))
          const firstMessage = page.items[0]
          const lastMessage = page.items.at(-1)
          const content = {
            session: info,
            messages: {
              items: page.items,
              coverage: {
                ...(firstMessage ? { firstMessageID: firstMessage.info.id } : {}),
                ...(lastMessage ? { lastMessageID: lastMessage.info.id } : {}),
              },
              boundary: { hasMore: page.more, ...(page.cursor ? { next: page.cursor } : {}) },
            },
            todos: todoList,
            diff,
            pendingInteractions: {
              permissions: permissionList,
              questions: questionList,
            },
          }
          return {
            scope: current,
            epoch: EPOCH,
            cursor: stateCursor,
            digest: Bun.hash(JSON.stringify(content)).toString(36),
            ...content,
          }
        }),
      )
    })

    return Service.of({ scope, barrier: events.barrier, cursor, replay, listen, snapshot, session })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(OpencodeXProject.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(OpencodeXView.defaultLayer),
  Layer.provide(SessionStatus.defaultLayer),
  Layer.provide(Permission.defaultLayer),
  Layer.provide(Question.defaultLayer),
  Layer.provide(OpencodeXSessionState.defaultLayer),
  Layer.provide(Todo.defaultLayer),
)

export * as OpencodeXState from "./state"

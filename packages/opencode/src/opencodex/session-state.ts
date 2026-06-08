import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { OpencodeXSessionStateTable } from "@opencode-ai/core/opencodex/sql"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Context, Effect, Layer, Schema } from "effect"
import { eq, inArray } from "drizzle-orm"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { OpencodeXProject } from "./project"
import { OpencodeXView } from "./view"

export const Info = Schema.Struct({
  sessionID: SessionID,
  seenAt: Schema.optional(NonNegativeInt),
  reviewedAt: Schema.optional(NonNegativeInt),
  reviewedFiles: Schema.Array(Schema.String),
  timeUpdated: NonNegativeInt,
}).annotate({ identifier: "OpencodeXSessionState" })
export type Info = Schema.Schema.Type<typeof Info>

export const UpdateInput = Schema.Struct({
  sessionID: SessionID,
  seenAt: Schema.optional(NonNegativeInt),
  reviewedAt: Schema.optional(NonNegativeInt),
  reviewedFiles: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "OpencodeXSessionStateUpdateInput" })
export type UpdateInput = Schema.Schema.Type<typeof UpdateInput>

export const DisplayStatus = Schema.Literals(["idle", "in_progress", "input_needed", "needs_review"]).annotate({
  identifier: "OpencodeXSessionDisplayStatus",
})
export type DisplayStatus = Schema.Schema.Type<typeof DisplayStatus>

export const UiState = Schema.Struct({
  sessionID: SessionID,
  seenAt: Schema.optional(NonNegativeInt),
  reviewedAt: Schema.optional(NonNegativeInt),
  reviewedFiles: Schema.Array(Schema.String),
  displayStatus: DisplayStatus,
  updated: Schema.Boolean,
}).annotate({ identifier: "OpencodeXSessionUiState" })
export type UiState = Schema.Schema.Type<typeof UiState>

export const SyncSnapshot = Schema.Struct({
  projects: Schema.Array(OpencodeXProject.Info),
  sessions: Schema.Array(Session.Info),
  views: Schema.Array(OpencodeXView.Info),
  sessionStatus: Schema.Record(Schema.String, SessionStatus.Info),
  permissions: Schema.Array(Permission.Request),
  questions: Schema.Array(Question.Request),
  sessionUiState: Schema.Record(Schema.String, UiState),
}).annotate({ identifier: "OpencodeXSessionSyncSnapshot" })
export type SyncSnapshot = Schema.Schema.Type<typeof SyncSnapshot>

export const SyncResponse = Schema.Union([
  Schema.Struct({
    changed: Schema.Literal(false),
    revision: Schema.String,
  }),
  Schema.Struct({
    changed: Schema.Literal(true),
    revision: Schema.String,
    snapshot: SyncSnapshot,
  }),
]).annotate({ identifier: "OpencodeXSessionSyncResponse" })
export type SyncResponse = Schema.Schema.Type<typeof SyncResponse>

export const Event = {
  Updated: EventV2.define({
    type: "opencodex.session_state.updated",
    sync: {
      aggregate: "sessionID",
      version: 1,
    },
    schema: {
      sessionID: SessionID,
      state: Info,
    },
  }),
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info | undefined>
  readonly list: (sessionIDs: readonly SessionID[]) => Effect.Effect<Record<string, Info>>
  readonly update: (input: UpdateInput) => Effect.Effect<Info>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXSessionState") {}

function hydrate(row: typeof OpencodeXSessionStateTable.$inferSelect): Info {
  return {
    sessionID: row.session_id,
    ...(row.seen_at === null ? {} : { seenAt: row.seen_at }),
    ...(row.reviewed_at === null ? {} : { reviewedAt: row.reviewed_at }),
    reviewedFiles: row.reviewed_files,
    timeUpdated: row.time_updated,
  }
}

function maxOptional(a: number | undefined, b: number | undefined) {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.max(a, b)
}

function reviewedFiles(input: readonly string[] | undefined, current: Info | undefined) {
  if (input === undefined) return current?.reviewedFiles ?? []
  return [...new Set(input)]
}

export function deriveUiState(input: {
  session: Pick<Session.Info, "id" | "time">
  status?: SessionStatus.Info
  permissions: readonly Permission.Request[]
  questions: readonly Question.Request[]
  state?: Info
}): UiState {
  const active = input.status?.type === "busy" || input.status?.type === "retry"
  const displayStatus =
    input.permissions.length > 0 || input.questions.length > 0
      ? "input_needed"
      : active
        ? "in_progress"
        : input.session.time.updated > (input.state?.reviewedAt ?? 0)
          ? "needs_review"
          : "idle"
  return {
    sessionID: input.session.id,
    ...(input.state?.seenAt === undefined ? {} : { seenAt: input.state.seenAt }),
    ...(input.state?.reviewedAt === undefined ? {} : { reviewedAt: input.state.reviewedAt }),
    reviewedFiles: input.state?.reviewedFiles ?? [],
    displayStatus,
    updated: input.session.time.updated > (input.state?.seenAt ?? 0),
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2Bridge.Service

    yield* events.project(Event.Updated, (event) => {
      const state = event.data.state
      return db
        .insert(OpencodeXSessionStateTable)
        .values([
          {
            session_id: state.sessionID,
            seen_at: state.seenAt,
            reviewed_at: state.reviewedAt,
            reviewed_files: [...state.reviewedFiles],
            time_created: state.timeUpdated,
            time_updated: state.timeUpdated,
          },
        ])
        .onConflictDoUpdate({
          target: OpencodeXSessionStateTable.session_id,
          set: {
            seen_at: state.seenAt,
            reviewed_at: state.reviewedAt,
            reviewed_files: [...state.reviewedFiles],
            time_updated: state.timeUpdated,
          },
        })
        .run()
        .pipe(Effect.orDie)
    })

    const get = Effect.fn("OpencodeXSessionState.get")(function* (sessionID: SessionID) {
      const row = yield* db
        .select()
        .from(OpencodeXSessionStateTable)
        .where(eq(OpencodeXSessionStateTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      return row ? hydrate(row) : undefined
    })

    const list = Effect.fn("OpencodeXSessionState.list")(function* (sessionIDs: readonly SessionID[]) {
      if (sessionIDs.length === 0) return {}
      return Object.fromEntries(
        (
          yield* db
            .select()
            .from(OpencodeXSessionStateTable)
            .where(inArray(OpencodeXSessionStateTable.session_id, [...new Set(sessionIDs)]))
            .all()
            .pipe(Effect.orDie)
        ).map((row) => [row.session_id, hydrate(row)]),
      )
    })

    const update = Effect.fn("OpencodeXSessionState.update")(function* (input: UpdateInput) {
      const current = yield* get(input.sessionID)
      const state = {
        sessionID: input.sessionID,
        ...(maxOptional(current?.seenAt, input.seenAt) === undefined
          ? {}
          : { seenAt: maxOptional(current?.seenAt, input.seenAt) }),
        ...(maxOptional(current?.reviewedAt, input.reviewedAt) === undefined
          ? {}
          : { reviewedAt: maxOptional(current?.reviewedAt, input.reviewedAt) }),
        reviewedFiles: reviewedFiles(input.reviewedFiles, current),
        timeUpdated: Date.now(),
      }
      yield* events.publish(Event.Updated, { sessionID: input.sessionID, state })
      return state
    })

    return Service.of({ get, list, update })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer), Layer.provide(EventV2Bridge.defaultLayer))

export * as OpencodeXSessionState from "./session-state"

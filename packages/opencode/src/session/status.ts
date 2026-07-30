import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { SessionExecutionTable, SessionStatusTable } from "@opencode-ai/core/session/sql"
import { ensureRunID } from "@opencode-ai/core/util/opencode-process"
import { and, eq } from "drizzle-orm"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { SessionID } from "./schema"
import { SessionExecutionOwner } from "./execution-owner"

export const Info = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("idle"),
  }),
  Schema.Struct({
    type: Schema.Literal("retry"),
    attempt: NonNegativeInt,
    message: Schema.String,
    next: NonNegativeInt,
  }),
  Schema.Struct({
    type: Schema.Literal("busy"),
  }),
]).annotate({ identifier: "SessionStatus" })
export type Info = Schema.Schema.Type<typeof Info>

export const Event = {
  Status: EventV2.define({
    type: "session.status",
    sync: {
      aggregate: "sessionID",
      version: 1,
    },
    schema: {
      sessionID: SessionID,
      status: Info,
    },
  }),
  // deprecated
  Idle: EventV2.define({
    type: "session.idle",
    schema: {
      sessionID: SessionID,
    },
  }),
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Map<SessionID, Info>>
  readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
  readonly setForGeneration: (sessionID: SessionID, generation: number, status: Info) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

export const ExecutionGeneration = Context.Reference<{ sessionID: SessionID; generation: number } | undefined>(
  "@opencode/SessionStatus/ExecutionGeneration",
  { defaultValue: () => undefined },
)

const decode = Schema.decodeUnknownOption(Info)
const OWNERLESS_STALE_MILLIS = 15_000

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service
    const processRunID = ensureRunID()

    // `sessionID` scopes the scan to one row. Reads take that path so a status
    // lookup stays an indexed point query instead of two full table scans in an
    // immediate transaction under the event barrier; the periodic sweep below
    // still covers sessions nobody is looking at.
    const recover = Effect.fn("SessionStatus.recover")(function* (sessionID?: SessionID) {
      const now = Date.now()
      const broadcasts = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              const statusQuery = transaction.select().from(SessionStatusTable)
              const statuses = (yield* (sessionID
                ? statusQuery.where(eq(SessionStatusTable.session_id, sessionID))
                : statusQuery
              ).all()).filter((row) => {
                const status = Option.getOrUndefined(decode(row.status))
                return status?.type === "busy" || status?.type === "retry"
              })
              if (statuses.length === 0) return [] as EventV2.Payload[]
              const executionQuery = transaction.select().from(SessionExecutionTable)
              const executions = new Map(
                (yield* (sessionID
                  ? executionQuery.where(eq(SessionExecutionTable.session_id, sessionID))
                  : executionQuery
                ).all()).map((row) => [row.session_id, row]),
              )
              const stale = statuses.filter((row) => {
                const execution = executions.get(row.session_id)
                if (!execution) return row.time_updated + OWNERLESS_STALE_MILLIS <= now
                if (execution.state !== "running" || !execution.owner_id) return true
                if (!execution.lease_expires_at || execution.lease_expires_at <= now) return true
                return !SessionExecutionOwner.alive(execution.owner_id, processRunID)
              })
              const result: EventV2.Payload[] = []
              for (const row of stale) {
                const execution = executions.get(row.session_id)
                if (execution) {
                  yield* transaction
                    .update(SessionExecutionTable)
                    .set({
                      state: "interrupted",
                      owner_id: null,
                      lease_expires_at: null,
                      completed_at: now,
                      time_updated: now,
                    })
                    .where(
                      and(
                        eq(SessionExecutionTable.session_id, row.session_id),
                        eq(SessionExecutionTable.generation, execution.generation),
                      ),
                    )
                    .run()
                }
                yield* transaction
                  .update(SessionStatusTable)
                  .set({ status: { type: "idle" }, time_updated: now })
                  .where(eq(SessionStatusTable.session_id, row.session_id))
                  .run()
                result.push(
                  yield* events.commit(Event.Status, { sessionID: row.session_id, status: { type: "idle" } }),
                  yield* events.commit(Event.Idle, { sessionID: row.session_id }),
                )
              }
              return result
            }),
          { behavior: "immediate" },
        ).pipe(Effect.orDie),
      )
      yield* Effect.forEach(broadcasts, events.broadcast, { discard: true })
    })

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      yield* recover(sessionID)
      const row = yield* db
        .select({ status: SessionStatusTable.status })
        .from(SessionStatusTable)
        .where(eq(SessionStatusTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      return row ? Option.getOrElse(decode(row.status), () => ({ type: "idle" as const })) : { type: "idle" as const }
    })

    const list = Effect.fn("SessionStatus.list")(function* () {
      yield* recover()
      const rows = yield* db
        .select({ sessionID: SessionStatusTable.session_id, status: SessionStatusTable.status })
        .from(SessionStatusTable)
        .all()
        .pipe(Effect.orDie)
      return new Map(
        rows.flatMap((row) => {
          const status = Option.getOrUndefined(decode(row.status))
          return status && status.type !== "idle" ? [[row.sessionID, status] as const] : []
        }),
      )
    })

    const write = Effect.fnUntraced(function* (sessionID: SessionID, status: Info, generation?: number) {
      const ctx = yield* InstanceState.context
      const now = Date.now()
      const committed = yield* events.barrier(
        db.transaction(
          (transaction) =>
            Effect.gen(function* () {
              if (generation !== undefined) {
                const execution = yield* transaction
                  .select({ generation: SessionExecutionTable.generation, state: SessionExecutionTable.state })
                  .from(SessionExecutionTable)
                  .where(eq(SessionExecutionTable.session_id, sessionID))
                  .get()
                if (execution?.generation !== generation) return undefined
                if (status.type !== "idle" && execution.state !== "running") return undefined
              }
              yield* transaction
                .insert(SessionStatusTable)
                .values({
                  session_id: sessionID,
                  project_id: ctx.project.id,
                  directory: ctx.directory,
                  status,
                  time_created: now,
                  time_updated: now,
                })
                .onConflictDoUpdate({
                  target: SessionStatusTable.session_id,
                  set: {
                    project_id: ctx.project.id,
                    directory: ctx.directory,
                    status,
                    time_updated: now,
                  },
                })
                .run()
              return {
                status: yield* events.commit(Event.Status, { sessionID, status }),
                idle: status.type === "idle" ? yield* events.commit(Event.Idle, { sessionID }) : undefined,
              }
            }),
          { behavior: "immediate" },
        ).pipe(Effect.orDie),
      )
      if (!committed) return false
      yield* events.broadcast(committed.status)
      if (committed.idle) yield* events.broadcast(committed.idle)
      return true
    })

    const setForGeneration = Effect.fn("SessionStatus.setForGeneration")(function* (
      sessionID: SessionID,
      generation: number,
      status: Info,
    ) {
      return yield* write(sessionID, status, generation)
    })

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      const generation = yield* ExecutionGeneration
      if (generation?.sessionID === sessionID) {
        yield* setForGeneration(sessionID, generation.generation, status)
        return
      }
      yield* write(sessionID, status)
    })

    // Recovery reconciles rows whose owning execution died. It used to run on
    // every read, which meant two full table scans inside an immediate
    // transaction under the event barrier for something as routine as painting
    // the sidebar. A dead owner's status can now be stale for at most one
    // interval, which no reader can distinguish from the process dying a moment
    // later anyway.
    yield* recover()
    yield* Effect.sleep(Duration.seconds(15)).pipe(
      Effect.andThen(recover()),
      // A failed sweep (e.g. SQLITE_BUSY outliving the busy timeout) must not
      // kill the loop for the life of the process; reads still recover inline,
      // but sessions nobody reads would never reconcile again.
      Effect.catchCause((cause) => Effect.logWarning("session status sweep failed", { cause })),
      Effect.repeat(Schedule.forever),
      Effect.forkScoped,
    )

    return Service.of({ get, list, set, setForGeneration })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
)

export * as SessionStatus from "./status"

import { Workspace } from "@/control-plane/workspace"
import * as InstanceState from "@/effect/instance-state"
import { Session } from "@/session/session"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventTable } from "@opencode-ai/core/event/sql"
import { asc } from "drizzle-orm"
import { and } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { inArray } from "drizzle-orm"
import { lte } from "drizzle-orm"
import { not } from "drizzle-orm"
import { or } from "drizzle-orm"
import { Effect, Scope } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { HistoryPayload, ReplayPayload, SessionPayload } from "../groups/sync"
import { SessionTable } from "@opencode-ai/core/session/sql"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "server.sync" })

export const syncHandlers = HttpApiBuilder.group(InstanceHttpApi, "sync", (handlers) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const session = yield* Session.Service
    const scope = yield* Scope.Scope
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service

    const start = Effect.fn("SyncHttpApi.start")(function* () {
      yield* workspace
        .startWorkspaceSyncing((yield* InstanceState.context).project.id)
        .pipe(Effect.ignore, Effect.forkIn(scope))
      return true
    })

    const replay = Effect.fn("SyncHttpApi.replay")(function* (ctx: { payload: typeof ReplayPayload.Type }) {
      const payload: EventV2.SerializedEvent[] = ctx.payload.events.map((event) => ({
        id: EventV2.ID.make(event.id),
        aggregateID: event.aggregateID,
        seq: event.seq,
        type: event.type,
        data: { ...event.data },
      }))
      const source = payload[0].aggregateID
      log.info("sync replay requested", {
        sessionID: source,
        events: payload.length,
        first: payload[0]?.seq,
        last: payload.at(-1)?.seq,
        directory: ctx.payload.directory,
      })
      yield* events.replayAll(payload)
      log.info("sync replay complete", {
        sessionID: source,
        events: payload.length,
        first: payload[0]?.seq,
        last: payload.at(-1)?.seq,
      })
      return { sessionID: source }
    })

    const steal = Effect.fn("SyncHttpApi.steal")(function* (ctx: { payload: typeof SessionPayload.Type }) {
      const workspaceID = yield* InstanceState.workspaceID
      if (!workspaceID) return yield* new HttpApiError.BadRequest({})

      yield* session.setWorkspace({ sessionID: ctx.payload.sessionID, workspaceID })

      log.info("sync session stolen", {
        sessionID: ctx.payload.sessionID,
        workspaceID,
      })

      return { sessionID: ctx.payload.sessionID }
    })

    const history = Effect.fn("SyncHttpApi.history")(function* (ctx: {
      payload: typeof HistoryPayload.Type
      query: { directory?: string }
    }) {
      const exclude = Object.entries(ctx.payload)

      // A hub can host many projects in one database. When the caller sends
      // the optional `directory` query parameter, scope the journal to
      // sessions that belong to that directory so unrelated projects sharing
      // the same hub never cross-contaminate each other's mirrors. Without
      // it, the full journal is returned, keeping the upstream contract.
      const conditions = [
        exclude.length > 0
          ? not(or(...exclude.map(([id, seq]) => and(eq(EventTable.aggregate_id, id), lte(EventTable.seq, seq))))!)
          : undefined,
      ]
      if (ctx.query.directory !== undefined) {
        const scoped = yield* db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(eq(SessionTable.directory, ctx.query.directory))
          .all()
          .pipe(Effect.orDie)
        const scopedIDs = scoped.map((row) => row.id)
        if (scopedIDs.length === 0) return []
        conditions.push(inArray(EventTable.aggregate_id, scopedIDs))
      }

      return yield* db
        .select()
        .from(EventTable)
        .where(and(...conditions.filter((cond): cond is NonNullable<typeof cond> => cond !== undefined)))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
    })

    return handlers.handle("start", start).handle("replay", replay).handle("steal", steal).handle("history", history)
  }),
)

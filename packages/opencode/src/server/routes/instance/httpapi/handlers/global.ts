import { Config } from "@/config/config"
import { GlobalBus, GlobalBusID, subscribeGlobalBus, type GlobalEvent } from "@/bus/global"
import { EffectBridge } from "@/effect/bridge"
import { coordinatorKey } from "@opencode-ai/sdk/coordinator"
import { EventV2 } from "@opencode-ai/core/event"
import { Installation } from "@/installation"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Queue, Schema } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { RootHttpApi } from "../api"
import { GlobalUpgradeInput } from "../groups/global"
import { makeGuiBridgeHandlers } from "./gui-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { OpencodeXJobTable, OpencodeXSwarmTable } from "@opencode-ai/core/opencodex/sql"
import {
  SessionCommandTable,
  SessionExecutionTable,
  SessionInteractionTable,
} from "@opencode-ai/core/session/sql"
import { and, eq, gt, inArray, notInArray, or } from "drizzle-orm"
import { ensureProcessMetadata } from "@opencode-ai/core/util/opencode-process"

const log = Log.create({ service: "server" })

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function parseBody(body: string) {
  try {
    return JSON.parse(body || "{}") as unknown
  } catch {
    return undefined
  }
}

function eventResponse() {
  const events = Stream.callback<GlobalEvent>((queue) => {
    const handler = (event: GlobalEvent) => Queue.offerUnsafe(queue, event)
    return Effect.acquireRelease(
      Effect.sync(() => {
        const unsubscribe = subscribeGlobalBus(handler)
        log.info("global event connected")
        Queue.offerUnsafe(queue, {
          payload: { id: EventV2.ID.create(), type: "server.connected", properties: {} },
        })
        return unsubscribe
      }),
      (unsubscribe) => Effect.sync(unsubscribe),
    )
  })
  const heartbeat = Stream.tick("10 seconds").pipe(
    Stream.drop(1),
    Stream.map(() => ({ payload: { id: EventV2.ID.create(), type: "server.heartbeat", properties: {} } })),
  )

  return HttpServerResponse.stream(
    events.pipe(
      Stream.merge(heartbeat, { haltStrategy: "left" }),
      Stream.map(eventData),
      Stream.pipeThroughChannel(Sse.encode()),
      Stream.encodeText,
      Stream.ensuring(Effect.sync(() => log.info("global event disconnected"))),
    ),
    {
      contentType: "text/event-stream",
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    },
  )
}

export const globalHandlers = HttpApiBuilder.group(RootHttpApi, "global", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const installation = yield* Installation.Service
    const bridge = yield* EffectBridge.make()
    const guiBridge = yield* makeGuiBridgeHandlers()
    const { db } = yield* Database.Service
    const processMetadata = ensureProcessMetadata("main")
    const databaseID = Bun.hash(Database.path()).toString(36)

    const health = Effect.fn("GlobalHttpApi.health")(function* () {
      const now = Date.now()
      const activity = yield* Effect.all(
        [
          db
            .select({ id: SessionExecutionTable.session_id })
            .from(SessionExecutionTable)
            .where(
              or(
                eq(SessionExecutionTable.state, "queued"),
                and(
                  eq(SessionExecutionTable.state, "running"),
                  gt(SessionExecutionTable.lease_expires_at, now),
                ),
              ),
            )
            .limit(1)
            .get(),
          db
            .select({ id: SessionCommandTable.id })
            .from(SessionCommandTable)
            .where(inArray(SessionCommandTable.status, ["queued", "running"]))
            .limit(1)
            .get(),
          db
            .select({ id: SessionInteractionTable.id })
            .from(SessionInteractionTable)
            .where(eq(SessionInteractionTable.state, "pending"))
            .limit(1)
            .get(),
          db
            .select({ id: OpencodeXJobTable.id })
            .from(OpencodeXJobTable)
            .where(inArray(OpencodeXJobTable.status, ["queued", "claimed", "running"]))
            .limit(1)
            .get(),
          db
            .select({ id: OpencodeXSwarmTable.id })
            .from(OpencodeXSwarmTable)
            .where(notInArray(OpencodeXSwarmTable.status, ["completed", "partially_failed", "failed", "cancelled"]))
            .limit(1)
            .get(),
        ].map((query) => query.pipe(Effect.map((row) => row !== undefined), Effect.orDie)),
        { concurrency: "unbounded" },
      )
      return {
        healthy: true as const,
        version: InstallationVersion,
        active: activity.some(Boolean),
        processRole: processMetadata.processRole,
        runID: processMetadata.runID,
        databaseID,
        coordinatorKey: coordinatorKey(Database.path()),
        eventBusID: GlobalBusID,
      }
    })

    const event = Effect.fn("GlobalHttpApi.event")(function* () {
      return eventResponse()
    })

    const configGet = Effect.fn("GlobalHttpApi.configGet")(function* () {
      return yield* config.getGlobal()
    })

    const configUpdate = Effect.fn("GlobalHttpApi.configUpdate")(function* (ctx) {
      const result = yield* config.updateGlobal(ctx.payload)
      if (result.changed) bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
      return result.info
    })

    const dispose = Effect.fn("GlobalHttpApi.dispose")(function* () {
      yield* disposeAllInstancesAndEmitGlobalDisposed()
      return true
    })

    const upgrade = Effect.fn("GlobalHttpApi.upgrade")(function* (ctx: { payload: typeof GlobalUpgradeInput.Type }) {
      const method = yield* installation.method()
      if (method === "unknown") {
        return {
          status: 400,
          body: { success: false as const, error: "Unknown installation method" },
        }
      }
      const target = ctx.payload.target || (yield* installation.latest(method))
      const result = yield* installation.upgrade(method, target).pipe(
        Effect.as({ status: 200, body: { success: true as const, version: target } }),
        Effect.catch((err) =>
          Effect.succeed({
            status: 500,
            body: {
              success: false as const,
              error: err instanceof Error ? err.message : String(err),
            },
          }),
        ),
      )
      if (!result.body.success) return result
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: target },
        },
      })
      return result
    })

    const upgradeRaw = Effect.fn("GlobalHttpApi.upgradeRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const json = parseBody(body)
      if (json === undefined) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const payload = yield* Schema.decodeUnknownEffect(GlobalUpgradeInput)(json).pipe(
        Effect.map((payload) => ({ valid: true as const, payload })),
        Effect.catch(() => Effect.succeed({ valid: false as const })),
      )
      if (!payload.valid) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const result = yield* upgrade({ payload: payload.payload })
      return HttpServerResponse.jsonUnsafe(result.body, { status: result.status })
    })

    return handlers
      .handle("health", health)
      .handleRaw("event", event)
      .handle("configGet", configGet)
      .handle("configUpdate", configUpdate)
      .handle("dispose", dispose)
      .handleRaw("upgrade", upgradeRaw)
      .handle("guiBridgeSync", guiBridge.guiBridgeSync)
      .handle("guiBridgeUnregister", guiBridge.guiBridgeUnregister)
      .handle("guiBridgeRespond", guiBridge.guiBridgeRespond)
  }),
)

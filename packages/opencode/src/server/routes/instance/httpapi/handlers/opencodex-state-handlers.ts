import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { Format } from "@/format"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { OpencodeXCapabilities } from "@/opencodex/capabilities"
import { OpencodeXState } from "@/opencodex/state"
import { AUTHORITY_EPOCH } from "@/opencodex/state-epoch"
import { OpencodeXSessionCard } from "@/opencodex/session-card"
import { ProviderCatalog } from "@/provider/catalog"
import { SessionID } from "@/session/schema"
import { Effect, Option, Queue, Stream } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiError } from "effect/unstable/httpapi"
import { encode } from "effect/unstable/encoding/Sse"
import { StateEventQuery, StateSessionCardQuery, StateSessionQuery } from "../groups/opencodex"
import { mapStorageNotFound } from "./session-errors"
import type { OpencodeXPluginHandlers } from "./opencodex-plugin-handlers"

export const makeOpencodeXStateHandlers = Effect.fn("OpencodeXHttpApi.makeStateHandlers")(function* (
  plugins: OpencodeXPluginHandlers,
) {
  const state = yield* OpencodeXState.Service
  const config = yield* Config.Service
  const agent = yield* Agent.Service
  const command = yield* Command.Service
  const format = yield* Format.Service
  const lsp = yield* LSP.Service
  const mcp = yield* MCP.Service

  const stateSnapshot = Effect.fn("OpencodeXHttpApi.stateSnapshot")(function* () {
    return yield* state.snapshot()
  })

  const stateOperations = Effect.fn("OpencodeXHttpApi.stateOperations")(function* () {
    return yield* state.operations()
  })

  const stateCapabilities = Effect.fn("OpencodeXHttpApi.stateCapabilities")(function* () {
    return yield* state.barrier(
      Effect.gen(function* () {
        const [provider, configInfo, agents, commands, lspStatus, formatter, mcpStatus, mcpResources, pluginList] =
          yield* Effect.all(
            [
              ProviderCatalog.list(),
              config.get(),
              agent.list(),
              command.list(),
              lsp.status(),
              format.status(),
              mcp.status(),
              mcp.resources(),
              plugins.snapshot(),
            ],
            { concurrency: "unbounded" },
          )
        const payload: OpencodeXCapabilities.Payload = {
          provider,
          config: configInfo,
          agents,
          commands,
          lsp: lspStatus,
          formatter,
          mcp: mcpStatus,
          mcpResources,
          plugins: pluginList,
        }
        const digest = Bun.hash(JSON.stringify(payload)).toString(36)
        return {
          scope: yield* state.scope(),
          epoch: AUTHORITY_EPOCH,
          revision: digest,
          digest,
          payload,
        }
      }),
    )
  })

  const stateSession = Effect.fn("OpencodeXHttpApi.stateSession")(function* (ctx: {
    params: { sessionID: SessionID }
    query: typeof StateSessionQuery.Type
  }) {
    return yield* mapStorageNotFound(
      state.session({ sessionID: ctx.params.sessionID, limit: ctx.query.limit, before: ctx.query.before }),
    )
  })

  const stateSessionCards = Effect.fn("OpencodeXHttpApi.stateSessionCards")(function* (ctx: {
    query: typeof StateSessionCardQuery.Type
  }) {
    const sessionIDs = ctx.query.ids
      ? [...new Set(ctx.query.ids.split(",").map((id) => id.trim()).filter(Boolean))]
      : undefined
    if (sessionIDs && sessionIDs.length > OpencodeXSessionCard.MAX_RETAINED_IDS) {
      return yield* new HttpApiError.BadRequest({})
    }
    return yield* state
      .sessionCards({
        cursor: ctx.query.cursor,
        limit: ctx.query.limit,
        sessionIDs: sessionIDs?.map((sessionID) => SessionID.make(sessionID)),
      })
      .pipe(
        Effect.catchTag("OpencodeX.SessionCard.InvalidCursorError", () =>
          Effect.fail(new HttpApiError.BadRequest({})),
        ),
      )
  })

  const stateEvent = Effect.fn("OpencodeXHttpApi.stateEvent")(function* (ctx: {
    query: typeof StateEventQuery.Type
    request: HttpServerRequest.HttpServerRequest
  }) {
    const scope = yield* state.scope()
    const after = ctx.query.after ?? ctx.request.headers["last-event-id"]
    const queue = yield* Queue.dropping<
      { readonly type: "event"; readonly event: OpencodeXState.OpencodeXStateEvent } | { readonly type: "overflow" }
    >(1_024)
    let overflowed = false
    const unsubscribe = yield* state.listen((event) => {
      if (overflowed) return
      if (Queue.offerUnsafe(queue, { type: "event", event })) return
      overflowed = true
      while (Queue.takeUnsafe(queue) !== undefined) {}
      Queue.offerUnsafe(queue, { type: "overflow" })
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    const { replay, queued } = yield* state.barrier(
      Effect.gen(function* () {
        const replay = yield* state.replay(after)
        const queued = new Array<
          { readonly type: "event"; readonly event: OpencodeXState.OpencodeXStateEvent } | { readonly type: "overflow" }
        >()
        while (true) {
          const item = yield* Queue.poll(queue)
          if (Option.isNone(item)) return { replay, queued }
          queued.push(item.value)
        }
      }),
    )
    const ready: OpencodeXState.OpencodeXStateStreamFrame = {
      type: "ready",
      scope,
      epoch: AUTHORITY_EPOCH,
      cursor: replay.cursor,
    }
    const resetFrame = (cursor: OpencodeXState.OpencodeXStateCursor, reason: string) =>
      ({
        type: "reset_required",
        scope,
        epoch: AUTHORITY_EPOCH,
        cursor,
        reason,
      }) satisfies OpencodeXState.OpencodeXStateStreamFrame
    const handoff = queued.flatMap((item): readonly OpencodeXState.OpencodeXStateStreamFrame[] => {
      if (item.type === "overflow") return [resetFrame(replay.cursor, "state stream queue overflow")]
      if (item.event.position <= replay.position) return []
      return [{ type: "event" as const, event: item.event }]
    })
    const handoffOverflowed = queued.some((item) => item.type === "overflow")
    const initial: OpencodeXState.OpencodeXStateStreamFrame[] = replay.reset
      ? [ready, resetFrame(replay.cursor, replay.reason)]
      : handoffOverflowed
        ? [ready, resetFrame(replay.cursor, "state stream queue overflow")]
      : [ready, ...replay.events.map((event) => ({ type: "event" as const, event })), ...handoff]
    const live = Stream.fromQueue(queue).pipe(
      Stream.filter((item) => item.type === "overflow" || item.event.position > replay.position),
      Stream.mapEffect(
        (item): Effect.Effect<OpencodeXState.OpencodeXStateStreamFrame> =>
          item.type === "event"
            ? Effect.succeed({ type: "event", event: item.event })
            : state.cursor().pipe(Effect.map((cursor) => resetFrame(cursor, "state stream queue overflow"))),
      ),
    )
    const heartbeat = Stream.tick("10 seconds").pipe(
      Stream.drop(1),
      Stream.map((): OpencodeXState.OpencodeXStateStreamFrame => ({ type: "heartbeat", epoch: AUTHORITY_EPOCH })),
    )
    return HttpServerResponse.stream(
      Stream.fromIterable(initial).pipe(
        Stream.concat(live.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
        Stream.map((data) => ({
          _tag: "Event" as const,
          event: data.type,
          id: data.type === "event" ? data.event.cursor : undefined,
          data: JSON.stringify(data),
        })),
        Stream.pipeThroughChannel(encode()),
        Stream.encodeText,
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
  })

  return { stateSnapshot, stateOperations, stateCapabilities, stateSessionCards, stateSession, stateEvent }
})

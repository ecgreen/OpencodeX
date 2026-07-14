import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { Format } from "@/format"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { OpencodeXCapabilities } from "@/opencodex/capabilities"
import { OpencodeXState } from "@/opencodex/state"
import { ProviderCatalog } from "@/provider/catalog"
import { SessionID } from "@/session/schema"
import { Effect, Option, Queue, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { encode } from "effect/unstable/encoding/Sse"
import { StateEventQuery, StateSessionQuery } from "../groups/opencodex"
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
          epoch: OpencodeXState.EPOCH,
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

  const stateEvent = Effect.fn("OpencodeXHttpApi.stateEvent")(function* (ctx: {
    query: typeof StateEventQuery.Type
  }) {
    const scope = yield* state.scope()
    const queue = yield* Queue.unbounded<OpencodeXState.OpencodeXStateEvent>()
    const unsubscribe = yield* state.listen((event) => Queue.offerUnsafe(queue, event))
    yield* Effect.addFinalizer(() => unsubscribe)
    const replay = yield* state.barrier(
      Effect.gen(function* () {
        const result = yield* state.replay(ctx.query.after)
        while (Option.isSome(yield* Queue.poll(queue))) {
          // Events through the barrier cursor are already included in replay.
        }
        return result
      }),
    )
    const ready: OpencodeXState.OpencodeXStateStreamFrame = {
      type: "ready",
      scope,
      epoch: OpencodeXState.EPOCH,
      cursor: replay.cursor,
    }
    const initial: OpencodeXState.OpencodeXStateStreamFrame[] = replay.reset
      ? [
          ready,
          {
            type: "reset_required",
            scope,
            epoch: OpencodeXState.EPOCH,
            cursor: replay.cursor,
            reason: replay.reason,
          },
        ]
      : [ready, ...replay.events.map((event) => ({ type: "event" as const, event }))]
    const live = Stream.fromQueue(queue).pipe(
      Stream.filter(
        (event) =>
          event.scope.projectID === scope.projectID &&
          event.scope.workspaceID === scope.workspaceID &&
          event.scope.directory === scope.directory,
      ),
      Stream.map((event): OpencodeXState.OpencodeXStateStreamFrame => ({ type: "event", event })),
    )
    return HttpServerResponse.stream(
      Stream.fromIterable(initial).pipe(
        Stream.concat(live),
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

  return { stateSnapshot, stateOperations, stateCapabilities, stateSession, stateEvent }
})

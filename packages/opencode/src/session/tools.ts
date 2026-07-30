import { Agent } from "@/agent/agent"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Tool } from "@/tool/tool"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"

import { Plugin } from "@/plugin"
import type { TaskPromptOps } from "@/tool/task"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import { Duration, Effect, Schedule, Semaphore } from "effect"
import { MessageV2 } from "./message-v2"
import * as Session from "./session"
import { SessionProcessor } from "./processor"
import { PartID } from "./schema"
import * as Log from "@opencode-ai/core/util/log"
import { EffectBridge } from "@/effect/bridge"
import { ProviderV2 } from "@opencode-ai/core/provider"

const log = Log.create({ service: "session.tools" })

const METADATA_INTERVAL_MS = 100

type MetadataInput = Parameters<Tool.Context["metadata"]>[0]

/**
 * Rate limiter for `ctx.metadata`, one instance per tool call.
 *
 * Tools call it per output chunk - the shell tool does it for every stdout
 * read - and each call used to be a broadcast plus a durable revision. The
 * first call of a window still writes immediately so the UI reacts instantly;
 * anything that arrives inside the window overwrites a single `pending` slot
 * that a forked fiber drains once per interval. The fiber is scoped to the tool
 * execution, so it is interrupted the moment the tool returns and the durable
 * completion write supersedes whatever was still pending.
 *
 * A semaphore serialises the leading write against the drain, and a sequence
 * guard drops any frame that loses the permit race to a newer one — the drain
 * fiber captures `pending` before it queues for the permit, so without the
 * guard an immediate write could slip in between and be overwritten by the
 * older captured frame.
 */
const coalesceMetadata = Effect.fnUntraced(function* (write: (value: MetadataInput) => Effect.Effect<unknown>) {
  const lock = Semaphore.makeUnsafe(1)
  let pending: { value: MetadataInput; seq: number } | undefined
  let last = 0
  let sequence = 0
  let written = 0

  const flush = (value: MetadataInput, seq: number) =>
    lock.withPermit(
      Effect.suspend(() => {
        if (seq <= written) return Effect.void
        written = seq
        last = Date.now()
        return write(value)
      }),
    )

  yield* Effect.sleep(Duration.millis(METADATA_INTERVAL_MS)).pipe(
    Effect.andThen(
      Effect.suspend(() => {
        const item = pending
        pending = undefined
        return item === undefined ? Effect.void : flush(item.value, item.seq)
      }),
    ),
    Effect.repeat(Schedule.forever),
    Effect.forkScoped,
  )

  return (value: MetadataInput) =>
    Effect.suspend(() => {
      const seq = ++sequence
      if (Date.now() - last >= METADATA_INTERVAL_MS) {
        pending = undefined
        return flush(value, seq)
      }
      pending = { value, seq }
      return Effect.void
    })
})

export const resolve = Effect.fn("SessionTools.resolve")(function* (input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
  bypassAgentCheck: boolean
  messages: SessionLegacy.WithParts[]
  promptOps: TaskPromptOps
}) {
  using _ = log.time("resolveTools")
  const tools: Record<string, AITool> = {}
  const run = yield* EffectBridge.make()
  const plugin = yield* Plugin.Service
  const permission = yield* Permission.Service
  const registry = yield* ToolRegistry.Service
  const mcp = yield* MCP.Service
  const truncate = yield* Truncate.Service

  const context = (args: Record<string, unknown>, options: ToolExecutionOptions) =>
    Effect.gen(function* () {
      // In-flight progress only, so it is published transiently: the durable
      // completion (or failure) revision that follows is what has to survive a
      // crash.
      const metadata = yield* coalesceMetadata((val) =>
        input.processor.updateToolCall(
          options.toolCallId,
          (match) => {
            if (!["running", "pending"].includes(match.state.status)) return match
            return {
              ...match,
              state: {
                title: val.title,
                metadata: val.metadata,
                status: "running",
                input: args,
                time: { start: Date.now() },
              },
            }
          },
          { transient: true },
        ),
      )
      return {
        sessionID: input.session.id,
        directory: input.session.directory,
        workspaceID: input.session.workspaceID,
        abort: options.abortSignal!,
        messageID: input.processor.message.id,
        callID: options.toolCallId,
        extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck, promptOps: input.promptOps },
        agent: input.agent.name,
        messages: input.messages,
        metadata,
        ask: (req) =>
          permission
            .ask({
              ...req,
              sessionID: input.session.id,
              tool: { messageID: input.processor.message.id, callID: options.toolCallId },
              ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
            })
            .pipe(Effect.orDie),
      } satisfies Tool.Context
    })

  for (const item of yield* registry.tools({
    modelID: ProviderV2.ModelID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.agent,
  })) {
    const schema = ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item))
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args, options) {
        // Scoped so the metadata coalescer's drain fiber dies with the call.
        return run.promise(
          Effect.gen(function* () {
            const ctx = yield* context(args, options)
            yield* plugin.trigger(
              "tool.execute.before",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
              { args },
            )
            const result = yield* item.execute(args, ctx)
            const output = {
              ...result,
              attachments: result.attachments?.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
            }
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
              output,
            )
            if (options.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(options.toolCallId, output)
            }
            return output
          }).pipe(Effect.scoped),
        )
      },
    })
  }

  for (const [key, item] of Object.entries(yield* mcp.tools())) {
    const execute = item.execute
    if (!execute) continue

    const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
    const transformed = ProviderTransform.schema(input.model, schema)
    item.inputSchema = jsonSchema(transformed)
    item.execute = (args, opts) =>
      run.promise(
        Effect.gen(function* () {
          const ctx = yield* context(args, opts)
          yield* plugin.trigger(
            "tool.execute.before",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
            { args },
          )
          const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.gen(function* () {
            yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
            return yield* Effect.promise(() => execute(args, opts))
          }).pipe(
            Effect.withSpan("Tool.execute", {
              attributes: {
                "tool.name": key,
                "tool.call_id": opts.toolCallId,
                "session.id": ctx.sessionID,
                "message.id": input.processor.message.id,
              },
            }),
          )
          yield* plugin.trigger(
            "tool.execute.after",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
            result,
          )

          const textParts: string[] = []
          const attachments: Omit<SessionLegacy.FilePart, "id" | "sessionID" | "messageID">[] = []
          for (const contentItem of result.content) {
            if (contentItem.type === "text") textParts.push(contentItem.text)
            else if (contentItem.type === "image") {
              attachments.push({
                type: "file",
                mime: contentItem.mimeType,
                url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
              })
            } else if (contentItem.type === "resource") {
              const { resource } = contentItem
              if (resource.text) textParts.push(resource.text)
              if (resource.blob) {
                attachments.push({
                  type: "file",
                  mime: resource.mimeType ?? "application/octet-stream",
                  url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                  filename: resource.uri,
                })
              }
            }
          }

          const truncated = yield* truncate.output(textParts.join("\n\n"), {}, input.agent)
          const metadata = {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { outputPath: truncated.outputPath }),
          }

          const output = {
            title: "",
            metadata,
            output: truncated.content,
            attachments: attachments.map((attachment) => ({
              ...attachment,
              id: PartID.ascending(),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
            content: result.content,
          }
          if (opts.abortSignal?.aborted) {
            yield* input.processor.completeToolCall(opts.toolCallId, output)
          }
          return output
        }).pipe(Effect.scoped),
      )
    tools[key] = item
  }

  return tools
})

export * as SessionTools from "./tools"

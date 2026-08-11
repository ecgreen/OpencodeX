import { expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { SessionTools } from "@/session/tools"
import { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

/**
 * `ctx.metadata` used to open a durable write transaction per call, and tools
 * such as shell call it once per output chunk. These tests pin the coalescer
 * that now sits in front of it: leading edge writes immediately, the rest of a
 * burst collapses into a single trailing write per interval.
 */

const INTERVAL_MS = 100

const writes: { title?: string; transient?: boolean }[] = []

const probe = (run: (ctx: Tool.Context) => Effect.Effect<void>): Tool.Def => ({
  id: "probe",
  description: "test tool",
  parameters: Schema.Struct({}),
  execute: (_args, ctx) =>
    run(ctx).pipe(Effect.as({ title: "done", metadata: { truncated: false }, output: "done" })),
})

const services = (tool: Tool.Def) =>
  Layer.mergeAll(
    Layer.succeed(
      ToolRegistry.Service,
      ToolRegistry.Service.of({
        ids: () => Effect.succeed([tool.id]),
        all: () => Effect.succeed([tool]),
        named: () => Effect.die("unused"),
        tools: () => Effect.succeed([tool]),
      }),
    ),
    Layer.succeed(
      Plugin.Service,
      Plugin.Service.of({
        trigger: (_name, _input, output) => Effect.succeed(output),
        list: () => Effect.succeed([]),
        init: () => Effect.void,
      }),
    ),
    Layer.succeed(Permission.Service, { ask: () => Effect.void } as unknown as Permission.Interface),
    Layer.succeed(MCP.Service, { tools: () => Effect.succeed({}) } as unknown as MCP.Interface),
    Layer.succeed(Truncate.Service, {
      output: (text: string) => Effect.succeed({ truncated: false, content: text }),
    } as unknown as Truncate.Interface),
  )

const run = (tool: Tool.Def) =>
  Effect.gen(function* () {
    writes.length = 0
    const resolved = yield* SessionTools.resolve({
      agent: { name: "build", permission: [] } as any,
      model: { providerID: "test", api: { id: "test-model" } } as any,
      session: { id: "ses_probe", directory: "/tmp", permission: [] } as any,
      processor: {
        message: { id: "msg_probe" } as any,
        updateToolCall: (_callID, update, options) =>
          Effect.sync(() => {
            const next = update({ state: { status: "running" } } as any)
            writes.push({
              title: next.state.status === "running" ? next.state.title : undefined,
              transient: options?.transient,
            })
            return next
          }),
        completeToolCall: () => Effect.void,
      },
      bypassAgentCheck: true,
      messages: [],
      promptOps: {} as any,
    })
    const entry = resolved[tool.id]
    if (!entry?.execute) throw new Error("probe tool was not resolved")
    yield* Effect.promise(() =>
      Promise.resolve(
        entry.execute!({}, { toolCallId: "call_probe", messages: [], abortSignal: new AbortController().signal } as any),
      ),
    )
  }).pipe(Effect.provide(services(tool)))

const it = testEffect(Layer.empty)

// Live clock: the coalescer's drain fiber sleeps on the real one.
it.live("collapses a burst of metadata writes into a single leading write", () =>
  Effect.gen(function* () {
    yield* run(
      probe((ctx) =>
        Effect.gen(function* () {
          for (let index = 0; index < 50; index++) {
            yield* ctx.metadata({ title: `chunk ${index}`, metadata: {} })
          }
        }),
      ),
    )

    // Only the first call of the window reaches the writer; the tool returned
    // before the drain fiber ever fired, so the other 49 are dropped in favour
    // of the durable completion write that follows.
    expect(writes).toHaveLength(1)
    expect(writes[0]?.title).toBe("chunk 0")
  }),
)

it.live("drains the newest pending value once per interval", () =>
  Effect.gen(function* () {
    const tool = probe((ctx) =>
      Effect.gen(function* () {
        for (let index = 0; index < 50; index++) {
          yield* ctx.metadata({ title: `chunk ${index}`, metadata: {} })
        }
        // Real time so the drain fiber gets a turn regardless of the test clock.
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, INTERVAL_MS * 3)))
      }),
    )
    yield* run(tool)

    // Leading write plus at most one per elapsed interval - nowhere near 50.
    expect(writes.length).toBeGreaterThanOrEqual(2)
    expect(writes.length).toBeLessThanOrEqual(5)
    expect(writes[0]?.title).toBe("chunk 0")
    // The trailing drain always carries the newest value, never a stale one.
    expect(writes.at(-1)?.title).toBe("chunk 49")
  }),
)

it.live("persists metadata that must survive a session refresh", () =>
  Effect.gen(function* () {
    yield* run(
      probe((ctx) => ctx.metadata({ title: "linked", metadata: { sessionId: "ses_child" } }, { durable: true })),
    )

    expect(writes).toEqual([{ title: "linked", transient: false }])
  }),
)

it.live("drops pending transient metadata after a durable write", () =>
  Effect.gen(function* () {
    yield* run(
      probe((ctx) =>
        Effect.gen(function* () {
          yield* ctx.metadata({ title: "leading", metadata: {} })
          yield* ctx.metadata({ title: "stale pending", metadata: {} })
          yield* ctx.metadata({ title: "linked", metadata: { sessionId: "ses_child" } }, { durable: true })
          yield* Effect.sleep(INTERVAL_MS * 2)
        }),
      ),
    )

    expect(writes).toEqual([
      { title: "leading", transient: true },
      { title: "linked", transient: false },
    ])
  }),
)

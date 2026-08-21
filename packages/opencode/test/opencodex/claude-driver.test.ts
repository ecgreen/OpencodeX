import { describe, expect } from "bun:test"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { Effect, Layer, Option } from "effect"
import { Agent } from "@/agent/agent"
import { OpencodeXClaudeDriver } from "@/opencodex/claude-driver"
import type { ClaudeMapper } from "@/opencodex/claude-mapper"
import type { ClaudeImage, ClaudePrompt, ClaudeTransport, TransportOptions } from "@/opencodex/claude-transport"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { Todo } from "@/session/todo"
import { testEffect } from "../lib/effect"

const sessionID = "ses_claude_delivery"
const parentMessageID = "msg_user"
let script: () => AsyncIterable<ClaudeMapper.ClaudeEvent> = async function* () {}
let interrupts = 0
let interruptSettles = true
let message: SessionLegacy.Info | undefined
let parts: SessionLegacy.Part[] = []
let prompt: ClaudePrompt | undefined
let transportOptions: TransportOptions | undefined
let metadata: Record<string, unknown> = {}
let history: SessionLegacy.WithParts[] = []

const transport: ClaudeTransport = {
  run(nextPrompt, nextOptions) {
    prompt = nextPrompt
    transportOptions = nextOptions
    return {
      events: script(),
      interrupt: async () => {
        interrupts += 1
        if (!interruptSettles) await new Promise(() => undefined)
      },
    }
  },
}

const sessions = Layer.mock(Session.Service)({
  get: () =>
    Effect.succeed({
      id: sessionID,
      metadata,
      permission: [],
    } as unknown as Session.Info),
  messages: () => Effect.succeed(history),
  setMetadata: () => Effect.void,
  updateMessage: (next) =>
    Effect.sync(() => {
      message = next
      return next
    }),
  updatePart: (next) =>
    Effect.sync(() => {
      parts = [...parts.filter((part) => part.id !== next.id), next]
      return next
    }),
  getPart: ({ partID }) => Effect.sync(() => parts.find((part) => part.id === partID)),
  findMessage: (_sessionID, predicate) =>
    Effect.sync(() => {
      if (!message) return Option.none()
      const found = { info: message, parts }
      return predicate(found) ? Option.some(found) : Option.none()
    }),
})
const dependencies = Layer.mergeAll(
  sessions,
  Layer.mock(Todo.Service)({ update: () => Effect.void }),
  Layer.mock(Permission.Service)({}),
  Layer.mock(Question.Service)({}),
  Layer.mock(Agent.Service)({
    defaultInfo: () => Effect.succeed({ name: "build", mode: "primary", permission: [], options: {} }),
  }),
)
const driver = OpencodeXClaudeDriver.makeLayer({
  transport,
  resolveExecutable: async () => "/test/claude",
}).pipe(Layer.provide(dependencies))
const it = testEffect(driver)

function reset(
  next: () => AsyncIterable<ClaudeMapper.ClaudeEvent>,
  options?: { interruptSettles?: boolean; metadata?: Record<string, unknown>; history?: SessionLegacy.WithParts[] },
) {
  script = next
  interrupts = 0
  interruptSettles = options?.interruptSettles ?? true
  message = undefined
  parts = []
  prompt = undefined
  transportOptions = undefined
  metadata = options?.metadata ?? {}
  history = options?.history ?? []
}

function runTurn(input?: {
  text?: string
  images?: ClaudeImage[]
  delegate?: OpencodeXClaudeDriver.SwarmDelegate
}) {
  return Effect.gen(function* () {
    const service = yield* OpencodeXClaudeDriver.Service
    return yield* service.runTurn({
      sessionID: sessionID as never,
      parentMessageID: parentMessageID as never,
      text: input?.text ?? "hello",
      ...(input?.images ? { images: input.images } : {}),
      ...(input?.delegate ? { delegate: input.delegate } : {}),
      directory: "/test",
      providerID: "claude-code",
      modelID: "sonnet",
    })
  })
}

async function* success() {
  yield { type: "result" as const, subtype: "success", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 0 } }
}

const image: ClaudeImage = {
  type: "image",
  source: { type: "base64", media_type: "image/png", data: "AAA=" },
}

const historyMessage = (id: string, role: string, text: string) =>
  ({ info: { id, role }, parts: [{ type: "text", text }] }) as SessionLegacy.WithParts

function assistantInfo(result: SessionLegacy.WithParts) {
  if (result.info.role !== "assistant") throw new Error("Expected an assistant message")
  return result.info
}

describe("Claude driver delivery finalization", () => {
  it.effect("persists one failed assistant when the stream closes without events", () =>
    Effect.gen(function* () {
      reset(async function* () {})

      const result = yield* runTurn()

      expect(interrupts).toBe(1)
      expect(result.info.id).not.toBe("")
      expect(result.info).toMatchObject({
        time: { completed: expect.any(Number) },
        error: {
          name: "UnknownError",
          data: { message: "Claude response delivery failed before the turn completed." },
        },
      })
      expect(result.parts.map((part) => part.type)).toEqual(["step-start", "step-finish"])
      expect(new Set(result.parts.map((part) => part.messageID))).toEqual(new Set([result.info.id]))
    }),
  )

  it.effect("persists a generic failure when the iterator rejects", () =>
    Effect.gen(function* () {
      reset(() => ({
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject({ secret: "do-not-persist", value: 1n }) }),
      }))

      const result = yield* runTurn()

      expect(interrupts).toBe(1)
      expect(JSON.stringify(result)).not.toContain("do-not-persist")
      expect(assistantInfo(result).error).toMatchObject({
        name: "UnknownError",
        data: { message: "Claude response delivery failed before the turn completed." },
      })
    }),
  )

  it.effect("persists the failure when transport interruption never settles", () =>
    Effect.gen(function* () {
      reset(async function* () {}, { interruptSettles: false })

      const result = yield* runTurn()

      expect(interrupts).toBe(1)
      expect(assistantInfo(result).error).toMatchObject({
        name: "UnknownError",
        data: { message: "Claude response delivery failed before the turn completed." },
      })
    }),
  )

  it.effect("preserves partial text and fails the same assistant", () =>
    Effect.gen(function* () {
      reset(async function* () {
        yield { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Partial answer" }] } }
      })

      const result = yield* runTurn()

      expect(interrupts).toBe(1)
      expect(result.parts.find((part) => part.type === "text")).toMatchObject({ text: "Partial answer" })
      expect(assistantInfo(result).error?.name).toBe("UnknownError")
    }),
  )

  it.effect("does not interrupt or fail a terminal result-only turn", () =>
    Effect.gen(function* () {
      reset(async function* () {
        yield { type: "result", subtype: "success", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 0 } }
      })

      const result = yield* runTurn()

      expect(interrupts).toBe(0)
      expect(assistantInfo(result).error).toBeUndefined()
      expect(result.parts.map((part) => part.type)).toEqual(["step-start", "step-finish"])
    }),
  )
})

/**
 * A delegated role stamps the child session onto the orchestrator's tool part
 * while it runs (prompt-swarm.runSwarmRole), and that stamp is the transcript's
 * only route into the child. The mapper rebuilds the part from the tool_result
 * alone, so the driver has to carry the stamp across that rewrite.
 */
describe("Claude driver swarm delegation", () => {
  it.effect("keeps the delegated child on the tool part after the delegation returns", () =>
    Effect.gen(function* () {
      reset(delegationStream)

      const result = yield* runTurn({ delegate: { roles: [{ name: "Coder" }], run: () => stampChild } })

      const part = result.parts.find((item) => item.type === "tool")
      expect(part).toMatchObject({
        tool: "task",
        callID: "toolu_1",
        state: {
          status: "completed",
          output: "the role's report",
          // The mapper's own metadata still lands; the stamp rides alongside.
          metadata: { sessionId: "ses_child", swarmRole: "Coder" },
        },
      })
    }),
  )

  it.effect("carries the stamp onto a delegation the turn abandons", () =>
    Effect.gen(function* () {
      reset(async function* () {
        yield toolUse()
        yield { type: "text", text: await transportOptions!.delegate!.run(delegated) } as never
      })

      const result = yield* runTurn({ delegate: { roles: [{ name: "Coder" }], run: () => stampChild } })

      expect(result.parts.find((item) => item.type === "tool")).toMatchObject({
        state: { status: "error", metadata: { sessionId: "ses_child", interrupted: true } },
      })
    }),
  )
})

const delegated = { role: "Coder", prompt: "Ship it", toolUseID: "toolu_1" }

const toolUse = () => ({
  type: "assistant" as const,
  message: {
    id: "m1",
    content: [
      { type: "tool_use", id: "toolu_1", name: "mcp__opencodex_swarm__delegate", input: { role: "Coder", prompt: "Ship it" } },
    ],
  },
})

/** Mirrors what prompt-swarm writes onto the parent's running tool part. */
const stampChild = Effect.sync(() => {
  const part = parts.find((item) => item.type === "tool")
  if (part?.type === "tool" && part.state.status === "running")
    parts = [
      ...parts.filter((item) => item.id !== part.id),
      { ...part, state: { ...part.state, metadata: { sessionId: "ses_child", swarmRole: "Coder" } } },
    ]
  return { ok: true as const, text: "the role's report" }
})

async function* delegationStream() {
  yield toolUse()
  const report = await transportOptions!.delegate!.run(delegated)
  yield {
    type: "user" as const,
    message: {
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: report.ok ? report.text : "failed" }],
    },
  }
  yield { type: "result" as const, subtype: "success", total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 0 } }
}

describe("Claude driver prompt assembly", () => {
  it.effect("preserves the text-only transport prompt", () =>
    Effect.gen(function* () {
      reset(success)
      yield* runTurn()
      expect(prompt).toBe("hello")
    }),
  )

  it.effect("sends an image-only turn without an empty text block", () =>
    Effect.gen(function* () {
      reset(success)
      yield* runTurn({ text: "", images: [image] })
      expect(prompt).toEqual([image])
    }),
  )

  it.effect("places text before images in a mixed turn", () =>
    Effect.gen(function* () {
      reset(success)
      yield* runTurn({ text: "describe this", images: [image] })
      expect(prompt).toEqual([{ type: "text", text: "describe this" }, image])
    }),
  )

  it.effect("places the handoff primer before a first-turn image", () =>
    Effect.gen(function* () {
      reset(success, {
        history: [historyMessage("msg_prior", "user", "Earlier request"), historyMessage(parentMessageID, "user", "")],
      })
      yield* runTurn({ text: "", images: [image] })
      expect(prompt).toEqual([{ type: "text", text: expect.stringContaining("User: Earlier request") }, image])
      expect((prompt as Exclude<ClaudePrompt, string>)[0]).toMatchObject({ text: expect.stringMatching(/\n\n$/) })
    }),
  )

  it.effect("does not replay a primer when resuming an image turn", () =>
    Effect.gen(function* () {
      reset(success, {
        metadata: { claudeCode: { conversationID: "conversation-1", launched: true } },
        history: [historyMessage("msg_prior", "user", "Earlier request"), historyMessage(parentMessageID, "user", "")],
      })
      yield* runTurn({ text: "", images: [image] })
      expect(prompt).toEqual([image])
      expect(transportOptions?.resumeID).toBe("conversation-1")
    }),
  )
})

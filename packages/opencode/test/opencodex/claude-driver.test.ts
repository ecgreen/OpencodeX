import { describe, expect } from "bun:test"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { Effect, Layer, Option } from "effect"
import { Agent } from "@/agent/agent"
import { OpencodeXClaudeDriver } from "@/opencodex/claude-driver"
import type { ClaudeMapper } from "@/opencodex/claude-mapper"
import type { ClaudeTransport } from "@/opencodex/claude-transport"
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

const transport: ClaudeTransport = {
  run: () => ({
    events: script(),
    interrupt: async () => {
      interrupts += 1
      if (!interruptSettles) await new Promise(() => undefined)
    },
  }),
}

const sessions = Layer.mock(Session.Service)({
  get: () =>
    Effect.succeed({
      id: sessionID,
      metadata: {},
      permission: [],
    } as unknown as Session.Info),
  messages: () => Effect.succeed([]),
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

function reset(next: () => AsyncIterable<ClaudeMapper.ClaudeEvent>, options?: { interruptSettles?: boolean }) {
  script = next
  interrupts = 0
  interruptSettles = options?.interruptSettles ?? true
  message = undefined
  parts = []
}

function runTurn() {
  return Effect.gen(function* () {
    const service = yield* OpencodeXClaudeDriver.Service
    return yield* service.runTurn({
      sessionID: sessionID as never,
      parentMessageID: parentMessageID as never,
      text: "hello",
      directory: "/test",
      providerID: "claude-code",
      modelID: "sonnet",
    })
  })
}

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

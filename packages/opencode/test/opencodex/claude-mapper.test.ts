import { describe, expect, test } from "bun:test"
import {
  finalizeAbandonedTurn,
  initialState,
  mapEvent,
  normalizeToolName,
  type ClaudeEvent,
  type MapperContext,
  type MapperState,
  type SessionWrite,
} from "../../src/opencodex/claude-mapper"

function context(): MapperContext {
  let part = 0
  let message = 0
  let clock = 1_000
  const brand = <T>(value: string) => value as T
  return {
    sessionID: brand<MapperContext["sessionID"]>("ses_1"),
    parentMessageID: brand<MapperContext["parentMessageID"]>("msg_user"),
    directory: "C:/Work/OpencodeX",
    providerID: "claude-code",
    modelID: "sonnet",
    nextPartID: () => brand<ReturnType<MapperContext["nextPartID"]>>(`prt_${++part}`),
    nextMessageID: () => brand<ReturnType<MapperContext["nextMessageID"]>>(`msg_${++message}`),
    now: () => (clock += 10),
  }
}

function run(events: ClaudeEvent[], initialStateOrCtx: MapperState | MapperContext | undefined = undefined) {
  let state: MapperState
  let ctx: MapperContext

  // Determine if the second argument is a state or context
  if (initialStateOrCtx && "toolParts" in initialStateOrCtx) {
    // It's a state
    state = initialStateOrCtx
    ctx = context()
  } else {
    // It's a context or undefined
    state = initialState()
    ctx = (initialStateOrCtx as MapperContext) || context()
  }

  const writes: SessionWrite[] = []
  for (const event of events) {
    const result = mapEvent(event, state, ctx)
    writes.push(...result.writes)
    state = result.state
  }
  return { writes, state, ctx }
}

const parts = (writes: SessionWrite[]) => writes.flatMap((write) => (write.kind === "part" ? [write.part] : []))
const messages = (writes: SessionWrite[]) => writes.flatMap((write) => (write.kind === "message" ? [write.message] : []))

describe("claude stream-json mapper", () => {
  test("normalizes Claude tool names onto OpencodeX ids so cards render native", () => {
    expect(normalizeToolName("Read")).toBe("read")
    expect(normalizeToolName("TodoWrite")).toBe("todowrite")
    expect(normalizeToolName("MultiEdit")).toBe("edit")
    expect(normalizeToolName("ExitPlanMode")).toBe("plan_exit")
    expect(normalizeToolName("WebFetch")).toBe("webfetch")
    // Unknown/MCP tools pass through lowercased rather than being dropped.
    expect(normalizeToolName("mcp__github__create_issue")).toBe("mcp__github__create_issue")
  })

  test("maps a text turn into one assistant message with step parts", () => {
    const { writes } = run([
      { type: "system", subtype: "init", session_id: "cc-1", model: "claude-fable-5" },
      { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Hello" }] } },
      { type: "result", subtype: "success", total_cost_usd: 0.02, usage: { input_tokens: 10, output_tokens: 5 } },
    ])

    expect(parts(writes).map((part) => part.type)).toEqual(["step-start", "text", "step-finish"])
    const text = parts(writes).find((part) => part.type === "text")
    expect(text).toMatchObject({ sessionID: "ses_1", messageID: "msg_1", text: "Hello" })
    const finished = messages(writes).at(-1)
    // The message is attributed to the catalog route the reader picked, not to
    // the wire id Claude reports, so the transcript header resolves a real model.
    expect(finished).toMatchObject({ role: "assistant", providerID: "claude-code", modelID: "sonnet", parentID: "msg_user", cost: 0.02 })
    expect(finished?.time.completed).toBeGreaterThan(0)
  })

  test("still tracks the wire model Claude reports, for session metadata", () => {
    const { state } = run([{ type: "system", subtype: "init", session_id: "cc-1", model: "claude-fable-5" }])
    expect(state.modelID).toBe("claude-fable-5")
  })

  test("keeps thinking blocks and tool calls on stable part ids across events", () => {
    const { writes } = run([
      { type: "assistant", message: { id: "m1", content: [{ type: "thinking", thinking: "Considering", index: 0 }] } },
      {
        type: "assistant",
        message: { id: "m1", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "a.ts" } }] },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "line one" }] },
      },
    ])

    const reasoning = parts(writes).find((part) => part.type === "reasoning")
    expect(reasoning).toMatchObject({ text: "Considering" })

    const toolWrites = parts(writes).filter((part) => part.type === "tool")
    expect(toolWrites).toHaveLength(2)
    // Same part id for running and completed, so the card transitions in place.
    expect(toolWrites[0].id).toBe(toolWrites[1].id)
    expect(toolWrites[0]).toMatchObject({ tool: "read", state: { status: "running" } })
    expect(toolWrites[1]).toMatchObject({
      tool: "read",
      state: { status: "completed", output: "line one", input: { file_path: "a.ts" } },
    })
  })

  test("normalizes file tool inputs to native keys so transcript titles resolve", () => {
    const { writes } = run([
      {
        type: "assistant",
        message: {
          id: "m1",
          content: [{ type: "tool_use", id: "call_1", name: "Read", input: { file_path: "C:/repo/a.ts", offset: 10 } }],
        },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "call_1", content: "1\tconst a = 1" }] },
      },
    ])
    const tool = parts(writes).filter((part) => part.type === "tool").at(-1)
    expect(tool).toMatchObject({
      state: { input: { filePath: "C:/repo/a.ts", file_path: "C:/repo/a.ts", offset: 10 } },
    })
  })

  test("read results carry a preview so the transcript expander has content", () => {
    const output = Array.from({ length: 30 }, (_, i) => `${i + 1}\tline ${i + 1}`).join("\n")
    const { writes } = run([
      {
        type: "assistant",
        message: { id: "m1", content: [{ type: "tool_use", id: "call_r", name: "Read", input: { file_path: "C:/repo/a.ts" } }] },
      },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "call_r", content: output }] } },
    ])
    const tool = parts(writes).filter((part) => part.type === "tool").at(-1)
    if (tool?.type !== "tool" || tool.state.status !== "completed") throw new Error("expected completed tool part")
    expect(String(tool.state.metadata?.preview).split("\n")).toHaveLength(20)
    expect(tool.state.metadata?.truncated).toBe(true)
  })

  test("stream deltas build text parts that the final event reuses", () => {
    const { writes } = run([
      { type: "stream_event", event: { type: "message_start", message: { id: "m9" } } },
      { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } } },
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } } },
      { type: "assistant", message: { id: "m9", content: [{ type: "text", text: "Hello world" }] } },
    ])
    const texts = parts(writes).filter((part) => part.type === "text")
    expect(texts.length).toBeGreaterThan(1)
    expect(texts.at(-1)).toMatchObject({ text: "Hello world" })
    expect(new Set(texts.map((part) => part.id)).size).toBe(1)
  })

  test("thinking deltas build reasoning parts the final event reuses", () => {
    const { writes } = run([
      { type: "stream_event", event: { type: "message_start", message: { id: "m9" } } },
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Weighing " } } },
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "options" } } },
      { type: "assistant", message: { id: "m9", content: [{ type: "thinking", thinking: "Weighing options" }] } },
    ])
    const reasoning = parts(writes).filter((part) => part.type === "reasoning")
    expect(reasoning.length).toBeGreaterThan(1)
    expect(reasoning.at(-1)).toMatchObject({ text: "Weighing options" })
    expect(new Set(reasoning.map((part) => part.id)).size).toBe(1)
  })

  test("stripped thinking deltas still leave streamed reasoning in place", () => {
    // Fable-style turns strip thinking from the final event (empty text +
    // signature). The streamed content must not be erased by that final write.
    const { writes } = run([
      { type: "stream_event", event: { type: "message_start", message: { id: "m9" } } },
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Real reasoning" } } },
      { type: "assistant", message: { id: "m9", content: [{ type: "thinking", thinking: "", signature: "sig" }] } },
    ])
    const reasoning = parts(writes).filter((part) => part.type === "reasoning")
    expect(reasoning.at(-1)).toMatchObject({ text: "Real reasoning" })
  })

  test("per-block final events reconcile with stream parts by content, not position", () => {
    // The CLI emits one assistant event per content block, so a text block that
    // streamed at index 1 (after a thinking block) arrives in a final event
    // whose content array puts it at position 0. Without content reconciliation
    // this produced duplicate text parts (observed live, 2026-08-09).
    const { writes } = run([
      { type: "stream_event", event: { type: "message_start", message: { id: "m9" } } },
      { type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Now the mapper side" } } },
      { type: "assistant", message: { id: "m9", content: [{ type: "thinking", thinking: "" }] } },
      { type: "assistant", message: { id: "m9", content: [{ type: "text", text: "Now the mapper side" }] } },
    ])
    const texts = parts(writes).filter((part) => part.type === "text")
    expect(new Set(texts.map((part) => part.id)).size).toBe(1)
    expect(texts.at(-1)).toMatchObject({ text: "Now the mapper side" })
  })

  test("distinct api messages in one turn keep distinct text parts", () => {
    const { writes } = run([
      { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "First words" }] } },
      { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "Second words" }] } },
    ])
    const texts = parts(writes).filter((part) => part.type === "text")
    expect(new Set(texts.map((part) => part.id)).size).toBe(2)
  })

  test("marks failed tool results as errors", () => {
    const { writes } = run([
      {
        type: "assistant",
        message: { id: "m1", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "exit 1" } }] },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "boom", is_error: true }] },
      },
    ])

    expect(parts(writes).at(-1)).toMatchObject({ tool: "bash", state: { status: "error", error: "boom" } })
  })

  test("emits todo updates alongside the TodoWrite tool card", () => {
    const { writes } = run([
      {
        type: "assistant",
        message: {
          id: "m1",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "TodoWrite",
              input: { todos: [{ content: "Ship it", status: "in_progress", priority: "high" }] },
            },
          ],
        },
      },
    ])

    expect(writes.find((write) => write.kind === "todos")).toEqual({
      kind: "todos",
      todos: [{ content: "Ship it", status: "in_progress", priority: "high" }],
    })
  })

  test("bills only the per-turn delta of a cumulative cost total", () => {
    const ctx = context()
    let state = initialState()
    const collect = (event: ClaudeEvent) => {
      const result = mapEvent(event, state, ctx)
      state = result.state
      return result.writes
    }

    collect({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "one" }] } })
    const first = collect({ type: "result", subtype: "success", total_cost_usd: 0.05, usage: { input_tokens: 10, output_tokens: 4 } })
    expect(parts(first).find((part) => part.type === "step-finish")).toMatchObject({ cost: 0.05 })

    // Second turn: Claude reports 0.09 cumulative, so this turn cost 0.04.
    state = { ...state, messageID: undefined, finished: false }
    collect({ type: "assistant", message: { id: "m2", content: [{ type: "text", text: "two" }] } })
    const second = collect({ type: "result", subtype: "success", total_cost_usd: 0.09, usage: { input_tokens: 12, output_tokens: 6 } })
    const step = parts(second).find((part) => part.type === "step-finish")
    expect(step?.type === "step-finish" ? step.cost : undefined).toBeCloseTo(0.04, 10)
    expect(step).toMatchObject({ tokens: { input: 12, output: 6, cache: { read: 0, write: 0 } } })
  })

  test("records an error and flags auth failures from a failed result", () => {
    const { writes, state } = run([
      { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "hi" }] } },
      { type: "result", subtype: "error_during_execution", is_error: true, result: "Not logged in. Please run /login" },
    ])

    expect(state.authFailed).toBe(true)
    expect(messages(writes).at(-1)?.error).toMatchObject({ data: { message: "Not logged in. Please run /login" } })
  })

  test("closes running tools and the message when a turn is abandoned", () => {
    const ctx = context()
    const started = run(
      [
        {
          type: "assistant",
          message: { id: "m1", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "sleep 60" } }] },
        },
      ],
      ctx,
    )

    const { writes, state } = finalizeAbandonedTurn(started.state, ctx, { reason: "interrupted", error: "Stopped." })
    const tool = parts(writes).find((part) => part.type === "tool")
    expect(tool).toMatchObject({ state: { status: "error", error: "Stopped." } })
    expect(parts(writes).some((part) => part.type === "step-finish")).toBe(true)
    expect(messages(writes).at(-1)?.time.completed).toBeGreaterThan(0)
    expect(state.toolParts.size).toBe(0)
  })

  test("flags a refused resume so the unusable conversation id gets dropped", () => {
    // A rejected --resume never reaches system.init, so the turn ends having
    // never named a conversation. Reusing that id would fail every later turn.
    const refused = run([{ type: "result", subtype: "error_during_execution", is_error: true }])
    expect(refused.state.resumeRejected).toBe(true)
    expect(refused.state.claudeSessionID).toBeUndefined()
    expect(messages(refused.writes).at(-1)?.error).toMatchObject({
      data: { message: expect.stringContaining("starts a fresh one") },
    })
  })

  test("keeps the conversation id when a turn fails after it started", () => {
    const started = run([
      { type: "system", subtype: "init", session_id: "cc-1" },
      { type: "result", subtype: "error_max_turns", is_error: true },
    ])
    expect(started.state.claudeSessionID).toBe("cc-1")
    expect(started.state.resumeRejected).toBeUndefined()
  })

  test("treats a success subtype carrying is_error as a failure", () => {
    // An unusable model reports subtype "success" with is_error set.
    const { writes } = run([
      { type: "result", subtype: "success", is_error: true, result: "There's an issue with the selected model." },
    ])
    expect(messages(writes).at(-1)?.error).toMatchObject({
      data: { message: "There's an issue with the selected model." },
    })
  })

  test("ignores unknown events and malformed content without throwing", () => {
    const before = initialState()
    const after = mapEvent({ type: "stream_event", event: { type: "ping" } } as ClaudeEvent, before, context())
    expect(after.writes).toEqual([])

    const malformed = run([{ type: "assistant", message: { id: "m1", content: "plain string" } }])
    expect(parts(malformed.writes).map((part) => part.type)).toEqual(["step-start", "text"])
  })
})

describe("task tools feed the todo system", () => {
  function toolTurn(tool: string, input: Record<string, unknown>, resultText: string) {
    return [
      { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: `call_${tool}`, name: tool, input }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: `call_${tool}`, content: [{ type: "text", text: resultText }] }] } },
    ] as ClaudeEvent[]
  }

  test("taskcreate registers a pending todo and emits the todos write", () => {
    const { writes } = run([
      ...toolTurn("TaskCreate", { subject: "Fix login", description: "d" }, "Task #1 created successfully: Fix login"),
    ])
    const todos = writes.filter((w) => w.kind === "todos").at(-1)
    expect(todos).toMatchObject({ kind: "todos", todos: [{ content: "Fix login", status: "pending" }] })
  })

  test("taskupdate changes status; deleted removes; unknown id is ignored", () => {
    const { writes } = run([
      ...toolTurn("TaskCreate", { subject: "Fix login" }, "Task #1 created successfully: Fix login"),
      ...toolTurn("TaskUpdate", { taskId: "1", status: "in_progress" }, "Updated task #1 status"),
      ...toolTurn("TaskUpdate", { taskId: "99", status: "completed" }, "no such task"),
      ...toolTurn("TaskUpdate", { taskId: "1", status: "deleted" }, "deleted"),
    ])
    const lists = writes.filter((w) => w.kind === "todos").map((w) => w.todos)
    expect(lists.at(0)).toEqual([{ content: "Fix login", status: "pending" }])
    expect(lists.at(1)).toEqual([{ content: "Fix login", status: "in_progress" }])
    expect(lists.at(-1)).toEqual([])
    // the unknown-id update emitted no todos write
    expect(lists.length).toBe(3)
  })

  test("taskcreate result without a parseable id falls back to a local id", () => {
    const { writes, state } = run([
      ...toolTurn("TaskCreate", { subject: "A" }, "ok"),
      ...toolTurn("TaskCreate", { subject: "B" }, "ok"),
    ])
    expect([...state.tasks.keys()]).toEqual(["local-1", "local-2"])
  })

  test("completed task-tool parts carry metadata.todos for the transcript widget", () => {
    const { writes } = run([
      ...toolTurn("TaskCreate", { subject: "Fix login" }, "Task #1 created successfully: Fix login"),
    ])
    const part = writes.filter((w) => w.kind === "part").map((w) => w.part).findLast((p) => p.type === "tool")
    expect(part?.state).toMatchObject({ status: "completed", metadata: { todos: [{ content: "Fix login", status: "pending" }] } })
  })

  test("tasks seed from a prior turn's registry", () => {
    const state = initialState({ tasks: [{ id: "1", subject: "Fix login", status: "in_progress" }] })
    const { writes } = run([
      ...toolTurn("TaskUpdate", { taskId: "1", status: "completed" }, "Updated"),
    ], state)
    const todos = writes.filter((w) => w.kind === "todos").at(-1)
    expect(todos?.todos).toEqual([{ content: "Fix login", status: "completed" }])
  })
})

function _typecheckState(state: MapperState) {
  return state.billed.cost
}

describe("decided input recording", () => {
  test("the finished part carries the input the permission gate approved, not the model's original", () => {
    const decided = new Map<string, Record<string, unknown>>([
      ["toolu_q", { questions: [{ question: "Which way?" }], answers: { "Which way?": "Left" } }],
    ])
    const ctx = { ...context(), decidedInput: (callID: string) => decided.get(callID) }
    const { writes } = run(
      [
        {
          type: "assistant",
          message: {
            id: "m1",
            content: [{ type: "tool_use", id: "toolu_q", name: "AskUserQuestion", input: { questions: [{ question: "Which way?" }] } }],
          },
        },
        {
          type: "user",
          message: { content: [{ type: "tool_result", tool_use_id: "toolu_q", content: "User selected Left" }] },
        },
      ],
      ctx,
    )
    const finished = parts(writes).filter((part) => part.type === "tool").at(-1)
    expect(finished).toMatchObject({
      tool: "question",
      state: { status: "completed", input: { answers: { "Which way?": "Left" } } },
    })
  })

  test("a turn result closes still-open tool parts so nothing shows as running forever", () => {
    const { writes } = run([
      {
        type: "assistant",
        message: {
          id: "m1",
          content: [{ type: "tool_use", id: "toolu_q", name: "AskUserQuestion", input: { questions: [] } }],
        },
      },
      // No tool_result: the question was rejected and the CLI went straight to the result.
      { type: "result", subtype: "success" },
    ])
    const finished = parts(writes).filter((part) => part.type === "tool").at(-1)
    expect(finished).toMatchObject({
      tool: "question",
      state: { status: "error", metadata: { interrupted: true } },
    })
  })
})

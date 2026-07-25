import type { Part } from "@opencode-ai/sdk/v2/client"
import { describe, expect, mock, test } from "bun:test"
import type { MessageBundle } from "../src/renderer/src/lib/store"

// Isolate pure exports from UI modules that load Vite worker URLs unsupported by Bun tests.
mock.module("@opencode-ai/ui/file", () => ({ File: () => null }))
mock.module("@opencode-ai/ui/markdown", () => ({ Markdown: () => null }))

const { activeTranscriptStreamingPartID, groupTranscriptParts } = await import("../src/renderer/src/components/session-transcript")
const { toolGroupSummary, toolGroupTitle } = await import("../src/renderer/src/lib/transcript-grouping")

describe("GUI session transcript parts", () => {
  test("assigns stable keys to parts and growing groups", () => {
    expect(groupTranscriptParts([textPart("text", "answer")]).map((item) => item.key)).toEqual(["part:text"])
    expect(groupTranscriptParts([textPart("text", "updated")]).map((item) => item.key)).toEqual(["part:text"])

    const toolKey = groupTranscriptParts([toolPart("read-1"), toolPart("read-2")])[0]?.key
    expect(toolKey).toBe("tool-group:read:read-1")
    expect(groupTranscriptParts([toolPart("read-1", "running"), toolPart("read-2"), toolPart("read-3")])[0]?.key).toBe(toolKey)

    const reasoningKey = groupTranscriptParts([reasoningPart("reasoning-1", "first"), reasoningPart("reasoning-2", "second")])[0]?.key
    expect(reasoningKey).toBe("reasoning-group:reasoning-1")
    expect(groupTranscriptParts([reasoningPart("reasoning-1", "updated"), reasoningPart("reasoning-2", "second"), reasoningPart("reasoning-3", "third")])[0]?.key).toBe(reasoningKey)
  })

  test("groups a lone reasoning part so thinking has one renderer", () => {
    const items = groupTranscriptParts([reasoningPart("reasoning-1", "first")])
    expect(items.map((item) => item.type)).toEqual(["reasoning-group"])
    // The key must not change as the run grows, or the block remounts mid-stream.
    expect(items[0]?.key).toBe(groupTranscriptParts([reasoningPart("reasoning-1", "first"), reasoningPart("reasoning-2", "second")])[0]?.key)
  })

  test("summarizes grouped tools by what they touched", () => {
    expect(toolGroupTitle("read", [readPart("a", "src/app.ts"), readPart("b", "src/store.ts")])).toBe("Read 2 files")
    expect(toolGroupTitle("skill", [readPart("a", "x")])).toBe("Load 1 skill")
    expect(toolGroupSummary("read", [readPart("a", "src/app.ts"), readPart("b", "src/store.ts")])).toBe("app.ts, store.ts")
    expect(toolGroupSummary("read", ["a", "b", "c", "d"].map((id, index) => readPart(id, `src/file${index}.ts`), ), 2)).toBe("file0.ts, file1.ts, +2 more")
  })

  test("selects only the active unfinished transcript tail", () => {
    const text = textPart("text", "answer")
    const reasoning = reasoningPart("reasoning", "thinking")

    expect(activeTranscriptStreamingPartID([assistantMessage([text])], true)).toBe("text")
    expect(activeTranscriptStreamingPartID([assistantMessage([text, reasoning])], true)).toBe("reasoning")
    expect(activeTranscriptStreamingPartID([assistantMessage([text, toolPart("read")])], true)).toBeUndefined()
    expect(activeTranscriptStreamingPartID([assistantMessage([text])], false)).toBeUndefined()
  })

  test("keeps ended parts and completed messages out of streaming mode", () => {
    expect(activeTranscriptStreamingPartID([assistantMessage([textPart("text", "answer", 2)])], true)).toBeUndefined()
    expect(activeTranscriptStreamingPartID([assistantMessage([reasoningPart("reasoning", "thinking", 2)])], true)).toBeUndefined()
    expect(activeTranscriptStreamingPartID([assistantMessage([textPart("text", "answer")], 2)], true)).toBeUndefined()
  })
})

function textPart(id: string, text: string, end?: number): Part {
  return {
    id,
    sessionID: "session",
    messageID: "message",
    type: "text",
    text,
    time: { start: 1, ...(end === undefined ? {} : { end }) },
  }
}

function reasoningPart(id: string, text: string, end?: number): Part {
  return {
    id,
    sessionID: "session",
    messageID: "message",
    type: "reasoning",
    text,
    time: { start: 1, ...(end === undefined ? {} : { end }) },
  }
}

function toolPart(id: string, status: "pending" | "running" | "completed" = "completed"): Part {
  if (status === "completed") {
    return {
      id,
      sessionID: "session",
      messageID: "message",
      type: "tool",
      tool: "read",
      callID: id,
      state: { status, input: {}, output: "", title: "Read", metadata: {}, time: { start: 1, end: 2 } },
    }
  }
  return {
    id,
    sessionID: "session",
    messageID: "message",
    type: "tool",
    tool: "read",
    callID: id,
    state: status === "running" ? { status, input: {}, title: "Read", metadata: {}, time: { start: 1 } } : { status, input: {}, raw: "" },
  }
}

function readPart(id: string, filePath: string): Extract<Part, { type: "tool" }> {
  return {
    id,
    sessionID: "session",
    messageID: "message",
    type: "tool",
    tool: "read",
    callID: id,
    state: { status: "completed", input: { filePath, name: filePath }, output: "", title: "Read", metadata: {}, time: { start: 1, end: 2 } },
  }
}

function assistantMessage(parts: Part[], completed?: number): MessageBundle {
  return {
    info: {
      id: "message",
      sessionID: "session",
      role: "assistant",
      time: { created: 1, ...(completed === undefined ? {} : { completed }) },
      parentID: "user",
      modelID: "model",
      providerID: "provider",
      mode: "build",
      agent: "build",
      path: { cwd: "C:\\Work", root: "C:\\Work" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts,
  }
}

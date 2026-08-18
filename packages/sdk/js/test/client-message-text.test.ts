import { describe, expect, test } from "bun:test"
import type { Part } from "../src/v2/client"
import {
  displayClientMessageText,
  isStreamingClientDisplayPart,
  normalizeClientDisplayPart,
} from "../src/v2/client-message-text"

describe("displayClientMessageText", () => {
  test("leaves normal markdown unchanged", () => {
    expect(displayClientMessageText("# Result\n\n- item")).toBe("# Result\n\n- item")
  })

  test("unwraps JSON-encoded strings", () => {
    expect(displayClientMessageText(JSON.stringify("hello\nworld"))).toBe("hello\nworld")
  })

  test("unwraps visible channel fields and hides analysis", () => {
    expect(displayClientMessageText(JSON.stringify({ analysis: "hidden", commentary: "working", final: "done" }))).toBe(
      "working\n\ndone",
    )
    expect(displayClientMessageText(JSON.stringify({ channel: "final", content: "done" }))).toBe("done")
  })

  test("unwraps OpenAI-style response envelopes", () => {
    expect(
      displayClientMessageText(
        JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }] }),
      ),
    ).toBe("done")
    expect(displayClientMessageText(JSON.stringify({ choices: [{ message: { role: "assistant", content: "done" } }] }))).toBe(
      "done",
    )
  })

  test("leaves arbitrary JSON data visible", () => {
    const raw = JSON.stringify({ content: "intentional", count: 2 })
    expect(displayClientMessageText(raw)).toBe(raw)
  })

  test("preserves literal internal-looking markup", () => {
    expect(displayClientMessageText("hello\n<system-reminder>literal</system-reminder>\nworld")).toBe(
      "hello\n<system-reminder>literal</system-reminder>\nworld",
    )
    expect(displayClientMessageText("<swarm-briefing>literal</swarm-briefing>")).toBe(
      "<swarm-briefing>literal</swarm-briefing>",
    )
  })
})

describe("normalizeClientDisplayPart", () => {
  test("returns non-text parts by identity", () => {
    const part = { id: "part-1", sessionID: "s", messageID: "m", type: "step-start" } as Part
    expect(normalizeClientDisplayPart(part)).toBe(part)
  })

  test("passes a streaming part through untouched", () => {
    const part = textPart(JSON.stringify({ channel: "final", content: "done" }), { start: 1 })
    expect(isStreamingClientDisplayPart(part)).toBe(true)
    expect(normalizeClientDisplayPart(part)).toBe(part)
  })

  test("normalizes a completed part and caches the result by identity", () => {
    const part = textPart(JSON.stringify({ channel: "final", content: "done" }), { start: 1, end: 2 })
    const normalized = normalizeClientDisplayPart(part)
    expect(normalized).not.toBe(part)
    expect(normalized).toMatchObject({ type: "text", text: "done" })
    expect(normalizeClientDisplayPart(part)).toBe(normalized)
  })

  test("normalizes parts that never carry timing, such as user prompts", () => {
    const part = textPart(JSON.stringify({ channel: "final", content: "done" }))
    expect(isStreamingClientDisplayPart(part)).toBe(false)
    expect(normalizeClientDisplayPart(part)).toMatchObject({ text: "done" })
  })

  test("preserves literal internal-looking markup in user prompts", () => {
    const text = "show <system-reminder>literal</system-reminder> and <swarm-briefing>literal</swarm-briefing>"
    expect(normalizeClientDisplayPart(textPart(text))).toMatchObject({ text })
  })

  test("classifies marked compaction continuation when the synthetic flag is absent", () => {
    const part = { ...textPart("continue", { start: 1 }), metadata: { compaction_continue: true } }
    const normalized = normalizeClientDisplayPart(part)
    expect(normalized).toMatchObject({ synthetic: true })
    expect(normalizeClientDisplayPart(part)).toBe(normalized)
  })

  test("preserves explicit non-synthetic compaction text", () => {
    const part = { ...textPart("continue", { start: 1 }), synthetic: false, metadata: { compaction_continue: true } }
    expect(normalizeClientDisplayPart(part)).toBe(part)
  })
})

function textPart(text: string, time?: { start: number; end?: number }): Part {
  return { id: "part-1", sessionID: "session-1", messageID: "message-1", type: "text", text, ...(time ? { time } : {}) }
}

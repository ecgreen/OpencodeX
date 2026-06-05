import { describe, expect, test } from "bun:test"
import { displayMessageText } from "../src/renderer/src/lib/message-text"

describe("displayMessageText", () => {
  test("leaves normal markdown unchanged", () => {
    expect(displayMessageText("# Result\n\n- item")).toBe("# Result\n\n- item")
  })

  test("unwraps JSON-encoded strings", () => {
    expect(displayMessageText(JSON.stringify("hello\nworld"))).toBe("hello\nworld")
  })

  test("unwraps visible channel fields and hides analysis", () => {
    expect(displayMessageText(JSON.stringify({ analysis: "hidden", commentary: "working", final: "done" }))).toBe("working\n\ndone")
    expect(displayMessageText(JSON.stringify({ channel: "final", content: "done" }))).toBe("done")
  })

  test("unwraps OpenAI-style response envelopes", () => {
    expect(displayMessageText(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }] }))).toBe("done")
    expect(displayMessageText(JSON.stringify({ choices: [{ message: { role: "assistant", content: "done" } }] }))).toBe("done")
  })

  test("leaves arbitrary JSON data visible", () => {
    const raw = JSON.stringify({ content: "intentional", count: 2 })
    expect(displayMessageText(raw)).toBe(raw)
  })

  test("strips internal system reminders from persisted text", () => {
    expect(displayMessageText("hello\n<system-reminder>secret</system-reminder>\nworld")).toBe("hello\nworld")
    expect(displayMessageText("<system-reminder>secret</system-reminder>")).toBe("")
  })
})

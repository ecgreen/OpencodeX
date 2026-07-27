import { describe, expect, test } from "bun:test"
import type { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { HANDOFF_CHAR_BUDGET, buildHandoff, handoffMessages, withHandoff } from "../../src/opencodex/claude-handoff"

type Bundle = SessionLegacy.WithParts

function message(role: string, parts: Array<Record<string, unknown>>): Bundle {
  return { info: { id: `msg_${role}`, role }, parts } as unknown as Bundle
}

const text = (value: string, extra: Record<string, unknown> = {}) => ({ type: "text", text: value, ...extra })

describe("claude handoff", () => {
  test("replays the earlier exchange so a taken-over session is not amnesiac", () => {
    const handoff = buildHandoff([
      message("user", [text("Rename the widget module.")]),
      message("assistant", [text("Renamed it to gadget.ts."), { type: "tool", tool: "edit" }]),
    ])
    expect(handoff).toContain("User: Rename the widget module.")
    expect(handoff).toContain("Assistant: Renamed it to gadget.ts.")
    expect(handoff).toContain("[used: edit]")
    // It has to read as context, not as a request to answer.
    expect(handoff).toContain("context only")
  })

  test("keeps the order the conversation actually happened in", () => {
    const handoff = buildHandoff([
      message("user", [text("first")]),
      message("assistant", [text("second")]),
      message("user", [text("third")]),
    ])!
    expect(handoff.indexOf("first")).toBeLessThan(handoff.indexOf("second"))
    expect(handoff.indexOf("second")).toBeLessThan(handoff.indexOf("third"))
  })

  test("drops the oldest turns first when the budget runs out", () => {
    const filler = "x".repeat(1_500)
    const many = Array.from({ length: 40 }, (_, index) => message("user", [text(`${index}-${filler}`)]))
    const handoff = buildHandoff(many)!
    expect(handoff.length).toBeLessThan(HANDOFF_CHAR_BUDGET + 1_000)
    // The most recent turns are the ones worth carrying over.
    expect(handoff).toContain("39-")
    expect(handoff).not.toContain("0-")
  })

  test("clips a single oversized message instead of dropping it", () => {
    const handoff = buildHandoff([message("user", [text("y".repeat(5_000))])])!
    expect(handoff).toContain("[truncated]")
    expect(handoff.length).toBeLessThan(HANDOFF_CHAR_BUDGET)
  })

  test("ignores synthetic and empty parts that would only add noise", () => {
    expect(handoffMessages([message("user", [text("hidden", { synthetic: true })])])).toEqual([])
    expect(handoffMessages([message("assistant", [text("  ")])])).toEqual([])
    expect(handoffMessages([message("assistant", [{ type: "reasoning", text: "thinking out loud" }])])).toEqual([])
  })

  test("records each tool once rather than per call", () => {
    const [entry] = handoffMessages([
      message("assistant", [
        text("done"),
        { type: "tool", tool: "read" },
        { type: "tool", tool: "read" },
        { type: "tool", tool: "bash" },
      ]),
    ])
    expect(entry?.tools).toEqual(["read", "bash"])
  })

  test("sends the prompt untouched when there is no prior conversation", () => {
    expect(buildHandoff([])).toBeUndefined()
    expect(withHandoff("Do the thing", [])).toBe("Do the thing")
    expect(withHandoff("Do the thing", [message("user", [text("earlier")])])).toEndWith("\n\nDo the thing")
  })
})

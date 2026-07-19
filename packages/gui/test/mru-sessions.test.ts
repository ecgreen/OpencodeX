import { describe, expect, test } from "bun:test"
import { initialMruCursor, moveMruCursor, mruSessionCandidates, pruneMruSessions, touchMruSession } from "../src/renderer/src/lib/mru-sessions"
import { session } from "./functional/fixtures"

describe("MRU session list", () => {
  test("touch moves the session to the front and dedupes", () => {
    expect(touchMruSession(["a", "b", "c"], "b")).toEqual(["b", "a", "c"])
    expect(touchMruSession(["a"], "d")).toEqual(["d", "a"])
  })

  test("touch caps the list at the limit", () => {
    const list = Array.from({ length: 20 }, (_, index) => `s${index}`)
    expect(touchMruSession(list, "new")).toHaveLength(20)
    expect(touchMruSession(list, "new")[0]).toBe("new")
  })

  test("prune drops sessions that no longer exist", () => {
    expect(pruneMruSessions(["a", "b", "c"], new Set(["a", "c"]))).toEqual(["a", "c"])
  })

  test("prune keeps list identity when nothing changed", () => {
    const list = ["a", "b"]
    expect(pruneMruSessions(list, new Set(["a", "b"]))).toBe(list)
  })

  test("candidates exclude non-renderable snapshot sessions before applying MRU order", () => {
    const hidden = session("internal", { title: "New session" })
    const visible = session("visible")
    const started = session("started", { title: "New session", cost: 1 })

    expect(mruSessionCandidates([hidden.id, visible.id], [hidden, started, visible]).map((item) => item.id))
      .toEqual([visible.id, started.id])
  })

  test("cursor movement wraps in both directions", () => {
    expect(moveMruCursor(0, 1, 3)).toBe(1)
    expect(moveMruCursor(0, -1, 3)).toBe(2)
    expect(moveMruCursor(2, 1, 3)).toBe(0)
    expect(moveMruCursor(4, 1, 0)).toBe(0)
  })

  test("initial cursor selects the entry after the current session", () => {
    expect(initialMruCursor("a", ["a", "b", "c"], 1)).toBe(1)
    expect(initialMruCursor("a", ["a", "b", "c"], -1)).toBe(2)
    expect(initialMruCursor("c", ["a", "b", "c"], 1)).toBe(0)
  })

  test("initial cursor starts at the edge when the current session is not listed", () => {
    expect(initialMruCursor(undefined, ["a", "b"], 1)).toBe(0)
    expect(initialMruCursor(undefined, ["a", "b"], -1)).toBe(1)
    expect(initialMruCursor("unknown", ["a", "b"], 1)).toBe(0)
    expect(initialMruCursor("a", [], 1)).toBe(0)
  })
})

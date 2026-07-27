import { describe, expect, test } from "bun:test"
import { sameValue } from "../src/renderer/src/lib/same-value"

describe("GUI structural equality", () => {
  test("short-circuits shared branches and compares changed values", () => {
    const shared = { value: "stable" }
    expect(sameValue([shared, { text: "same" }], [shared, { text: "same" }])).toBe(true)
    expect(sameValue([shared, { text: "before" }], [shared, { text: "after" }])).toBe(false)
  })
})

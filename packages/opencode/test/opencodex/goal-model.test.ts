import { describe, expect, test } from "bun:test"
import { nodeJobKey, runSerial } from "../../src/opencodex/goal-model"

describe("run serial", () => {
  test("defaults to zero and ignores junk", () => {
    expect(runSerial({ metadata: undefined })).toBe(0)
    expect(runSerial({ metadata: {} })).toBe(0)
    expect(runSerial({ metadata: { runSerial: "3" } })).toBe(0)
    expect(runSerial({ metadata: { runSerial: -1 } })).toBe(0)
    expect(runSerial({ metadata: { runSerial: 2.5 } })).toBe(0)
    expect(runSerial({ metadata: { runSerial: 4 } })).toBe(4)
  })

  test("the first run keeps the legacy key shape", () => {
    expect(nodeJobKey({ id: "oxg_1", metadata: undefined }, "build", 0)).toBe("oxg_1:build:0")
  })

  test("a later run never collides with an earlier run's key", () => {
    // This is the property that keeps a standing goal's second sweep, or a
    // re-queued failed node, from adopting a finished job and hanging forever.
    const first = nodeJobKey({ id: "oxg_1", metadata: undefined }, "build", 0)
    const second = nodeJobKey({ id: "oxg_1", metadata: { runSerial: 1 } }, "build", 0)
    const third = nodeJobKey({ id: "oxg_1", metadata: { runSerial: 2 } }, "build", 0)
    expect(new Set([first, second, third]).size).toBe(3)
  })

  test("iterations within one run stay distinct", () => {
    const goal = { id: "oxg_1", metadata: { runSerial: 1 } }
    expect(nodeJobKey(goal, "patch", 1)).not.toBe(nodeJobKey(goal, "patch", 2))
  })
})

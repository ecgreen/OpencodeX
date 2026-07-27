import { describe, expect, test } from "bun:test"
import { numberedDuplicateOpenTabLabels, openTabLayoutWidth, visibleOpenTabIDs, type OpenTabLayoutMeasurements } from "../src/renderer/src/lib/open-tabs"

describe("GUI open tab overflow layout", () => {
  test("keeps every tab visible when the measured row fits with the new-tab button", () => {
    const ids = ["a", "b", "c"]
    expect(openTabLayoutWidth({ ids, hiddenCount: 0, measurements: measurements(ids) })).toBe(508)
    expect(visibleOpenTabIDs({
      ids,
      activeID: "b",
      width: 508,
      measurements: measurements(ids),
    })).toEqual(ids)
  })

  test("reserves space for both the overflow tab and the new-tab button", () => {
    const ids = ["a", "b", "c", "d"]
    expect(visibleOpenTabIDs({
      ids,
      activeID: "a",
      width: 553,
      measurements: measurements(ids),
    })).toEqual(["a", "b"])
  })

  test("keeps the active tab visible when it can replace the last visible prefix tab", () => {
    const ids = ["a", "b", "c", "d"]
    expect(visibleOpenTabIDs({
      ids,
      activeID: "d",
      width: 430,
      measurements: measurements(ids),
    })).toEqual(["a", "d"])
  })

  test("avoids an all-tabs spill before the first width measurement", () => {
    const ids = ["a", "b", "c", "d"]
    expect(visibleOpenTabIDs({
      ids,
      activeID: "c",
      width: 0,
      measurements: measurements(ids),
    })).toEqual(["c"])
  })

  test("numbers duplicate display labels after the first tab", () => {
    expect(numberedDuplicateOpenTabLabels([
      { id: "terminal-1", label: "Terminal" },
      { id: "file", label: "README.md" },
      { id: "terminal-2", label: "Terminal" },
      { id: "terminal-3", label: "Terminal" },
    ])).toEqual({
      "terminal-1": "Terminal",
      file: "README.md",
      "terminal-2": "Terminal 2",
      "terminal-3": "Terminal 3",
    })
  })

  test("skips generated labels that would collide with existing labels", () => {
    expect(numberedDuplicateOpenTabLabels([
      { id: "named", label: "Terminal 2" },
      { id: "terminal-1", label: "Terminal" },
      { id: "terminal-2", label: "Terminal" },
    ])).toEqual({
      named: "Terminal 2",
      "terminal-1": "Terminal",
      "terminal-2": "Terminal 3",
    })
  })
})

function measurements(ids: string[]): OpenTabLayoutMeasurements {
  return {
    tabs: Object.fromEntries(ids.map((id) => [id, 150])),
    overflow: Object.fromEntries(ids.map((_, index) => [index + 1, 72])),
    newTab: 30,
    padding: 16,
    gap: 4,
  }
}

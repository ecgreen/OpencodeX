import { describe, expect, test } from "bun:test"
import { droppedReorderIDs, moveByOffset, moveRelative } from "../src/renderer/src/lib/reorder"

describe("GUI reorder helpers", () => {
  test("moves ids by keyboard offset", () => {
    expect(moveByOffset(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"])
    expect(moveByOffset(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"])
    expect(moveByOffset(["a", "b", "c"], "a", -1)).toEqual([])
    expect(moveByOffset(["a", "b", "c"], "x", 1)).toEqual([])
  })

  test("moves ids relative to a drop target", () => {
    expect(moveRelative(["a", "b", "c"], "a", "c", "before")).toEqual(["b", "a", "c"])
    expect(moveRelative(["a", "b", "c"], "a", "c", "after")).toEqual(["b", "c", "a"])
    expect(moveRelative(["a", "b", "c"], "x", "c", "after")).toEqual([])
    expect(moveRelative(["a", "b", "c"], "a", "x", "after")).toEqual([])
  })

  test("filters invalid drag/drop sources before reordering", () => {
    expect(droppedReorderIDs({
      ids: ["project-a", "project-b", "project-c"],
      source: { type: "project", id: "project-a" },
      sourceType: "project",
      targetID: "project-c",
      placement: "after",
    })).toEqual(["project-b", "project-c", "project-a"])
    expect(droppedReorderIDs({
      ids: ["project-a", "project-b"],
      source: { type: "view", id: "project-a" },
      sourceType: "project",
      targetID: "project-b",
      placement: "before",
    })).toEqual([])
    expect(droppedReorderIDs({
      ids: ["project-a", "project-b"],
      source: { type: "project", id: "project-a" },
      sourceType: "project",
      targetID: "project-a",
      placement: "before",
    })).toEqual([])
  })
})

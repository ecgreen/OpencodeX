import { describe, expect, test } from "bun:test"
import { virtualWindow } from "../src/renderer/src/lib/virtual-window"

describe("virtualWindow", () => {
  test("bounds mounted rows around the viewport", () => {
    expect(virtualWindow({ count: 5_000, rowHeight: 32, scrollTop: 3_200, viewportHeight: 320, overscan: 4 })).toEqual({
      start: 96,
      end: 114,
      totalHeight: 160_000,
    })
  })

  test("clamps the first and last windows", () => {
    expect(virtualWindow({ count: 10, rowHeight: 32, scrollTop: -20, viewportHeight: 64, overscan: 3 })).toEqual({ start: 0, end: 5, totalHeight: 320 })
    expect(virtualWindow({ count: 10, rowHeight: 32, scrollTop: 9_000, viewportHeight: 64, overscan: 3 })).toEqual({ start: 10, end: 10, totalHeight: 320 })
  })
})

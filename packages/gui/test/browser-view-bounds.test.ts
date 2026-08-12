import { expect, test } from "bun:test"
import { browserViewBoundsForZoom } from "../src/main/browser-view-bounds"

test("native browser bounds follow renderer zoom without crossing the host edges", () => {
  expect(browserViewBoundsForZoom({ x: 100.25, y: 20.5, width: 399.5, height: 600.25 }, 1.25)).toEqual({
    x: 126,
    y: 26,
    width: 498,
    height: 749,
  })
})

test("native browser bounds preserve CSS coordinates at default zoom", () => {
  expect(browserViewBoundsForZoom({ x: 100, y: 20, width: 400, height: 600 }, 1)).toEqual({
    x: 100,
    y: 20,
    width: 400,
    height: 600,
  })
})

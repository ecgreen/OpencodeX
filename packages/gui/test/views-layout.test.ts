import { describe, expect, test } from "bun:test"
import { viewDensity, viewLayout, viewLayoutDimensions } from "../src/renderer/src/components/views"

describe("GUI view layouts", () => {
  test("uses a compact presentation for multi-pane views", () => {
    expect(viewDensity(1)).toBe("comfortable")
    expect(viewDensity(2)).toBe("compact")
    expect(viewDensity(8)).toBe("compact")
  })

  test("reserves usable rows and columns for every supported layout", () => {
    expect(Array.from({ length: 8 }, (_, index) => viewLayoutDimensions(viewLayout(index + 1)))).toEqual([
      { columns: 1, rows: 1 },
      { columns: 2, rows: 1 },
      { columns: 2, rows: 2 },
      { columns: 2, rows: 2 },
      { columns: 2, rows: 3 },
      { columns: 3, rows: 2 },
      { columns: 2, rows: 4 },
      { columns: 4, rows: 2 },
    ])
  })

  test("matches the TUI layout tree for one through eight panes", () => {
    expect(Array.from({ length: 8 }, (_, index) => viewLayout(index + 1))).toEqual([
      0,
      { direction: "row", children: [0, 1] },
      { direction: "row", children: [0, { direction: "column", children: [1, 2] }] },
      { direction: "column", children: [{ direction: "row", children: [0, 1] }, { direction: "row", children: [2, 3] }] },
      { direction: "row", children: [{ direction: "column", children: [0, 1, 2] }, { direction: "column", children: [3, 4] }] },
      { direction: "column", children: [{ direction: "row", children: [0, 1, 2] }, { direction: "row", children: [3, 4, 5] }] },
      { direction: "row", children: [{ direction: "column", children: [0, 1, 2, 3] }, { direction: "column", children: [4, 5, 6] }] },
      { direction: "column", children: [{ direction: "row", children: [0, 1, 2, 3] }, { direction: "row", children: [4, 5, 6, 7] }] },
    ])
  })
})

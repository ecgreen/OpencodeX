import { describe, expect, test } from "bun:test"
import { buildDiffFileTree, expandedDirectories, flattenDiffFileTree, moveDiffSelection, nextDiffFile } from "../src/renderer/src/lib/diff-file-tree"
import type { DiffFile } from "../src/renderer/src/lib/store"

describe("GUI diff file tree helpers", () => {
  test("builds and flattens nested directory rows before files", () => {
    const tree = buildDiffFileTree([
      diff("src/app.ts"),
      diff("src/lib/store.ts"),
      diff("README.md"),
    ])
    const rows = flattenDiffFileTree(tree, expandedDirectories(tree))

    expect(rows.map((row) => `${row.depth}:${row.type}:${row.path}`)).toEqual([
      "0:directory:src",
      "1:directory:src/lib",
      "2:file:src/lib/store.ts",
      "1:file:src/app.ts",
      "0:file:README.md",
    ])
  })

  test("moves through visible rows and diff files circularly", () => {
    const files = [diff("a.ts"), diff("b.ts"), diff("c.ts")]
    const rows = flattenDiffFileTree(buildDiffFileTree(files), new Set())

    expect(moveDiffSelection(rows, "file:b.ts", 1)).toBe("file:c.ts")
    expect(moveDiffSelection(rows, "file:a.ts", -1)).toBe("file:c.ts")
    expect(nextDiffFile(files, "c.ts", 1)).toBe("a.ts")
    expect(nextDiffFile(files, "a.ts", -1)).toBe("c.ts")
  })
})

function diff(file: string): DiffFile {
  return { file, additions: 1, deletions: 0, patch: "" }
}

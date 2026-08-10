import { describe, expect, test } from "bun:test"
import { buildDiffFileTree, expandedDirectories, flattenDiffFileTree, flattenWorkbenchChangeTree, moveDiffSelection, nextDiffFile, reconcileWorkbenchChangeRows } from "../src/renderer/src/lib/diff-file-tree"
import type { DiffFile } from "../src/renderer/src/lib/session-api"

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

  test("derives an expanded virtual directory tree from a flat manifest", () => {
    const rows = flattenWorkbenchChangeTree([
      { type: "file", name: "app.ts", path: "src/app.ts", status: "added", staged: false, unstaged: false, untracked: true, openable: true },
      { type: "file", name: "store.ts", path: "src/lib/store.ts", status: "modified", staged: false, unstaged: true, untracked: false, openable: true },
    ], new Set())

    expect(rows.map((row) => `${row.depth}:${row.type}:${row.path}`)).toEqual([
      "0:directory:src",
      "1:directory:src/lib",
      "2:file:src/lib/store.ts",
      "1:file:src/app.ts",
    ])
    expect(flattenWorkbenchChangeTree(rows.flatMap((row) => row.node ? [row.node] : []), new Set(["src"])).map((row) => row.path)).toEqual(["src"])

    const refreshed = reconcileWorkbenchChangeRows(rows, flattenWorkbenchChangeTree(rows.flatMap((row) => row.node ? [row.node] : []), new Set()))
    expect(refreshed.find((row) => row.path === "src/app.ts")).toBe(rows.find((row) => row.path === "src/app.ts"))
  })

  test("filters the change tree to matching files and their folders", () => {
    const files = [
      { type: "file" as const, name: "app.ts", path: "src/app.ts", status: "added", staged: false, unstaged: false, untracked: true, openable: true },
      { type: "file" as const, name: "store.ts", path: "src/lib/store.ts", status: "modified", staged: false, unstaged: true, untracked: false, openable: true },
      { type: "file" as const, name: "README.md", path: "README.md", status: "modified", staged: false, unstaged: true, untracked: false, openable: true },
    ]

    expect(flattenWorkbenchChangeTree(files, new Set(), "store").map((row) => `${row.depth}:${row.type}:${row.path}`)).toEqual([
      "0:directory:src",
      "1:directory:src/lib",
      "2:file:src/lib/store.ts",
    ])
    // A collapsed folder stays collapsed while a filter is active.
    expect(flattenWorkbenchChangeTree(files, new Set(["src"]), "store").map((row) => row.path)).toEqual(["src"])
    // Blank and whitespace-only filters leave the tree untouched.
    expect(flattenWorkbenchChangeTree(files, new Set(), "  ").length).toBe(5)
  })
})

function diff(file: string): DiffFile {
  return { file, additions: 1, deletions: 0, patch: "" }
}

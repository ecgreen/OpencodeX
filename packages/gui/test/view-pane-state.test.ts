import { describe, expect, test } from "bun:test"
import {
  EMPTY_VIEW_PANE_RUNTIME_STATE,
  pruneRecordKeys,
  setRecordEntry,
  updateViewPaneRuntimeState,
} from "../src/renderer/src/lib/view-pane-state"

describe("GUI view pane runtime state", () => {
  test("preserves sibling composer state when another pane updates", () => {
    const paneA = { ...EMPTY_VIEW_PANE_RUNTIME_STATE, draft: { input: "do not lose me", parts: [{ type: "text" as const, text: "do not lose me" }] } }
    const paneB = { ...EMPTY_VIEW_PANE_RUNTIME_STATE }
    const current = { a: paneA, b: paneB }
    const next = updateViewPaneRuntimeState(current, "b", (state) => ({ ...state, loading: true, loadedTime: 10 }))

    expect(next).not.toBe(current)
    expect(next.a).toBe(paneA)
    expect(next.b).toEqual({ ...paneB, loading: true, loadedTime: 10 })
  })

  test("keeps record identity for unchanged entries and prunes only departed panes", () => {
    const current = { a: EMPTY_VIEW_PANE_RUNTIME_STATE, b: { ...EMPTY_VIEW_PANE_RUNTIME_STATE, loading: true } }

    expect(setRecordEntry(current, "a", current.a)).toBe(current)
    expect(pruneRecordKeys(current, new Set(["a", "b"]))).toBe(current)
    expect(pruneRecordKeys(current, new Set(["a"]))).toEqual({ a: EMPTY_VIEW_PANE_RUNTIME_STATE })
  })
})

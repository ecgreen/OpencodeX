import { describe, expect, test } from "bun:test"
import {
  canCollapseCenter,
  clampWorkspaceWidthRatio,
  nextWorkspaceLayout,
  WORKSPACE_WIDTH_MAX,
  WORKSPACE_WIDTH_MIN,
  type WorkspaceLayout,
  type WorkspaceLayoutChange,
} from "../src/renderer/src/lib/workspace-layout"

/**
 * The three columns. The property that matters is that the window is never
 * empty, so most of these drive the layout into the corner where that could
 * happen and check that it cannot.
 */

const onASession: WorkspaceLayout = { available: true, workspaceOpen: false, centerCollapsed: false }

const run = (state: WorkspaceLayout, ...changes: WorkspaceLayoutChange[]) =>
  changes.reduce(nextWorkspaceLayout, state)

describe("workspace layout", () => {
  test("the session column can be put away once the workspace is up", () => {
    const layout = run(onASession, { type: "workspace", open: true }, { type: "toggleCenter" })
    expect(layout).toEqual({ available: true, workspaceOpen: true, centerCollapsed: true })
  })

  test("it cannot be put away while the workspace is down", () => {
    // Nothing would be left, so the request is refused rather than obeyed.
    expect(canCollapseCenter(onASession)).toBe(false)
    expect(run(onASession, { type: "toggleCenter" }).centerCollapsed).toBe(false)
    expect(run(onASession, { type: "center", collapsed: true }).centerCollapsed).toBe(false)
  })

  test("closing the workspace brings the session back", () => {
    const hidden = run(onASession, { type: "workspace", open: true }, { type: "toggleCenter" })
    expect(hidden.centerCollapsed).toBe(true)
    const restored = nextWorkspaceLayout(hidden, { type: "workspace", open: false })
    expect(restored).toEqual({ available: true, workspaceOpen: false, centerCollapsed: false })
  })

  test("toggling the workspace shut restores the session just the same", () => {
    const hidden = run(onASession, { type: "toggleWorkspace" }, { type: "toggleCenter" })
    expect(nextWorkspaceLayout(hidden, { type: "toggleWorkspace" }).centerCollapsed).toBe(false)
  })

  test("a route with no workspace keeps neither the workspace nor the collapse", () => {
    const hidden = run(onASession, { type: "workspace", open: true }, { type: "toggleCenter" })
    const elsewhere = nextWorkspaceLayout(hidden, { type: "available", available: false })
    expect(elsewhere).toEqual({ available: false, workspaceOpen: false, centerCollapsed: false })
    // And it does not come back on its own when a workspace route is next.
    expect(nextWorkspaceLayout(elsewhere, { type: "available", available: true })).toEqual(onASession)
  })

  test("the workspace cannot be opened where there is none to open", () => {
    const nowhere: WorkspaceLayout = { available: false, workspaceOpen: false, centerCollapsed: false }
    expect(run(nowhere, { type: "workspace", open: true }).workspaceOpen).toBe(false)
    expect(run(nowhere, { type: "toggleWorkspace" }).workspaceOpen).toBe(false)
  })

  test("no reachable layout leaves the window empty", () => {
    // Exhaustive rather than illustrative: every state crossed with every
    // change, asserting the session is on screen unless the workspace is.
    const states: WorkspaceLayout[] = [true, false].flatMap((available) =>
      [true, false].flatMap((workspaceOpen) =>
        [true, false].map((centerCollapsed) => ({ available, workspaceOpen, centerCollapsed })),
      ),
    )
    const changes: WorkspaceLayoutChange[] = [
      { type: "available", available: true },
      { type: "available", available: false },
      { type: "workspace", open: true },
      { type: "workspace", open: false },
      { type: "toggleWorkspace" },
      { type: "center", collapsed: true },
      { type: "center", collapsed: false },
      { type: "toggleCenter" },
    ]
    for (const state of states) {
      for (const change of changes) {
        const layout = nextWorkspaceLayout(state, change)
        expect({ change, layout, empty: layout.centerCollapsed && !layout.workspaceOpen }).toMatchObject({
          empty: false,
        })
      }
    }
  })
})

describe("workspace width", () => {
  test("the session keeps a readable minimum, so full width comes from collapsing it", () => {
    expect(clampWorkspaceWidthRatio(0.99)).toBe(WORKSPACE_WIDTH_MAX)
    expect(clampWorkspaceWidthRatio(0.01)).toBe(WORKSPACE_WIDTH_MIN)
    expect(clampWorkspaceWidthRatio(0.5)).toBe(0.5)
  })

  test("an unreadable stored width falls back instead of collapsing the panel", () => {
    expect(clampWorkspaceWidthRatio(Number.NaN)).toBe(0.4)
  })
})

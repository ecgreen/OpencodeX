import { describe, expect, test } from "bun:test"
import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import {
  addPendingViewSessions,
  initialViewSelection,
  metadataWithPendingSessions,
  selectedPendingViewSessions,
  selectedViewSessionIDs,
  viewTitle,
} from "../src/renderer/src/lib/view-actions"

describe("GUI view action helpers", () => {
  test("loads existing and pending selections from a view", () => {
    const selection = initialViewSelection({
      sessionIDs: ["s1", "s2"],
      metadata: { opencodex: { pendingSessions: [{ id: "new:1", projectID: "p1" }] } },
    } as OpencodeXView)

    expect(selectedViewSessionIDs(selection)).toEqual(["s1", "s2"])
    expect(selectedPendingViewSessions(selection)).toEqual([{ id: "new:1", projectID: "p1" }])
  })

  test("writes and clears pending pane metadata", () => {
    expect(metadataWithPendingSessions({ keep: true }, [{ id: "new:1", directory: "C:/Work" }])).toEqual({
      keep: true,
      opencodex: { pendingSessions: [{ id: "new:1", directory: "C:/Work" }] },
    })
    expect(metadataWithPendingSessions({ opencodex: { pendingSessions: [{ id: "old" }] } }, [])).toEqual({})
  })

  test("adds pending panes without exceeding eight total panes", () => {
    const selection = addPendingViewSessions({
      selection: Array.from({ length: 7 }, (_, index) => ({ kind: "existing" as const, sessionID: `s${index}` })),
      count: 4,
      projectID: "p1",
      projectLabel: "Project",
      directory: "C:/Project",
      now: 10,
    })

    expect(selection.length).toBe(8)
    expect(selectedPendingViewSessions(selection)).toEqual([{ id: "new:p1:10:0", projectID: "p1", projectLabel: "Project", directory: "C:/Project" }])
  })

  test("derives a fallback title from selected sessions", () => {
    const sessions = [{ id: "s1", title: "Build thing" } as Session]

    expect(viewTitle({ title: "  Custom  ", selection: [], sessions })).toBe("Custom")
    expect(viewTitle({ title: "", selection: [{ kind: "existing", sessionID: "s1" }], sessions })).toBe("Build thing")
    expect(viewTitle({ title: "", selection: [{ kind: "existing", sessionID: "s1" }, { kind: "pending", slot: { id: "new:1" } }], sessions })).toBe("2 session view")
  })
})

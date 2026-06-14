import { describe, expect, test } from "bun:test"
import type { OpencodeXProject, OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import {
  addPendingViewSessions,
  groupViewSessionsByProject,
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

  test("groups view session choices by project before unprojected sessions", () => {
    const sessions = [
      { id: "s2", title: "Recent project session" },
      { id: "s4", title: "Loose session" },
      { id: "s1", title: "Older project session" },
      { id: "s3", title: "Second project session" },
    ] as Session[]
    const projects = [
      {
        id: "p1",
        project: { id: "core-1", name: "Alpha" },
        folders: [],
        sessions: [{ id: "s1" }, { id: "s2" }],
      },
      {
        id: "p2",
        project: { id: "core-2", name: "Beta" },
        folders: [],
        sessions: [{ id: "s3" }],
      },
    ] as OpencodeXProject[]

    const grouped = groupViewSessionsByProject({ sessions, projects })

    expect(grouped.projects.map((group) => ({
      projectID: group.project.id,
      sessionIDs: group.sessions.map((session) => session.id),
    }))).toEqual([
      { projectID: "p1", sessionIDs: ["s2", "s1"] },
      { projectID: "p2", sessionIDs: ["s3"] },
    ])
    expect(grouped.unprojected.map((session) => session.id)).toEqual(["s4"])
  })
})

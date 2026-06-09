import { describe, expect, test } from "bun:test"
import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "../src/renderer/src/lib/store"
import { activeSessionIDForRoute, activeSessionRouteKey, activeViewForRoute, focusedViewItemID, selectedSessionForRoute } from "../src/renderer/src/lib/route-selection"
import type { ViewItem } from "../src/renderer/src/lib/view-items"

describe("GUI route selection helpers", () => {
  test("selects existing and pending sessions from routes", () => {
    const current = snapshot()

    expect(selectedSessionForRoute({ name: "session", sessionID: "s2" }, current)?.id).toBe("s2")
    expect(selectedSessionForRoute({ name: "dashboard" }, current)).toBeUndefined()
    expect(selectedSessionForRoute({ name: "new-session", directory: "C:\\tmp" }, current)?.id).toBe("pending:new-session")
    expect(selectedSessionForRoute({ name: "new-session" }, current, "C:\\fallback")?.directory).toBe("C:\\project")
  })

  test("builds stable active session route keys", () => {
    expect(activeSessionIDForRoute({ name: "session", sessionID: "s1" })).toBe("s1")
    expect(activeSessionIDForRoute({ name: "dashboard" })).toBe("")
    expect(activeSessionRouteKey({ name: "session", sessionID: "s1" })).toBe("s1")
    expect(activeSessionRouteKey({ name: "new-session", projectID: "p1", directory: "C:\\project" })).toBe("new:p1:C:\\project")
    expect(activeSessionRouteKey({ name: "dashboard" })).toBe("")
  })

  test("selects active views and focused view item IDs", () => {
    const views = [view("v1"), view("v2", "s2")]
    const items: ViewItem[] = [{ kind: "session", session: session("s1") }, { kind: "session", session: session("s2") }]

    expect(activeViewForRoute({ name: "views", viewID: "v2" }, views)?.id).toBe("v2")
    expect(activeViewForRoute({ name: "views", viewID: "missing" }, views)?.id).toBe("v1")
    expect(activeViewForRoute({ name: "dashboard" }, views)).toBeUndefined()
    expect(focusedViewItemID({ localID: "s1", persistedID: "s2", items })).toBe("s1")
    expect(focusedViewItemID({ localID: "missing", persistedID: "s2", items })).toBe("s2")
    expect(focusedViewItemID({ localID: "", items })).toBe("s1")
  })
})

function snapshot(): GuiSnapshot {
  return {
    projects: [{ id: "p1", name: "Project", project: { name: "Project" }, folders: [{ path: "C:\\project" }], sessions: [] } as GuiSnapshot["projects"][number]],
    sessions: [session("s1"), session("s2")],
    sessionStatus: {},
    sessionUiState: {},
    permissions: [],
    questions: [],
    providers: [],
    agents: [],
    swarms: [],
    jobs: [],
    views: [],
  }
}

function session(id: string): Session {
  return { id, directory: "C:\\project", time: { updated: 1 } } as Session
}

function view(id: string, focusedSessionID?: string): OpencodeXView {
  return { id, sessionIDs: [], sessions: [], focusedSessionID } as OpencodeXView
}

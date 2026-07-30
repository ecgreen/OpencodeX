import { describe, expect, test } from "bun:test"
import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "../src/renderer/src/lib/session-api"
import { abortSessionIDForRoute, activeProjectForRoute, activeSessionIDForRoute, activeSessionRouteKey, activeViewForRoute, focusedViewItemID, selectedSessionForRoute } from "../src/renderer/src/lib/route-selection"
import { viewItemsMembershipKey, viewSessionsSyncKey, type ViewItem } from "../src/renderer/src/lib/view-items"

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

  test("targets aborts to the session represented by the active route", () => {
    expect(abortSessionIDForRoute({
      route: { name: "session", sessionID: "s1" },
      selectedSessionID: "s1",
      focusedViewSessionID: "s2",
      viewSessionIDs: ["s2"],
    })).toBe("s1")
    expect(abortSessionIDForRoute({
      route: { name: "views", viewID: "v1" },
      selectedSessionID: "unrelated",
      focusedViewSessionID: "s2",
      viewSessionIDs: ["s1", "s2"],
    })).toBe("s2")
    expect(abortSessionIDForRoute({
      route: { name: "new-session" },
      selectedSessionID: "materializing",
      viewSessionIDs: [],
    })).toBe("materializing")
  })

  test("does not target sessions outside the active route or view", () => {
    expect(abortSessionIDForRoute({
      route: { name: "session", sessionID: "s1" },
      selectedSessionID: "unrelated",
      viewSessionIDs: [],
    })).toBeUndefined()
    expect(abortSessionIDForRoute({
      route: { name: "views", viewID: "v1" },
      selectedSessionID: "unrelated",
      focusedViewSessionID: "unrelated",
      viewSessionIDs: ["s1", "s2"],
    })).toBeUndefined()
    expect(abortSessionIDForRoute({
      route: { name: "dashboard" },
      selectedSessionID: "s1",
      focusedViewSessionID: "s2",
      viewSessionIDs: ["s2"],
    })).toBeUndefined()
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

  test("selects project routes only when the project exists", () => {
    const current = snapshot()

    expect(activeProjectForRoute({ name: "projects", projectID: "p1" }, current.projects)?.id).toBe("p1")
    expect(activeProjectForRoute({ name: "projects" }, current.projects)).toBeUndefined()
    expect(activeProjectForRoute({ name: "projects", projectID: "missing" }, current.projects)).toBeUndefined()
    expect(activeProjectForRoute({ name: "dashboard" }, current.projects)).toBeUndefined()
  })

  test("separates stable view membership from volatile sync keys", () => {
    const before = [session("s1", 1), session("s2", 1)]
    const after = [session("s1", 9), session("s2", 1)]
    const itemsBefore: ViewItem[] = before.map((item) => ({ kind: "session", session: item }))
    const itemsAfter: ViewItem[] = after.map((item) => ({ kind: "session", session: item }))

    expect(viewItemsMembershipKey("v1", itemsAfter)).toBe(viewItemsMembershipKey("v1", itemsBefore))
    expect(viewSessionsSyncKey("v1", after)).not.toBe(viewSessionsSyncKey("v1", before))
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

function session(id: string, updated = 1): Session {
  return { id, directory: "C:\\project", time: { updated } } as Session
}

function view(id: string, focusedSessionID?: string): OpencodeXView {
  return { id, sessionIDs: [], sessions: [], focusedSessionID } as OpencodeXView
}

import { describe, expect, test } from "bun:test"
import { runCreateProjectSessionAction, runCreateSwarmAction, runCreateViewAction } from "../../src/renderer/src/lib/creation-actions"
import { runCreateProjectAction, runCreateSessionRouteAction, runEditProjectAction } from "../../src/renderer/src/lib/project-actions"
import { addPendingViewSessions, groupViewSessionsByProject, selectedPendingViewSessions, selectedViewSessionIDs, viewTitle } from "../../src/renderer/src/lib/view-actions"
import type { GuiSnapshot } from "../../src/renderer/src/lib/store"
import { project, session } from "./fixtures"

describe("GUI functional project and view workflows", () => {
  test("creates a project through folder validation and refresh", async () => {
    const calls: string[] = []

    await runCreateProjectAction({
      fallbackDirectory: "C:/Work",
      chooseFolder: async (fallback) => {
        calls.push(`choose:${fallback}`)
        return "C:/Work/OpencodeX"
      },
      validateProjectFolders: async (folders) => {
        calls.push(`validate:${folders.join(",")}`)
        return { data: { valid: true, folders: [] } }
      },
      createProject: async (name, directory) => calls.push(`create:${name}:${directory}`),
      refresh: async () => calls.push("refresh"),
      alert: (message) => calls.push(`alert:${message}`),
    })

    expect(calls).toEqual([
      "choose:C:/Work",
      "validate:C:/Work/OpencodeX",
      "create:OpencodeX:C:/Work/OpencodeX",
      "refresh",
    ])
  })

  test("edits project name and folders as a single validated operation", async () => {
    const calls: string[] = []
    const answers = ["Renamed", "C:/One\nC:/Two"]

    await runEditProjectAction({
      projectID: "project-1",
      currentName: "Project",
      folders: ["C:/Old"],
      askText: async (input) => {
        calls.push(`ask:${input.title}`)
        return answers.shift()
      },
      validateProjectFolders: async (_projectID, folders) => {
        calls.push(`validate:${folders.join("|")}`)
        return { data: { valid: true, folders: [] } }
      },
      updateProject: async (projectID, next) => calls.push(`update:${projectID}:${next.name}:${next.folders.join("|")}`),
      refresh: async () => calls.push("refresh"),
      alert: (message) => calls.push(`alert:${message}`),
    })

    expect(calls).toEqual([
      "ask:Edit Project Name",
      "ask:Edit Project Folders",
      "validate:C:/One|C:/Two",
      "update:project-1:Renamed:C:/One|C:/Two",
      "refresh",
    ])
  })

  test("creates project sessions, swarms, and views from user selections", async () => {
    const calls: string[] = []
    const projects = [projectCollection()]
    const sessions = [session("session-1"), session("session-2")]

    await runCreateProjectSessionAction({
      projects,
      alert: (message) => calls.push(`alert:${message}`),
      chooseProjectID: async () => "project-1",
      createSession: (projectID, directory) => calls.push(`project-session:${projectID}:${directory}`),
    })
    await runCreateSwarmAction({
      projects,
      alert: (message) => calls.push(`alert:${message}`),
      chooseProjectID: async () => "project-1",
      createSwarm: async (projectID, title, prompt) => calls.push(`swarm:${projectID}:${title}:${prompt}`),
      refresh: async () => calls.push("refresh-swarm"),
      openSwarms: () => calls.push("open-swarms"),
    })
    await runCreateViewAction({
      sessions,
      alert: (message) => calls.push(`alert:${message}`),
      chooseSessionIDs: async () => ["session-1", "session-2"],
      createView: async (title, sessionIDs) => calls.push(`view:${title}:${sessionIDs.join(",")}`),
      refresh: async () => calls.push("refresh-view"),
      openViews: () => calls.push("open-views"),
    })

    expect(calls).toEqual([
      "project-session:project-1:C:/Work/OpencodeX",
      "swarm:project-1:New swarm:",
      "refresh-swarm",
      "open-swarms",
      "view:New view:session-1,session-2",
      "refresh-view",
      "open-views",
    ])
  })

  test("builds view selections with pending panes and groups sessions by project first", () => {
    const selection = addPendingViewSessions({
      selection: [{ kind: "existing", sessionID: "session-1" }],
      count: 2,
      projectID: "project-1",
      projectLabel: "Project",
      directory: "C:/Work/OpencodeX",
      now: 10,
    })
    const grouped = groupViewSessionsByProject({
      projects: [project({ sessions: [session("session-2")] })],
      sessions: [session("session-1"), session("session-2")],
    })

    expect(selectedViewSessionIDs(selection)).toEqual(["session-1"])
    expect(selectedPendingViewSessions(selection).map((item) => item.id)).toEqual(["new:project-1:10:0", "new:project-1:10:1"])
    expect(viewTitle({ title: "", selection, sessions: [session("session-1", { title: "Only session" })] })).toBe("3 session view")
    expect(grouped.projects[0]?.sessions.map((item) => item.id)).toEqual(["session-2"])
    expect(grouped.unprojected.map((item) => item.id)).toEqual(["session-1"])
  })

  test("opens a new session route without carrying stale composer text", () => {
    const calls: string[] = []

    runCreateSessionRouteAction({
      projectID: "project-1",
      projects: [projectCollection()],
      guiDirectory: "C:/Fallback",
      setPrompt: (value) => calls.push(`prompt:${value}`),
      openNewSession: (projectID, directory) => calls.push(`route:${projectID}:${directory}`),
      focusComposer: () => calls.push("focus"),
    })

    expect(calls).toEqual(["prompt:", "route:project-1:C:/Work/OpencodeX", "focus"])
  })
})

function projectCollection(): GuiSnapshot["projects"][number] {
  return {
    id: "project-1",
    name: "Project",
    project: project(),
    folders: [{ path: "C:/Work/OpencodeX" }],
    sessions: [],
  }
}

import { describe, expect, test } from "bun:test"
import type { OpencodeXSwarm, OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "../src/renderer/src/lib/store"
import { projectAttentionItems, projectLatestActivity, projectSessionStatus, projectSwarms, projectViews } from "../src/renderer/src/lib/project-summary"

describe("GUI project summaries", () => {
  test("summarizes project sessions, swarms, views, attention, and activity", () => {
    const current = snapshot()
    const project = current.projects[0]

    expect(projectSwarms(project, current).map((swarm) => swarm.id)).toEqual(["swarm-1"])
    expect(projectViews(project, current).map((view) => view.id)).toEqual(["view-1", "view-2"])
    expect(projectAttentionItems(project, current).map((item) => item.title)).toEqual(["Question", "Blocked", "Needs Review"])
    expect(projectSessionStatus(project, current)).toBe("input_needed")
    expect(projectLatestActivity(project, current)).toBe(50)
  })

  test("handles empty projects", () => {
    const current = snapshot({ sessions: [], swarms: [], views: [], jobs: [], permissions: [], questions: [] })
    const project = { ...current.projects[0], sessions: [], sessionIDs: [] }

    expect(projectSwarms(project, current)).toEqual([])
    expect(projectViews(project, current)).toEqual([])
    expect(projectAttentionItems(project, current)).toEqual([])
    expect(projectSessionStatus(project, current)).toBe("dormant")
    expect(projectLatestActivity(project, current)).toBe(1)
  })
})

function snapshot(input: {
  sessions?: Session[]
  swarms?: GuiSnapshot["swarms"]
  views?: GuiSnapshot["views"]
  jobs?: GuiSnapshot["jobs"]
  permissions?: GuiSnapshot["permissions"]
  questions?: GuiSnapshot["questions"]
} = {}): GuiSnapshot {
  const sessions = input.sessions ?? [
    session("s1", "Needs Review", 10),
    session("s2", "Blocked", 20),
    session("s3", "Question", 30),
  ]
  return {
    projects: [{
      id: "p1",
      name: "Project",
      project: { id: "core", name: "Project", time: { created: 1, updated: 1 } },
      folders: [{ path: "C:/Project" }],
      sessions,
      sessionIDs: sessions.map((session) => session.id),
    } as GuiSnapshot["projects"][number]],
    sessions,
    sessionStatus: {},
    sessionUiState: { s1: { sessionID: "s1", displayStatus: "needs_review", reviewedFiles: [], updated: true } },
    permissions: input.permissions ?? [{ id: "perm-1", sessionID: "s2", permission: "edit", title: "Edit" }] as GuiSnapshot["permissions"],
    questions: input.questions ?? [{ id: "question-1", sessionID: "s3", questions: [{ id: "q1", question: "Continue?" }] }] as GuiSnapshot["questions"],
    providers: [],
    agents: [],
    swarms: input.swarms ?? [swarm("swarm-1", "p1", 40), swarm("swarm-2", "other", 60)],
    jobs: input.jobs ?? [{ id: "job-1", sessionID: "s2", title: "Fix tests", kind: "task", status: "failed" }] as GuiSnapshot["jobs"],
    views: input.views ?? [view("view-1", ["s1"], 50), view("view-2", [], 45, "p1"), view("view-3", ["missing"], 70)],
  }
}

function session(id: string, name: string, updated: number): Session {
  return { id, title: name, directory: "C:/Project", time: { updated } } as Session
}

function swarm(id: string, projectID: string, timeUpdated: number): OpencodeXSwarm {
  return { id, projectID, title: id, roles: [], runs: [], timeUpdated } as OpencodeXSwarm
}

function view(id: string, sessionIDs: string[], timeUpdated: number, projectID?: string): OpencodeXView {
  return {
    id,
    title: id,
    sessionIDs,
    sessions: [],
    timeUpdated,
    metadata: projectID ? { opencodex: { pendingSessions: [{ id: "pending", projectID }] } } : undefined,
  } as OpencodeXView
}

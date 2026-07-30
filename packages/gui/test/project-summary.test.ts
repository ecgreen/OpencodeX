import { describe, expect, test } from "bun:test"
import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "../src/renderer/src/lib/session-api"
import {
  filterProjectSummaries,
  projectAttentionItems,
  projectLatestActivity,
  projectSessionStatus,
  projectViews,
  sortProjectSummaries,
  summarizeProjects,
} from "../src/renderer/src/lib/project-summary"

describe("GUI project summaries", () => {
  test("summarizes project sessions, views, attention, and activity", () => {
    const current = snapshot()
    const project = current.projects[0]

    expect(projectViews(project, current).map((view) => view.id)).toEqual(["view-1", "view-2"])
    expect(projectAttentionItems(project, current).map((item) => item.title)).toEqual(["Question", "Blocked", "Needs Review"])
    expect(projectSessionStatus(project, current)).toBe("input_needed")
    expect(projectLatestActivity(project, current)).toBe(50)
  })

  test("handles empty projects", () => {
    const current = snapshot({ sessions: [], views: [], jobs: [], permissions: [], questions: [] })
    const project = { ...current.projects[0], sessions: [], sessionIDs: [] }

    expect(projectViews(project, current)).toEqual([])
    expect(projectAttentionItems(project, current)).toEqual([])
    expect(projectSessionStatus(project, current)).toBe("dormant")
    expect(projectLatestActivity(project, current)).toBe(1)
  })

  test("rolls each project up to the counts the overview rows and tiles read", () => {
    const current = snapshot()
    const [summary] = summarizeProjects({ projects: current.projects, snapshot: current })

    expect(summary.status).toBe("input_needed")
    expect(summary.sessionCount).toBe(3)
    expect(summary.terminalSessionCount).toBe(0)
    expect(summary.viewCount).toBe(2)
    expect(summary.attention.map((item) => item.title)).toEqual(["Question", "Blocked", "Needs Review"])
    expect(summary.lastActivity).toBe(50)
  })

  test("separates projects that have gone quiet from the ones still in play", () => {
    const current = snapshot({ sessions: [], views: [], jobs: [], permissions: [], questions: [] })
    const now = 30 * 24 * 60 * 60 * 1000
    const [quiet] = summarizeProjects({
      projects: [{ ...current.projects[0], sessions: [], sessionIDs: [] }],
      snapshot: current,
      now,
    })
    const [active] = summarizeProjects({ projects: current.projects, snapshot: snapshot(), now: 60 })

    expect(quiet.group).toBe("quiet")
    expect(active.group).toBe("active")
  })

  test("filters by tile and searches names, folders, and session titles", () => {
    const current = snapshot()
    const summaries = summarizeProjects({ projects: current.projects, snapshot: current })

    expect(filterProjectSummaries(summaries, "", "all")).toHaveLength(1)
    expect(filterProjectSummaries(summaries, "", "attention")).toHaveLength(1)
    expect(filterProjectSummaries(summaries, "", "terminal")).toHaveLength(0)
    expect(filterProjectSummaries(summaries, "", "running")).toHaveLength(0)
    expect(filterProjectSummaries(summaries, "proj", "all")).toHaveLength(1)
    expect(filterProjectSummaries(summaries, "C:/Project", "all")).toHaveLength(1)
    expect(filterProjectSummaries(summaries, "Needs Review", "all")).toHaveLength(1)
    expect(filterProjectSummaries(summaries, "nothing here", "all")).toHaveLength(0)
  })

  test("orders by activity and by attention, and leaves the reader's own order alone", () => {
    const current = snapshot()
    const summaries = [
      { ...summarizeProjects({ projects: current.projects, snapshot: current })[0], lastActivity: 10, attention: [] },
      {
        ...summarizeProjects({ projects: current.projects, snapshot: current })[0],
        lastActivity: 90,
        attention: [{ sessionID: "s9", title: "Failed", detail: "failed", tone: "danger" as const }],
      },
    ]

    expect(sortProjectSummaries(summaries, "custom").map((item) => item.lastActivity)).toEqual([10, 90])
    expect(sortProjectSummaries(summaries, "activity").map((item) => item.lastActivity)).toEqual([90, 10])
    expect(sortProjectSummaries(summaries, "attention").map((item) => item.lastActivity)).toEqual([90, 10])
  })
})

function snapshot(input: {
  sessions?: Session[]
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
    swarms: [],
    jobs: input.jobs ?? [{ id: "job-1", sessionID: "s2", title: "Fix tests", kind: "task", status: "failed" }] as GuiSnapshot["jobs"],
    views: input.views ?? [view("view-1", ["s1"], 50), view("view-2", [], 45, "p1"), view("view-3", ["missing"], 70)],
  }
}

function session(id: string, name: string, updated: number): Session {
  return { id, title: name, directory: "C:/Project", time: { updated } } as Session
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

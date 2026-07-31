import type { ClientCatalogView } from "@opencode-ai/sdk/v2/client-sync"
import { projectSessions, type SessionOrderState } from "./app-session-lists"
import { deriveSessionStatus, sessionStatusLabel, type DerivedSessionStatus } from "./session-status"
import { attentionGoals, goalHeadline } from "./goal-graph-view"
import type { GuiSnapshot } from "./session-api"
import { pendingViewSessions } from "./view-items"
import { title } from "./format"

export type ProjectAttentionItem = {
  sessionID: string
  title: string
  detail: string
  tone: "warning" | "danger" | "info"
}

/** Anything quieter than this reads as a project you are not working in today. */
const QUIET_PROJECT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** `all` is the resting state; the rest narrow the list to what a tile counts. */
export type ProjectOverviewFilter = "all" | "attention" | "running" | "terminal"
export type ProjectDirectorySort = "custom" | "activity" | "attention"

export function projectLabel(project: GuiSnapshot["projects"][number]) {
  return title(project.name ?? project.project.name)
}

export type ProjectSummaryGroup = "active" | "quiet"

/**
 * Everything the project rows and tiles display, derived once per project so
 * filtering, sorting, and rendering all read the same numbers.
 */
export type ProjectSummary = {
  project: GuiSnapshot["projects"][number]
  status: DerivedSessionStatus
  attention: ProjectAttentionItem[]
  group: ProjectSummaryGroup
  sessionCount: number
  /** Sessions currently in progress, so "running" can be a count, not a flag. */
  runningSessionCount: number
  terminalSessionCount: number
  viewCount: number
  lastActivity: number
}

export function summarizeProjects(input: {
  projects: GuiSnapshot["projects"]
  snapshot?: GuiSnapshot
  state?: SessionOrderState
  now?: number
}): ProjectSummary[] {
  const now = input.now ?? Date.now()
  return input.projects.map((project) => {
    const lastActivity = projectLatestActivity(project, input.snapshot, input.state)
    const attention = projectAttentionItems(project, input.snapshot, input.state)
    const status = projectSessionStatus(project, input.snapshot, input.state)
    const sessions = projectSessions(project, input.snapshot, input.state)
    return {
      project,
      status,
      attention,
      group: attention.length > 0 || status !== "dormant" || now - lastActivity < QUIET_PROJECT_WINDOW_MS
        ? "active"
        : "quiet",
      sessionCount: sessions.length,
      runningSessionCount: sessions.filter((session) => deriveSessionStatus(input.snapshot, session) === "in_progress").length,
      terminalSessionCount: (project.terminalSessions ?? []).length,
      viewCount: projectViews(project, input.snapshot, input.state).length,
      lastActivity,
    }
  })
}

/**
 * Search reaches into session titles, not just the project's own name, because
 * the thing a reader remembers is usually what they were working on.
 */
export function filterProjectSummaries(summaries: ProjectSummary[], query: string, filter: ProjectOverviewFilter) {
  const text = query.trim().toLowerCase()
  return summaries.filter((summary) => {
    if (filter === "attention" && summary.attention.length === 0) return false
    if (filter === "running" && summary.status !== "in_progress") return false
    if (filter === "terminal" && summary.terminalSessionCount === 0) return false
    if (!text) return true
    return [
      projectLabel(summary.project),
      ...summary.project.folders.map((folder) => folder.path),
      ...(summary.project.sessions ?? []).map((session) => session.title ?? ""),
      ...(summary.project.terminalSessions ?? []).map((session) => session.title),
    ].some((value) => value.toLowerCase().includes(text))
  })
}

/** `custom` is the reader's own order, so it is returned untouched. */
export function sortProjectSummaries(summaries: ProjectSummary[], sort: ProjectDirectorySort) {
  if (sort === "activity") return summaries.toSorted((a, b) => b.lastActivity - a.lastActivity)
  if (sort === "attention") {
    return summaries.toSorted((a, b) =>
      b.attention.length - a.attention.length
      || attentionRank(b) - attentionRank(a)
      || b.lastActivity - a.lastActivity)
  }
  return summaries
}

function attentionRank(summary: ProjectSummary) {
  if (summary.attention.some((item) => item.tone === "danger")) return 3
  if (summary.status === "input_needed") return 2
  if (summary.status === "ready_for_review") return 1
  return 0
}

export function projectViews(
  project: GuiSnapshot["projects"][number],
  snapshot?: GuiSnapshot,
  _state?: SessionOrderState,
) {
  const sessionIDs = new Set(project.sessionIDs)
  const terminalSessionIDs = new Set((project.terminalSessions ?? []).map((session) => session.id))
  return (snapshot?.views ?? [])
    .filter(
      (view) =>
        view.sessionIDs.some((sessionID) => sessionIDs.has(sessionID)) ||
        (view.members ?? []).some((member) => member.kind === "terminal" && terminalSessionIDs.has(member.id)) ||
        pendingViewSessions(view).some((item) => item.projectID === project.id),
    )
    .toSorted((a, b) => timeValue(b.timeUpdated) - timeValue(a.timeUpdated))
}

export function projectAttentionItems(
  project: GuiSnapshot["projects"][number],
  snapshot?: GuiSnapshot,
  state?: SessionOrderState,
): ProjectAttentionItem[] {
  const sessionIDs = new Set(project.sessionIDs)
  const attentionSessionIDs = new Set<string>()
  const sessions = projectSessions(project, snapshot, state)
    .filter((session) => {
      const status = deriveSessionStatus(snapshot, session)
      return status === "input_needed" || status === "ready_for_review"
    })
    .toSorted((a, b) => timeValue(b.time.updated) - timeValue(a.time.updated))
    .map((session) => {
      attentionSessionIDs.add(session.id)
      const status = deriveSessionStatus(snapshot, session)
      return {
        sessionID: session.id,
        title: title(session.title),
        detail: sessionStatusLabel(status),
        tone: "warning" as const,
      }
    })
  const permissions = (snapshot?.permissions ?? [])
    .filter((request) => sessionIDs.has(request.sessionID) && !attentionSessionIDs.has(request.sessionID))
    .map((request) => ({
      sessionID: request.sessionID,
      title: "Permission required",
      detail: request.permission,
      tone: "warning" as const,
    }))
  const questions = (snapshot?.questions ?? [])
    .filter((request) => sessionIDs.has(request.sessionID) && !attentionSessionIDs.has(request.sessionID))
    .map((request) => ({
      sessionID: request.sessionID,
      title: "Question pending",
      detail: request.questions[0]?.question ?? "Agent needs input",
      tone: "warning" as const,
    }))
  // Gates, budget pauses, and failed goals - a standing goal has no session,
  // so without this the project surface would never show it raising a hand.
  const goals = attentionGoals(snapshot?.goals ?? [], project.id)
    .filter((goal) => !(goal.ownerSessionID && attentionSessionIDs.has(goal.ownerSessionID)))
    .map((goal) => ({
      sessionID: goal.ownerSessionID ?? "",
      title: title(goal.title),
      detail: goalHeadline(goal),
      tone: goal.status === "failed" ? ("danger" as const) : ("warning" as const),
    }))
  const jobs = (snapshot?.jobs ?? []).flatMap((job) => {
    const sessionID = job.sessionID
    if (
      !sessionID ||
      !sessionIDs.has(sessionID) ||
      attentionSessionIDs.has(sessionID) ||
      !["interrupted", "failed"].includes(job.status)
    )
      return []
    return [
      {
        sessionID,
        title: title(job.title ?? job.kind),
        detail: job.status,
        tone: job.status === "failed" ? ("danger" as const) : ("warning" as const),
      },
    ]
  })
  return [...sessions, ...permissions, ...questions, ...goals, ...jobs]
}

export function projectLatestActivity(
  project: GuiSnapshot["projects"][number],
  snapshot?: GuiSnapshot,
  state?: SessionOrderState,
) {
  return Math.max(
    0,
    ...projectSessions(project, snapshot, state).map((session) => timeValue(session.time.updated)),
    ...(project.terminalSessions ?? []).map((session) => timeValue(session.timeUpdated)),
    ...projectViews(project, snapshot).map((view) => timeValue(view.timeUpdated)),
    timeValue(project.project.time?.updated),
  )
}

export function projectViewSessionCount(view: ClientCatalogView) {
  return (view.members?.length ?? view.sessionIDs.length) + pendingViewSessions(view).length
}

export function projectSessionStatus(
  project: GuiSnapshot["projects"][number],
  snapshot?: GuiSnapshot,
  state?: SessionOrderState,
) {
  const statuses = projectSessions(project, snapshot, state).map((session) => deriveSessionStatus(snapshot, session))
  if (statuses.includes("input_needed")) return "input_needed"
  if (statuses.includes("in_progress")) return "in_progress"
  if (statuses.includes("ready_for_review")) return "ready_for_review"
  return "dormant"
}

function timeValue(value: number | string | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  return 0
}

import type { OpencodeXView } from "@opencode-ai/sdk/v2/client"
import { projectSessions, type SessionOrderState } from "./app-session-lists"
import { deriveSessionStatus, sessionStatusLabel } from "./session-status"
import type { GuiSnapshot } from "./store"
import { pendingViewSessions } from "./view-items"
import { title } from "./format"

export type ProjectAttentionItem = {
  sessionID: string
  title: string
  detail: string
  tone: "warning" | "danger" | "info"
}

export function projectSwarms(project: GuiSnapshot["projects"][number], snapshot?: GuiSnapshot) {
  return (snapshot?.swarms ?? [])
    .filter((swarm) => swarm.projectID === project.id)
    .toSorted((a, b) => timeValue(b.timeUpdated) - timeValue(a.timeUpdated))
}

export function projectViews(
  project: GuiSnapshot["projects"][number],
  snapshot?: GuiSnapshot,
  state?: SessionOrderState,
) {
  const sessionIDs = new Set(projectSessions(project, snapshot, state).map((session) => session.id))
  return (snapshot?.views ?? [])
    .filter(
      (view) =>
        view.sessionIDs.some((sessionID) => sessionIDs.has(sessionID)) ||
        pendingViewSessions(view).some((item) => item.projectID === project.id),
    )
    .toSorted((a, b) => timeValue(b.timeUpdated) - timeValue(a.timeUpdated))
}

export function projectAttentionItems(
  project: GuiSnapshot["projects"][number],
  snapshot?: GuiSnapshot,
  state?: SessionOrderState,
): ProjectAttentionItem[] {
  const sessionIDs = new Set(projectSessions(project, snapshot, state).map((session) => session.id))
  const attentionSessionIDs = new Set<string>()
  const sessions = projectSessions(project, snapshot, state)
    .filter((session) => {
      const status = deriveSessionStatus(snapshot, session)
      return status === "input_needed" || status === "ready_for_review" || status === "failed"
    })
    .toSorted((a, b) => timeValue(b.time.updated) - timeValue(a.time.updated))
    .map((session) => {
      attentionSessionIDs.add(session.id)
      const status = deriveSessionStatus(snapshot, session)
      return {
        sessionID: session.id,
        title: title(session.title),
        detail: sessionStatusLabel(status),
        tone: status === "failed" ? ("danger" as const) : ("warning" as const),
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
  return [...sessions, ...permissions, ...questions, ...jobs]
}

export function projectLatestActivity(
  project: GuiSnapshot["projects"][number],
  snapshot?: GuiSnapshot,
  state?: SessionOrderState,
) {
  return Math.max(
    0,
    ...projectSessions(project, snapshot, state).map((session) => timeValue(session.time.updated)),
    ...projectSwarms(project, snapshot).map((swarm) => timeValue(swarm.timeUpdated)),
    ...projectViews(project, snapshot).map((view) => timeValue(view.timeUpdated)),
    timeValue(project.project.time?.updated),
  )
}

export function projectViewSessionCount(view: OpencodeXView) {
  return view.sessionIDs.length + pendingViewSessions(view).length
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
  if (statuses.includes("failed")) return "failed"
  return "dormant"
}

function timeValue(value: number | string | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  return 0
}

import type { OpencodeXProject, OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "./store"
import { deriveSessionStatus, deriveViewStatus, sessionStatusLabel, type DerivedSessionStatus } from "./session-status"
import { pendingViewSessions } from "./view-items"
import { viewSessionsInOrder } from "./view-sync"

const RECENT_VIEW_WINDOW_MS = 4 * 60 * 60 * 1000

export type ViewSummaryGroupID = "attention" | "active" | "recent" | "quiet"

export type ViewSessionSummary = {
  session: Session
  status: DerivedSessionStatus
  projectLabel?: string
}

export type ViewAttentionCounts = {
  permissions: number
  questions: number
  ready: number
  failed: number
}

export type ViewSummary = {
  view: OpencodeXView
  status: DerivedSessionStatus
  group: ViewSummaryGroupID
  paneCount: number
  pendingCount: number
  sessionRows: ViewSessionSummary[]
  projectLabels: string[]
  focusedSession?: Session
  attentionCounts: ViewAttentionCounts
  attentionLabel: string
  lastUpdated: number
}

export function summarizeViews(input: { views: OpencodeXView[]; snapshot?: GuiSnapshot; now?: number }) {
  return input.views.map((view) => summarizeView({ view, snapshot: input.snapshot, now: input.now }))
}

export function summarizeView(input: { view: OpencodeXView; snapshot?: GuiSnapshot; now?: number }): ViewSummary {
  const sessionRows = viewSessionsInOrder({
    sessionIDs: input.view.sessionIDs,
    sessions: input.snapshot?.sessions ?? [],
  }).map((session) => ({
    session,
    status: deriveSessionStatus(input.snapshot, session),
    projectLabel: sessionProjectLabel(session, input.snapshot?.projects ?? []),
  }))
  const attentionCounts = viewAttentionCounts(input.view, sessionRows, input.snapshot)
  const pendingCount = pendingViewSessions(input.view).length
  const lastUpdated = Math.max(
    numericTime(input.view.timeUpdated),
    ...sessionRows.map((row) => row.session.time.updated),
  )
  const status = attentionCounts.failed > 0 ? "failed" : deriveViewStatus(input.view, input.snapshot)
  const group = viewSummaryGroup({
    status,
    attentionCounts,
    lastUpdated,
    now: input.now ?? Date.now(),
  })

  return {
    view: input.view,
    status,
    group,
    paneCount: input.view.sessionIDs.length + pendingCount,
    pendingCount,
    sessionRows,
    projectLabels: Array.from(
      new Set(sessionRows.map((row) => row.projectLabel).filter((label): label is string => Boolean(label))),
    ),
    focusedSession:
      sessionRows.find((row) => row.session.id === input.view.focusedSessionID)?.session ?? sessionRows[0]?.session,
    attentionCounts,
    attentionLabel: viewAttentionLabel(attentionCounts),
    lastUpdated,
  }
}

export function groupedViewSummaries(summaries: ViewSummary[]) {
  return {
    attention: summaries.filter((summary) => summary.group === "attention"),
    active: summaries.filter((summary) => summary.group === "active"),
    recent: summaries.filter((summary) => summary.group === "recent"),
    quiet: summaries.filter((summary) => summary.group === "quiet"),
  }
}

export function viewProjectMeta(summary: ViewSummary) {
  if (summary.projectLabels.length === 0) return "No project"
  if (summary.projectLabels.length === 1) return summary.projectLabels[0]
  return `${summary.projectLabels.length} projects`
}

export function viewStatusMeta(summary: ViewSummary) {
  if (summary.attentionLabel) return summary.attentionLabel
  if (summary.status === "in_progress") return "running"
  return sessionStatusLabel(summary.status)
}

function viewSummaryGroup(input: {
  status: DerivedSessionStatus
  attentionCounts: ViewAttentionCounts
  lastUpdated: number
  now: number
}): ViewSummaryGroupID {
  if (
    hasAttention(input.attentionCounts) ||
    input.status === "input_needed" ||
    input.status === "ready_for_review" ||
    input.status === "failed"
  )
    return "attention"
  if (input.status === "in_progress") return "active"
  if (input.lastUpdated >= input.now - RECENT_VIEW_WINDOW_MS) return "recent"
  return "quiet"
}

function viewAttentionCounts(
  view: OpencodeXView,
  rows: ViewSessionSummary[],
  snapshot?: GuiSnapshot,
): ViewAttentionCounts {
  const sessionIDs = new Set(rows.map((row) => row.session.id))
  const jobs = snapshot?.jobs ?? []
  return {
    permissions: (snapshot?.permissions ?? []).filter((request) => sessionIDs.has(request.sessionID)).length,
    questions: (snapshot?.questions ?? []).filter((request) => sessionIDs.has(request.sessionID)).length,
    ready: rows.filter((row) => row.status === "ready_for_review").length,
    failed: jobs.filter(
      (job) =>
        job.sessionID && view.sessionIDs.includes(job.sessionID) && ["interrupted", "failed"].includes(job.status),
    ).length,
  }
}

function hasAttention(counts: ViewAttentionCounts) {
  return counts.permissions > 0 || counts.questions > 0 || counts.ready > 0 || counts.failed > 0
}

function viewAttentionLabel(counts: ViewAttentionCounts) {
  return [
    countLabel(counts.permissions, "permission"),
    countLabel(counts.questions, "question"),
    countLabel(counts.ready, "ready"),
    countLabel(counts.failed, "failed"),
  ]
    .filter(Boolean)
    .join(", ")
}

function countLabel(count: number, label: string) {
  if (count === 0) return ""
  if (label === "ready" || label === "failed") return `${count} ${label}`
  return `${count} ${label}${count === 1 ? "" : "s"}`
}

function sessionProjectLabel(session: Session, projects: OpencodeXProject[]) {
  const project = projects.find((item) => item.sessions.some((projectSession) => projectSession.id === session.id))
  return project?.name ?? project?.project.name
}

function numericTime(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

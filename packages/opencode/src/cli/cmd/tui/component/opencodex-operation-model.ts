import { clientSwarmStatusLabel } from "@opencode-ai/sdk/v2/swarm-presentation"
import type { useSync } from "@tui/context/sync"
import type { useTheme } from "@tui/context/theme"
import {
  REVIEW_READY_COLOR,
  deriveStatus,
  deriveViewStatus,
  isReviewReadyStatus,
  statusColor as derivedStatusColor,
  statusLabel,
} from "./opencodex-session-status"
import { viewSessionMemberIDs } from "./opencodex-view-model"
import type {
  DashboardProjectSummary,
  DashboardRow,
  DashboardSession,
  DashboardStatus,
  OpencodeXProject,
  OpencodeXSwarm,
  OpencodeXSwarmRole,
  OpencodeXView,
} from "./opencodex-operations-types"

export function timeAgo(input: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - input) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function projectTitle(projects: OpencodeXProject[], projectID?: string) {
  const project = projects.find((item) => item.id === projectID)
  return project?.name ?? project?.project.name ?? project?.project.worktree ?? "Unassigned"
}

export function projectForSession(projects: OpencodeXProject[], sessionID: string) {
  return projects.find((project) => project.sessionIDs.includes(sessionID))
}

export function statusDot(status: string) {
  if (["running", "queued", "in_progress", "retrying", "cancelling"].includes(status)) return "*"
  if (["input_needed", "approval_needed", "blocked", "partially_failed"].includes(status)) return "!"
  if (status === "failed") return "x"
  if (status === "completed") return "+"
  if (status === "cancelled") return "-"
  return "o"
}

export function statusColor(status: string, theme: ReturnType<typeof useTheme>["theme"]) {
  if (["running", "in_progress", "retrying"].includes(status)) return theme.info
  if (status === "queued") return theme.textMuted
  if (["input_needed", "approval_needed", "blocked", "cancelling", "partially_failed"].includes(status)) return theme.warning
  if (status === "failed") return theme.error
  if (status === "completed") return theme.success
  return theme.textMuted
}

export function isOrchestratorSwarmRole(role: OpencodeXSwarmRole) {
  return role.skill === "orchestrator" || role.name.trim().toLowerCase() === "orchestrator"
}

export function swarmLeadRole(roles: OpencodeXSwarmRole[]) {
  return roles.find(isOrchestratorSwarmRole) ?? roles[0]
}

export function swarmSpecialistRoles(roles: OpencodeXSwarmRole[]) {
  const lead = swarmLeadRole(roles)
  return lead ? roles.filter((role) => role.id !== lead.id) : roles
}

export function sessionMetadata(session: DashboardSession): Record<string, unknown> | undefined {
  return "metadata" in session ? (session.metadata as Record<string, unknown> | undefined) : undefined
}

export function sessionSwarmID(session: DashboardSession) {
  const opencodex = sessionMetadata(session)?.opencodex
  if (typeof opencodex === "object" && opencodex !== null && "swarmID" in opencodex && typeof opencodex.swarmID === "string") return opencodex.swarmID
  return session.model?.providerID === "swarm" ? session.model.id : undefined
}

export function sessionSwarmTitle(session: DashboardSession, swarms: OpencodeXSwarm[]) {
  const swarmID = sessionSwarmID(session)
  return swarmID ? swarms.find((swarm) => swarm.id === swarmID)?.title : undefined
}

export function isGenericDashboardSession(session: DashboardSession) {
  return !session.parentID && !sessionSwarmID(session)
}

export function dashboardStatusColor(status: DashboardStatus) {
  if (isReviewReadyStatus(status)) return REVIEW_READY_COLOR
  return derivedStatusColor(status)
}

export function dashboardStatusLabel(status: DashboardStatus) {
  if (isReviewReadyStatus(status)) return "Ready for review"
  return statusLabel(status)
}

export function isUnviewed(session: DashboardSession, sync: ReturnType<typeof useSync>) {
  return sync.data.session_ui_state[session.id]?.updated ?? false
}

export function pathShortName(input: string) {
  return input.split(/[\\/]/).filter(Boolean).at(-1) ?? input
}

export function dashboardSessionStatus(session: DashboardSession, sync: ReturnType<typeof useSync>): DashboardStatus {
  const status = deriveStatus(session.id, sync)
  return status === "dormant" && isUnviewed(session, sync) ? "unviewed" : status
}

export function dashboardViewStatus(view: OpencodeXView, sessions: ReadonlyMap<string, DashboardSession>, sync: ReturnType<typeof useSync>): DashboardStatus {
  // Status derives from session members only; terminal panes have no synced
  // activity, so a terminal-only view intentionally reads as dormant.
  const memberSessionIDs = viewSessionMemberIDs(view)
  const status = deriveViewStatus(memberSessionIDs, sync)
  if (status !== "dormant") return status
  return memberSessionIDs
    .map((sessionID) => sessions.get(sessionID))
    .filter((session): session is DashboardSession => session !== undefined)
    .some((session) => isUnviewed(session, sync))
    ? "unviewed"
    : "dormant"
}

export function sessionAttentionReason(session: DashboardSession, status: DashboardStatus, sync: ReturnType<typeof useSync>) {
  const permissions = sync.data.permission[session.id] ?? []
  if (permissions.length > 0) return `${permissions.length} permission request${permissions.length === 1 ? "" : "s"}`
  const questions = sync.data.question[session.id] ?? []
  if (questions.length > 0) return `${questions.length} question${questions.length === 1 ? "" : "s"} waiting`
  if (status === "unviewed") return "new result since last viewed"
  if (status === "review_ready" || status === "needs_review") return "ready for review"
}

export function swarmAttentionReason(status: string) {
  if (status === "approval_needed") return "approval needed"
  if (status === "input_needed") return "input needed"
  if (status === "blocked") return "blocked"
  if (status === "cancelling") return "cancelling"
  if (status === "partially_failed") return "partial failure"
  if (status === "failed") return "failed"
}

export function projectSummaryStatus(summary: DashboardProjectSummary): DashboardStatus {
  if (summary.rows.some((row) => ["input_needed", "approval_needed", "blocked", "failed"].includes(row.status))) return "input_needed"
  if (summary.rows.some((row) => ["in_progress", "running", "queued", "retrying", "cancelling"].includes(row.status))) return "in_progress"
  if (summary.rows.some((row) => row.status === "needs_review")) return "needs_review"
  if (summary.rows.some((row) => row.status === "unviewed")) return "unviewed"
  return "dormant"
}

export function dashboardRowColor(row: DashboardRow, theme: ReturnType<typeof useTheme>["theme"]) {
  return row.dashboardStatus ? dashboardStatusColor(row.dashboardStatus) : statusColor(row.status, theme)
}

export function dashboardRowStatusLabel(row: DashboardRow) {
  if (row.dashboardStatus) return dashboardStatusLabel(row.dashboardStatus)
  return row.kind === "swarm" ? clientSwarmStatusLabel(row.status) : row.status
}

export function truncate(input: string | undefined, length: number) {
  if (!input) return ""
  return input.length > length ? input.slice(0, length - 3) + "..." : input
}

export function defaultTitle(input: string) {
  return truncate(input.trim() || "Untitled task", 48)
}

export function modelLabel(session: DashboardSession) {
  const model = session.model?.id ?? ""
  return model.slice(model.lastIndexOf("/") + 1)
}

export function modelDisplay(providers: ReturnType<typeof useSync>["data"]["provider"], model: { providerID?: string; modelID?: string }) {
  if (!model.providerID || !model.modelID) return "Select model"
  const provider = providers.find((item) => item.id === model.providerID)
  return [provider?.name ?? model.providerID, provider?.models[model.modelID]?.name ?? model.modelID].join(" / ")
}

/** The effort levels (model variants) a chosen model offers; empty means no choice to make. */
export function modelVariants(providers: ReturnType<typeof useSync>["data"]["provider"], model: { providerID?: string; modelID?: string }) {
  if (!model.providerID || !model.modelID) return []
  return Object.keys(providers.find((item) => item.id === model.providerID)?.models[model.modelID]?.variants ?? {})
}

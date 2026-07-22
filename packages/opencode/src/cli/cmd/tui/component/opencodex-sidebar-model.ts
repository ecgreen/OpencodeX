import type { Part, Session } from "@opencode-ai/sdk/v2"
import type { useSync } from "@tui/context/sync"
import { REVIEW_READY_COLOR, isReviewReadyStatus, statusColor, statusLabel } from "./opencodex-session-status"
import type { OpencodeXProjectInfo, OpencodeXSwarmInfo, SidebarStatus } from "./opencodex-sidebar-types"

export function isSessionNotFound(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : (JSON.stringify(error) ?? String(error))
  return message.includes("Session not found")
}

export function modelLabel(session: Session) {
  const model = session.model?.id ?? ""
  return model.slice(model.lastIndexOf("/") + 1)
}

export function sessionSwarmID(session: Session) {
  const opencodex = session.metadata?.opencodex
  if (typeof opencodex !== "object" || opencodex === null || !("swarmID" in opencodex)) return
  return typeof opencodex.swarmID === "string" ? opencodex.swarmID : undefined
}

export function isSwarmSession(session: Session) {
  return sessionSwarmID(session) !== undefined
}

export function isEmptyPlaceholderSession(session: Session) {
  if (session.parentID || session.model || session.summary || session.share || session.revert) return false
  const tokens = session.tokens
  if (tokens && tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write > 0) return false
  if ((session.cost ?? 0) > 0) return false
  return session.title === "New session" || /^New session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(session.title)
}

export function sessionSwarmTitle(session: Session, swarms: OpencodeXSwarmInfo[]) {
  const swarmID = sessionSwarmID(session)
  return swarmID ? swarms.find((swarm) => swarm.id === swarmID)?.title : undefined
}

export function sessionTitle(session: Session, sync: ReturnType<typeof useSync>) {
  if (!session.title.startsWith("New session - ")) return session.title
  const firstUser = (sync.data.message[session.id] ?? []).find((message) => message.role === "user")
  if (!firstUser) return session.title
  return (sync.data.part[firstUser.id] ?? [])
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .find((part) => !("synthetic" in part && part.synthetic) && part.text.trim())
    ?.text.trim().split(/\r?\n/)[0] || session.title
}

export function titleLabel(value: string, length: number) {
  return value.length > length ? value.slice(0, length - 3) + "..." : value
}

export function projectTitle(project: OpencodeXProjectInfo) {
  return project.name ?? project.project.name ?? project.project.worktree
}

export function sidebarStatusColor(status: SidebarStatus) {
  return isReviewReadyStatus(status) ? REVIEW_READY_COLOR : statusColor(status)
}

export function sidebarStatusLabel(status: SidebarStatus) {
  if (status === "unviewed") return "waiting for user to view"
  if (status === "review_ready") return "ready for review"
  return statusLabel(status)
}

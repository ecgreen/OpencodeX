import type { useSync } from "@tui/context/sync"

export type DerivedStatus = "dormant" | "in_progress" | "input_needed" | "needs_review"

export const DERIVED_STATUSES: DerivedStatus[] = ["input_needed", "needs_review", "in_progress", "dormant"]

export function deriveStatus(sessionID: string, sync: ReturnType<typeof useSync>): DerivedStatus {
  const permissions = sync.data.permission[sessionID] ?? []
  const questions = sync.data.question[sessionID] ?? []
  if (permissions.length > 0 || questions.length > 0) return "input_needed"
  const status = sync.data.session_status[sessionID]
  if (status?.type === "busy" || status?.type === "retry") return "in_progress"
  const uiState = sync.data.session_ui_state[sessionID]
  if (uiState?.displayStatus === "input_needed") return "input_needed"
  if (uiState?.displayStatus === "in_progress") return "in_progress"
  if (isLikelyActiveSession(sessionID, sync)) return "in_progress"
  if (uiState?.displayStatus === "needs_review") return "needs_review"
  return "dormant"
}

export function deriveViewStatus(sessionIDs: readonly string[], sync: ReturnType<typeof useSync>): DerivedStatus {
  const statuses = sessionIDs.map((sessionID) => deriveStatus(sessionID, sync))
  if (statuses.includes("input_needed")) return "input_needed"
  if (statuses.includes("in_progress")) return "in_progress"
  if (statuses.includes("needs_review")) return "needs_review"
  return "dormant"
}

export function isActive(status: DerivedStatus) {
  return status !== "dormant"
}

export function statusLabel(status: DerivedStatus) {
  switch (status) {
    case "in_progress":
      return "running"
    case "input_needed":
      return "needs input"
    case "needs_review":
      return "ready for review"
    case "dormant":
      return "idle"
  }
}

function isLikelyActiveSession(sessionID: string, sync: ReturnType<typeof useSync>) {
  const lastAssistant = (sync.data.message[sessionID] ?? []).toReversed().find((message) => message.role === "assistant")
  if (!lastAssistant || lastAssistant.time.completed || lastAssistant.finish) return false
  const parts = sync.data.part[lastAssistant.id] ?? []
  if (parts.some((part) => part.type === "tool" && part.state.status === "running")) return true
  if (parts.some((part) => part.type === "step-start") && !parts.some((part) => part.type === "step-finish")) return true
  return parts.length > 0
}

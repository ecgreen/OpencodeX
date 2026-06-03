import { RGBA } from "@opentui/core"
import type { useSync } from "@tui/context/sync"

export type DerivedStatus = "dormant" | "in_progress" | "input_needed"

export const DERIVED_STATUSES: DerivedStatus[] = ["in_progress", "input_needed", "dormant"]
export const NEW_RESULT_COLOR = RGBA.fromInts(217, 70, 239, 255)

export function deriveStatus(sessionID: string, sync: ReturnType<typeof useSync>): DerivedStatus {
  const permissions = sync.data.permission[sessionID] ?? []
  const questions = sync.data.question[sessionID] ?? []
  if (permissions.length > 0 || questions.length > 0) return "input_needed"
  const status = sync.data.session_status[sessionID]
  if (status?.type === "busy" || status?.type === "retry") return "in_progress"
  return "dormant"
}

export function isActive(status: DerivedStatus) {
  return status !== "dormant"
}

export function statusColor(status: DerivedStatus) {
  switch (status) {
    case "in_progress":
      return RGBA.fromInts(96, 165, 250, 255)
    case "input_needed":
      return RGBA.fromInts(251, 146, 60, 255)
    case "dormant":
      return RGBA.fromInts(180, 180, 180, 255)
  }
}

export function statusLabel(status: DerivedStatus) {
  switch (status) {
    case "in_progress":
      return "running"
    case "input_needed":
      return "needs input"
    case "dormant":
      return "idle"
  }
}

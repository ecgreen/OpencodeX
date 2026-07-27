import { RGBA } from "@opentui/core"
import type { DerivedStatus } from "./opencodex-session-status-core"

export { DERIVED_STATUSES, deriveStatus, deriveViewStatus, isActive, statusLabel, type DerivedStatus } from "./opencodex-session-status-core"

export const REVIEW_READY_COLOR = RGBA.fromInts(96, 165, 250, 255)
export const REVIEW_READY_ICON = "◆"

export function isReviewReadyStatus(status: string) {
  return status === "unviewed" || status === "review_ready" || status === "needs_review"
}

export function statusColor(status: DerivedStatus) {
  switch (status) {
    case "in_progress":
      return REVIEW_READY_COLOR
    case "input_needed":
      return RGBA.fromInts(251, 146, 60, 255)
    case "needs_review":
      return REVIEW_READY_COLOR
    case "dormant":
      return RGBA.fromInts(180, 180, 180, 255)
  }
}

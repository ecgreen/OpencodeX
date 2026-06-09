import { RGBA } from "@opentui/core"
import type { DerivedStatus } from "./opencodex-session-status-core"

export { DERIVED_STATUSES, deriveStatus, deriveViewStatus, isActive, statusLabel, type DerivedStatus } from "./opencodex-session-status-core"

export const NEW_RESULT_COLOR = RGBA.fromInts(217, 70, 239, 255)

export function statusColor(status: DerivedStatus) {
  switch (status) {
    case "in_progress":
      return RGBA.fromInts(96, 165, 250, 255)
    case "input_needed":
      return RGBA.fromInts(251, 146, 60, 255)
    case "needs_review":
      return NEW_RESULT_COLOR
    case "dormant":
      return RGBA.fromInts(180, 180, 180, 255)
  }
}

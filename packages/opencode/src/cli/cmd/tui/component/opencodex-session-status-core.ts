import {
  clientSessionLikelyActive,
  clientSessionStatusLabel,
  deriveClientSessionStatus,
  deriveClientViewStatus,
  isActiveClientSessionStatus,
  type ClientDerivedSessionStatus,
} from "@opencode-ai/sdk/v2"
import { Binary } from "@opencode-ai/core/util/binary"
import type { useSync } from "@tui/context/sync"

type Sync = ReturnType<typeof useSync>

export type DerivedStatus = ClientDerivedSessionStatus

export const DERIVED_STATUSES: DerivedStatus[] = ["input_needed", "needs_review", "in_progress", "dormant"]

/**
 * Thin adapter: gathers the TUI's inputs and hands them to the shared
 * derivation the GUI and the sync engine also use.
 */
export function deriveStatus(sessionID: string, sync: Sync, now?: number): DerivedStatus {
  return deriveClientSessionStatus({
    status: sync.data.session_status[sessionID],
    uiState: sync.data.session_ui_state[sessionID],
    hasPendingInteraction:
      (sync.data.permission[sessionID]?.length ?? 0) > 0 || (sync.data.question[sessionID]?.length ?? 0) > 0,
    pendingPrompt: Boolean(sync.data.session_pending_prompt?.[sessionID]),
    likelyActive: likelyActiveSession(sessionID, sync, now),
  })
}

export function deriveViewStatus(sessionIDs: readonly string[], sync: Sync): DerivedStatus {
  return deriveClientViewStatus(sessionIDs.map((sessionID) => deriveStatus(sessionID, sync)))
}

export function isActive(status: DerivedStatus) {
  return isActiveClientSessionStatus(status)
}

export function statusLabel(status: DerivedStatus) {
  return clientSessionStatusLabel(status)
}

function likelyActiveSession(sessionID: string, sync: Sync, now?: number) {
  const messages = sync.data.message[sessionID]
  if (!messages || messages.length === 0) return false
  const match = Binary.search(sync.data.session, sessionID, (session) => session.id)
  if (!match.found) return false
  return clientSessionLikelyActive(
    messages.map((info) => ({ info, parts: sync.data.part[info.id] })),
    sync.data.session[match.index]!.time.updated,
    now,
  )
}

import type { OpencodeXSessionUiState, Session } from "@opencode-ai/sdk/v2/client"
import {
  clientSessionLikelyActive,
  deriveClientSessionDisplayStatus,
  deriveClientSessionStatus,
  deriveClientViewStatus,
  isActiveClientSessionStatus,
  type ClientCatalogView,
  type ClientDerivedSessionStatus,
  type ClientSessionActivityMessage,
} from "@opencode-ai/sdk/v2/client-sync"
import { statusLabel, statusTone } from "./status-system"
import type { GuiSnapshot } from "./store"

/**
 * The GUI's spelling of the shared status vocabulary. `needs_review` is called
 * `ready_for_review` here because that is what the stylesheets, the status
 * table and the rest of the renderer already say; it is a rename at the
 * boundary, not a second derivation.
 */
export type DerivedSessionStatus = "dormant" | "in_progress" | "input_needed" | "ready_for_review"

export type SessionStatusOptions = {
  /** The session's transcript, when the caller has it, for the activity heuristic. */
  messages?: readonly ClientSessionActivityMessage[]
  now?: number
}

export function isActiveSessionStatus(status: DerivedSessionStatus) {
  return isActiveClientSessionStatus(clientStatusName(status))
}

export function deriveSessionStatus(
  snapshot: GuiSnapshot | undefined,
  session: Session,
  options?: SessionStatusOptions,
): DerivedSessionStatus {
  return guiStatusName(deriveClientStatus(snapshot, session, options))
}

export function deriveViewStatus(view: ClientCatalogView, snapshot: GuiSnapshot | undefined): DerivedSessionStatus {
  const sessions = new Map((snapshot?.sessions ?? []).map((session) => [session.id, session]))
  const statuses = view.sessionIDs
    .map((sessionID) => sessions.get(sessionID))
    .filter((session): session is Session => Boolean(session))
    .map((session) => deriveClientStatus(snapshot, session))
  return guiStatusName(deriveClientViewStatus(statuses))
}

export function reconcileSessionUiState(snapshot: GuiSnapshot, sessionID: string): GuiSnapshot {
  const session = snapshot.sessions.find((item) => item.id === sessionID)
  if (!session) return snapshot
  const nextState = deriveSessionUiState(snapshot, session)
  if (JSON.stringify(snapshot.sessionUiState[sessionID]) === JSON.stringify(nextState)) return snapshot
  return { ...snapshot, sessionUiState: { ...snapshot.sessionUiState, [sessionID]: nextState } }
}

export function markSessionViewedInSnapshot(snapshot: GuiSnapshot, sessionID: string, time: number): GuiSnapshot {
  const state = snapshot.sessionUiState[sessionID]
  if ((state?.seenAt ?? 0) >= time && (state?.reviewedAt ?? 0) >= time) return snapshot
  return reconcileSessionUiState({
    ...snapshot,
    sessionUiState: {
      ...snapshot.sessionUiState,
      [sessionID]: {
        sessionID,
        seenAt: Math.max(time, state?.seenAt ?? 0),
        reviewedAt: Math.max(time, state?.reviewedAt ?? 0),
        reviewedFiles: state?.reviewedFiles ?? [],
        displayStatus: state?.displayStatus ?? "idle",
        updated: state?.updated ?? false,
      },
    },
  }, sessionID)
}

export function deriveSessionUiState(snapshot: GuiSnapshot, session: Session): OpencodeXSessionUiState {
  const state = snapshot.sessionUiState[session.id]
  return {
    sessionID: session.id,
    ...(state?.seenAt === undefined ? {} : { seenAt: state.seenAt }),
    ...(state?.reviewedAt === undefined ? {} : { reviewedAt: state.reviewedAt }),
    reviewedFiles: state?.reviewedFiles ?? [],
    displayStatus: deriveClientSessionDisplayStatus({
      status: snapshot.sessionStatus[session.id],
      hasPendingInteraction: sessionNeedsInput(snapshot, session.id),
      updatedAt: session.time.updated,
      reviewedAt: state?.reviewedAt,
    }),
    updated: session.time.updated > (state?.seenAt ?? 0),
  }
}

/**
 * Optimistic "the prompt is away" flag. The reader pressed Enter, so the
 * session reads as running immediately instead of staying idle until the
 * backend reports `busy`, which is what the TUI has always done.
 */
export function markSessionPromptPendingInSnapshot(snapshot: GuiSnapshot, sessionID: string): GuiSnapshot {
  if (snapshot.sessionPendingPrompt?.[sessionID]) return snapshot
  return { ...snapshot, sessionPendingPrompt: { ...snapshot.sessionPendingPrompt, [sessionID]: true } }
}

export function releaseSessionPromptPendingInSnapshot(snapshot: GuiSnapshot, sessionID: string): GuiSnapshot {
  if (!snapshot.sessionPendingPrompt?.[sessionID]) return snapshot
  const sessionPendingPrompt = { ...snapshot.sessionPendingPrompt }
  delete sessionPendingPrompt[sessionID]
  return { ...snapshot, sessionPendingPrompt }
}

/** Lowercase presentation of the canonical label, for inline sentence use. */
export function sessionStatusLabel(status: string) {
  return statusLabel(status).toLowerCase()
}

/** Delegates to the canonical status table so the GUI has one status mapping. */
export function sessionStatusTone(status: string): "info" | "warning" | "success" | "danger" | "neutral" {
  const tone = statusTone(status)
  return tone === "accent" || tone === "special" ? "info" : tone
}

function deriveClientStatus(
  snapshot: GuiSnapshot | undefined,
  session: Session,
  options?: SessionStatusOptions,
): ClientDerivedSessionStatus {
  return deriveClientSessionStatus({
    status: snapshot?.sessionStatus[session.id],
    uiState: snapshot?.sessionUiState[session.id],
    hasPendingInteraction: sessionNeedsInput(snapshot, session.id),
    pendingPrompt: snapshot?.sessionPendingPrompt?.[session.id] === true,
    likelyActive: options?.messages
      ? clientSessionLikelyActive(options.messages, session.time.updated, options.now)
      : undefined,
  })
}

function guiStatusName(status: ClientDerivedSessionStatus): DerivedSessionStatus {
  return status === "needs_review" ? "ready_for_review" : status
}

function clientStatusName(status: DerivedSessionStatus): ClientDerivedSessionStatus {
  return status === "ready_for_review" ? "needs_review" : status
}

function sessionNeedsInput(snapshot: GuiSnapshot | undefined, sessionID: string) {
  return hasSessionRequest(snapshot?.permissions ?? [], sessionID) || hasSessionRequest(snapshot?.questions ?? [], sessionID)
}

function hasSessionRequest(requests: readonly { sessionID: string }[], sessionID: string) {
  return requests.some((request) => request.sessionID === sessionID)
}

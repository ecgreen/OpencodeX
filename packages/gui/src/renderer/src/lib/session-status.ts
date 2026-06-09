import type { OpencodeXSessionUiState, OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "./store"

export type DerivedSessionStatus = "dormant" | "in_progress" | "input_needed" | "ready_for_review" | "failed"

export function deriveSessionStatus(snapshot: GuiSnapshot | undefined, session: Session): DerivedSessionStatus {
  if (sessionNeedsInput(snapshot, session.id)) return "input_needed"
  if (isRunningBackendStatus(snapshot?.sessionStatus[session.id]?.type)) return "in_progress"
  const displayStatus = snapshot?.sessionUiState[session.id]?.displayStatus
  if (displayStatus === "input_needed") return "input_needed"
  if (displayStatus === "in_progress") return "in_progress"
  if (displayStatus === "needs_review") return "ready_for_review"
  return "dormant"
}

export function deriveViewStatus(view: OpencodeXView, snapshot: GuiSnapshot | undefined): DerivedSessionStatus {
  const sessions = new Map((snapshot?.sessions ?? []).map((session) => [session.id, session]))
  const statuses = view.sessionIDs.map((sessionID) => sessions.get(sessionID)).filter((session): session is Session => Boolean(session)).map((session) => deriveSessionStatus(snapshot, session))
  if (statuses.includes("input_needed")) return "input_needed"
  if (statuses.includes("in_progress")) return "in_progress"
  if (statuses.includes("ready_for_review")) return "ready_for_review"
  return "dormant"
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
    displayStatus: sessionUiDisplayStatus(snapshot, session, state),
    updated: session.time.updated > (state?.seenAt ?? 0),
  }
}

export function sessionStatusLabel(status: string) {
  if (status === "in_progress") return "running"
  if (status === "input_needed") return "needs input"
  if (status === "ready_for_review") return "ready for review"
  if (status === "failed") return "failed"
  return "idle"
}

function isRunningBackendStatus(status: string | undefined) {
  return status === "busy" || status === "retry"
}

function sessionUiDisplayStatus(snapshot: GuiSnapshot, session: Session, state: OpencodeXSessionUiState | undefined) {
  if (sessionNeedsInput(snapshot, session.id)) return "input_needed"
  if (isRunningBackendStatus(snapshot.sessionStatus[session.id]?.type)) return "in_progress"
  if (session.time.updated > (state?.reviewedAt ?? 0)) return "needs_review"
  return "idle"
}

function sessionNeedsInput(snapshot: GuiSnapshot | undefined, sessionID: string) {
  return hasSessionRequest(snapshot?.permissions ?? [], sessionID) || hasSessionRequest(snapshot?.questions ?? [], sessionID)
}

function hasSessionRequest(requests: readonly { sessionID: string }[], sessionID: string) {
  return requests.some((request) => request.sessionID === sessionID)
}

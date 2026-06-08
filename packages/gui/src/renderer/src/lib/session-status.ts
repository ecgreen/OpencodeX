import type { OpencodeXSessionUiState, OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "./store"

export type DerivedSessionStatus = "dormant" | "in_progress" | "input_needed" | "ready_for_review" | "failed"

export function deriveSessionStatus(snapshot: GuiSnapshot | undefined, session: Session): DerivedSessionStatus {
  if ((snapshot?.permissions ?? []).some((request) => request.sessionID === session.id) || (snapshot?.questions ?? []).some((request) => request.sessionID === session.id)) return "input_needed"
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

export function deriveSessionUiState(snapshot: GuiSnapshot, session: Session): OpencodeXSessionUiState {
  const state = snapshot.sessionUiState[session.id]
  const displayStatus =
    (snapshot.permissions ?? []).some((request) => request.sessionID === session.id) || (snapshot.questions ?? []).some((request) => request.sessionID === session.id)
      ? "input_needed"
      : isRunningBackendStatus(snapshot.sessionStatus[session.id]?.type)
        ? "in_progress"
        : session.time.updated > (state?.reviewedAt ?? 0)
          ? "needs_review"
          : "idle"
  return {
    sessionID: session.id,
    ...(state?.seenAt === undefined ? {} : { seenAt: state.seenAt }),
    ...(state?.reviewedAt === undefined ? {} : { reviewedAt: state.reviewedAt }),
    reviewedFiles: state?.reviewedFiles ?? [],
    displayStatus,
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

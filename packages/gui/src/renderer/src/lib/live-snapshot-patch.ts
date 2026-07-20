import type { GlobalEvent, PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { eventData, eventKind } from "./live-session-event"
import { patchSnapshotSession, upsertByID } from "./live-session-patch-helpers"
import { reconcileSessionUiState } from "./session-status"
import type { GuiSnapshot } from "./store"

export function patchSnapshot(snapshot: GuiSnapshot, event: GlobalEvent): GuiSnapshot {
  const properties = eventData(event)
  if (!properties) return snapshot
  switch (eventKind(event)) {
    case "session.updated":
      return patchSnapshotSession(snapshot, (properties as { info: Session }).info)
    case "session.deleted": {
      const deletedSessionID = (properties as { sessionID: string }).sessionID
      return {
        ...snapshot,
        sessions: snapshot.sessions.filter((session) => session.id !== deletedSessionID),
        projects: snapshot.projects.map((project) => ({
          ...project,
          sessionIDs: project.sessionIDs.filter((sessionID) => sessionID !== deletedSessionID),
          sessions: project.sessions.filter((session) => session.id !== deletedSessionID),
        })),
        sessionStatus: Object.fromEntries(Object.entries(snapshot.sessionStatus).filter(([id]) => id !== deletedSessionID)),
        sessionUiState: Object.fromEntries(Object.entries(snapshot.sessionUiState).filter(([id]) => id !== deletedSessionID)),
        permissions: snapshot.permissions.filter((request) => request.sessionID !== deletedSessionID),
        questions: snapshot.questions.filter((request) => request.sessionID !== deletedSessionID),
      }
    }
    case "permission.asked": {
      const value = properties as PermissionRequest
      const request: PermissionRequest = { id: value.id, sessionID: value.sessionID, permission: value.permission, patterns: value.patterns, metadata: value.metadata, always: value.always, tool: value.tool }
      return reconcileSessionUiState({ ...snapshot, permissions: upsertByID(snapshot.permissions, request) }, request.sessionID)
    }
    case "permission.replied": {
      const reply = properties as { requestID: string; sessionID?: string }
      const sessionID = reply.sessionID ?? snapshot.permissions.find((request) => request.id === reply.requestID)?.sessionID
      const next = { ...snapshot, permissions: snapshot.permissions.filter((request) => request.id !== reply.requestID) }
      return sessionID ? reconcileSessionUiState(next, sessionID) : next
    }
    case "question.asked": {
      const value = properties as QuestionRequest
      const request: QuestionRequest = { id: value.id, sessionID: value.sessionID, questions: value.questions, tool: value.tool }
      return reconcileSessionUiState({ ...snapshot, questions: upsertByID(snapshot.questions, request) }, request.sessionID)
    }
    case "question.replied":
    case "question.rejected": {
      const reply = properties as { requestID: string; sessionID?: string }
      const sessionID = reply.sessionID ?? snapshot.questions.find((request) => request.id === reply.requestID)?.sessionID
      const next = { ...snapshot, questions: snapshot.questions.filter((request) => request.id !== reply.requestID) }
      return sessionID ? reconcileSessionUiState(next, sessionID) : next
    }
    default:
      return snapshot
  }
}

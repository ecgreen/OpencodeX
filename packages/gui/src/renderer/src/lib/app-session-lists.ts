import type { Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "./store"
import { modelValue } from "./model-selection"
import { isRenderableSession } from "./store"

export function tuiSidebarSessions(snapshot?: GuiSnapshot) {
  return (snapshot?.sessions ?? []).filter(isTUISidebarSession).toSorted((a, b) => b.time.updated - a.time.updated)
}

export function projectSessions(project: GuiSnapshot["projects"][number], snapshot?: GuiSnapshot) {
  const byID = new Map(tuiSidebarSessions(snapshot).map((session) => [session.id, session]))
  return project.sessions
    .filter(isTUISidebarSession)
    .map((session) => byID.get(session.id) ?? session)
    .filter(isTUISidebarSession)
    .toSorted((a, b) => b.time.updated - a.time.updated)
}

export function recentModelsFromSessions(sessions: Session[]) {
  return mergeRecentModels(
    sessions
      .filter((session) => session.model)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((session) => modelValue(session.model!.providerID, session.model!.id)),
  )
}

export function mergeRecentModels(...groups: string[][]) {
  return Array.from(new Set(groups.flat().filter(Boolean))).slice(0, 10)
}

function isTUISidebarSession(session: Session) {
  return !session.parentID && !isSwarmSession(session) && isRenderableSession(session)
}

function isSwarmSession(session: Session) {
  const opencodex = session.metadata?.opencodex
  return typeof opencodex === "object" && opencodex !== null && "swarmID" in opencodex && typeof opencodex.swarmID === "string"
}

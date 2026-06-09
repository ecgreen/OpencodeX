import type { Session } from "@opencode-ai/sdk/v2/client"
import { shouldPollVisibleSession } from "./session-activity"
import type { GuiSnapshot, SessionData } from "./store"

type RouteLike = { name: string; sessionID?: string }

export type LiveServerSyncPlan = {
  selectedSessionID?: string
  viewSessions: Session[]
  refreshSnapshot: boolean
}

export type VisibleSessionSyncTarget =
  | { type: "session"; sessionID: string }
  | { type: "view"; session: Session }

export function shouldPollSelectedSession(input: {
  followingBottom: boolean
  session?: Session
  status?: GuiSnapshot["sessionStatus"][string]
  data?: SessionData
}) {
  if (!input.followingBottom) return false
  return !input.session || shouldPollVisibleSession(input.status, input.session, input.data)
}

export function viewSessionsToPoll(input: {
  sessions: Session[]
  followingBottom: (sessionID: string) => boolean
  sessionStatus: GuiSnapshot["sessionStatus"]
  sessionData: Record<string, SessionData>
}) {
  return input.sessions
    .filter((session) => input.followingBottom(session.id))
    .filter((session) => shouldPollVisibleSession(input.sessionStatus[session.id], session, input.sessionData[session.id]))
}

export function shouldRefreshSnapshotCards(now: number, lastSync: number, interval: number) {
  return now - lastSync >= interval
}

export function liveServerSyncPlan(input: {
  now: number
  route: RouteLike
  snapshot?: GuiSnapshot
  loadedSessionID: string
  loadedSessionData: SessionData
  activeViewSessions: Session[]
  followingBottom: (sessionID: string) => boolean
  viewSessionData: Record<string, SessionData>
  lastSnapshotSync: number
  snapshotSyncInterval: number
}): LiveServerSyncPlan {
  return {
    selectedSessionID: selectedSessionToPoll(input),
    viewSessions: input.route.name === "views"
      ? viewSessionsToPoll({
        sessions: input.activeViewSessions,
        followingBottom: input.followingBottom,
        sessionStatus: input.snapshot?.sessionStatus ?? {},
        sessionData: input.viewSessionData,
      })
      : [],
    refreshSnapshot: shouldRefreshSnapshotCards(input.now, input.lastSnapshotSync, input.snapshotSyncInterval),
  }
}

export function visibleSessionSyncTarget(input: {
  route: RouteLike
  sessionID: string
  viewSessions: Session[]
  followingBottom: (sessionID: string) => boolean
}): VisibleSessionSyncTarget | undefined {
  if (!input.followingBottom(input.sessionID)) return
  if (input.route.name === "session" && input.route.sessionID === input.sessionID) {
    return { type: "session", sessionID: input.sessionID }
  }
  if (input.route.name !== "views") return
  const session = input.viewSessions.find((item) => item.id === input.sessionID)
  return session ? { type: "view", session } : undefined
}

function selectedSessionToPoll(input: {
  route: RouteLike
  snapshot?: GuiSnapshot
  loadedSessionID: string
  loadedSessionData: SessionData
  followingBottom: (sessionID: string) => boolean
}) {
  if (input.route.name !== "session" || !input.route.sessionID) return
  const session = input.snapshot?.sessions.find((item) => item.id === input.route.sessionID)
  const data = input.loadedSessionID === input.route.sessionID ? input.loadedSessionData : undefined
  if (!shouldPollSelectedSession({ followingBottom: input.followingBottom(input.route.sessionID), session, status: input.snapshot?.sessionStatus[input.route.sessionID], data })) return
  return input.route.sessionID
}

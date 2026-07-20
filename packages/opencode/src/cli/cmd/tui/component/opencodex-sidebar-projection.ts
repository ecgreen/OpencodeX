import type { Session } from "@opencode-ai/sdk/v2"
import { clientSessionOrderBucketForStatus, emptyClientSessionOrderState, priorClientSessionItems, recentClientSessionItems, reconcileClientSessionOrderState } from "@opencode-ai/sdk/v2/session-order"
import type { useLocal } from "@tui/context/local"
import type { useRoute } from "@tui/context/route"
import type { useSync } from "@tui/context/sync"
import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import { getPendingOpencodeXProjectSession } from "./opencodex-session-state"
import { isEmptyPlaceholderSession, isSwarmSession, projectTitle } from "./opencodex-sidebar-model"
import { pinnedSidebarItems } from "./opencodex-sidebar-pins"
import type { OpencodeXProjectInfo, OpencodeXSwarmInfo, OpencodeXViewInfo, SidebarSessionOrderItem } from "./opencodex-sidebar-types"
import { recentProjectItems } from "./opencodex-session-recency"
import { deriveStatus } from "./opencodex-session-status"

export function createOpencodeXSidebarProjection(input: {
  sync: ReturnType<typeof useSync>
  route: ReturnType<typeof useRoute>
  local: ReturnType<typeof useLocal>
  projects: Accessor<OpencodeXProjectInfo[]>
  swarms: Accessor<OpencodeXSwarmInfo[]>
  views: Accessor<OpencodeXViewInfo[]>
}) {
  const sessions = createMemo(() => input.sync.data.session.filter((session) => !session.parentID).toSorted((a, b) => b.time.updated - a.time.updated))
  const sessionByID = createMemo(() => new Map(sessions().map((session) => [session.id, session])))
  const allSessionByID = createMemo(() => new Map([
    ...sessions().map((session) => [session.id, session] as const),
  ]))
  const projectIDBySessionID = createMemo(() => new Map(input.projects().flatMap((project) => project.sessionIDs.map((sessionID) => [sessionID, project.id] as const))))
  const projectTitleBySessionID = createMemo(() => new Map(input.projects().flatMap((project) => project.sessionIDs.map((sessionID) => [sessionID, projectTitle(project)] as const))))
  const allSidebarSessions = createMemo(() => [...allSessionByID().values()].filter((session) => !session.parentID && !isSwarmSession(session) && !isEmptyPlaceholderSession(session)).toSorted((a, b) => b.time.updated - a.time.updated))
  const pinnedSessions = createMemo(() => pinnedSidebarItems(input.local.session.pinned(), allSidebarSessions()))
  const pinnedSessionIDs = createMemo(() => new Set(pinnedSessions().map((session) => session.id)))
  const pinnedViews = createMemo(() => pinnedSidebarItems(input.local.view.pinned(), input.views()))
  const [orderState, setOrderState] = createSignal(emptyClientSessionOrderState())
  const orderItem = (session: Session): SidebarSessionOrderItem => ({ id: session.id, bucket: clientSessionOrderBucketForStatus(deriveStatus(session.id, input.sync)), timeUpdated: session.time.updated, timeCreated: session.time.created, session })
  const orderItems = createMemo(() => allSidebarSessions().map(orderItem))
  createEffect(() => setOrderState((state) => reconcileClientSessionOrderState(state, orderItems())))
  const recentSessions = createMemo(() => recentClientSessionItems(orderItems(), orderState()).map((item) => item.session).filter((session) => !pinnedSessionIDs().has(session.id)))
  const priorSessions = createMemo(() => priorClientSessionItems(orderItems(), orderState()).map((item) => item.session).filter((session) => !pinnedSessionIDs().has(session.id)))
  const recentSessionIDs = createMemo(() => new Set(recentSessions().map((session) => session.id)))
  const priorSessionIDs = createMemo(() => new Set(priorSessions().map((session) => session.id)))
  const currentSessionID = createMemo(() => input.route.data.type === "session" ? input.route.data.sessionID : undefined)
  const currentViewID = createMemo(() => input.route.data.type === "opencodex-view" ? input.route.data.viewID : undefined)
  const pendingProjectSession = createMemo(getPendingOpencodeXProjectSession)
  const activeRowID = createMemo(() => {
    if (input.route.data.type === "opencodex-dashboard") return "nav:dashboard"
    if (input.route.data.type === "session") {
      if (pinnedSessionIDs().has(input.route.data.sessionID)) return `pinned-session:${input.route.data.sessionID}`
      if (recentSessionIDs().has(input.route.data.sessionID)) return `recent-session:${input.route.data.sessionID}`
      if (priorSessionIDs().has(input.route.data.sessionID)) return `prior-session:${input.route.data.sessionID}`
      const projectID = projectIDBySessionID().get(input.route.data.sessionID)
      return projectID ? `project-session:${projectID}:${input.route.data.sessionID}` : `session:${input.route.data.sessionID}`
    }
    if (input.route.data.type === "opencodex-view") return input.local.view.isPinned(input.route.data.viewID) ? `pinned-view:${input.route.data.viewID}` : `view:${input.route.data.viewID}`
    if (input.route.data.type === "home" && pendingProjectSession()) return `pending:${pendingProjectSession()?.projectID}`
  })
  const projectSessions = (project: OpencodeXProjectInfo) => recentProjectItems(
    project.sessionIDs
      .flatMap((sessionID) => sessionByID().get(sessionID) ?? [])
      .filter((session) => !isSwarmSession(session) && !isEmptyPlaceholderSession(session))
      .map(orderItem),
    orderState(),
  ).map((item) => item.session)

  return {
    sessions, sessionByID, allSessionByID, projectIDBySessionID, projectTitleBySessionID, allSidebarSessions,
    pinnedSessions, pinnedSessionIDs, pinnedViews, recentSessions, priorSessions, currentSessionID, currentViewID,
    pendingProjectSession, activeRowID, projectSessions,
  }
}

export function sessionRowID(section: "project" | "recent" | "prior", sessionID: string, projectID?: string) {
  if (section === "project") return `project-session:${projectID}:${sessionID}`
  return section === "recent" ? `recent-session:${sessionID}` : `prior-session:${sessionID}`
}

export function sessionIDFromRow(rowID: string) {
  if (rowID.startsWith("session:")) return rowID.slice("session:".length)
  if (rowID.startsWith("pinned-session:")) return rowID.slice("pinned-session:".length)
  if (rowID.startsWith("recent-session:")) return rowID.slice("recent-session:".length)
  if (rowID.startsWith("prior-session:")) return rowID.slice("prior-session:".length)
  if (rowID.startsWith("project-session:")) return rowID.slice(rowID.lastIndexOf(":") + 1)
}

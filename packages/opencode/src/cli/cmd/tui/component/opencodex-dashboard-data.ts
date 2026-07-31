import {
  clientSessionOrderBucketForStatus,
  emptyClientSessionOrderState,
  priorClientSessionItems,
  projectClientSessionItems,
  recentClientSessionItems,
  reconcileClientSessionOrderState,
} from "@opencode-ai/sdk/v2/session-order"
import { clientSwarmDisplayStatus } from "@opencode-ai/sdk/v2/swarm-presentation"
import type { useRoute } from "@tui/context/route"
import type { useSync } from "@tui/context/sync"
import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import {
  dashboardSessionStatus,
  dashboardViewStatus,
  isGenericDashboardSession,
  modelLabel,
  projectForSession,
  projectTitle,
  sessionAttentionReason,
  sessionSwarmID,
  sessionSwarmTitle,
  swarmAttentionReason,
} from "./opencodex-operation-model"
import type {
  DashboardProjectSummary,
  DashboardRow,
  DashboardSession,
  DashboardSessionOrderItem,
  OpencodeXProject,
  OpencodeXSwarm,
  OpencodeXView,
} from "./opencodex-operations-types"
import { viewMemberCount, viewSessionMemberIDs } from "./opencodex-view-model"

export function createOpencodeXDashboardData(input: {
  sync: ReturnType<typeof useSync>
  route: ReturnType<typeof useRoute>
  projects: Accessor<OpencodeXProject[]>
  swarms: Accessor<OpencodeXSwarm[]>
  views: Accessor<OpencodeXView[]>
  selectedProjectID: Accessor<string | undefined>
}) {
  const topLevelSessions = createMemo(() => {
    const byID = new Map<string, DashboardSession>()
    input.projects().forEach((project) => project.sessions.filter(isGenericDashboardSession).forEach((session) => byID.set(session.id, session)))
    input.sync.data.session.filter(isGenericDashboardSession).forEach((session) => byID.set(session.id, session))
    return [...byID.values()]
  })
  const displaySwarmStatus = (swarm: OpencodeXSwarm) => clientSwarmDisplayStatus(swarm)
  const allDashboardRows = createMemo<DashboardRow[]>(() => {
    const sessionByID = new Map(topLevelSessions().map((session) => [session.id, session]))
    const sessionRows = topLevelSessions().map((session) => {
      const project = projectForSession(input.projects(), session.id)
      const status = dashboardSessionStatus(session, input.sync)
      return {
        id: `session:${session.id}`,
        kind: "session" as const,
        title: session.title,
        subtitle: [project ? projectTitle(input.projects(), project.id) : undefined, sessionSwarmTitle(session, input.swarms()) ?? modelLabel(session)].filter(Boolean).join(" - "),
        projectID: project?.id,
        status,
        dashboardStatus: status,
        reason: sessionAttentionReason(session, status, input.sync),
        timeUpdated: session.time.updated,
        source: sessionSwarmID(session) ? "swarm" : "manual",
        session,
        open: () => input.route.navigate({ type: "session", sessionID: session.id }),
      }
    })
    const swarmRows = input.swarms().map((swarm) => {
      const status = displaySwarmStatus(swarm)
      return {
        id: `swarm:${swarm.id}`,
        kind: "swarm" as const,
        title: swarm.title,
        subtitle: projectTitle(input.projects(), swarm.projectID),
        projectID: swarm.projectID,
        status,
        reason: swarmAttentionReason(status),
        timeUpdated: swarm.timeUpdated,
        source: swarm.source,
        swarm,
        open: () => input.route.navigate({ type: "opencodex-swarms", swarmID: swarm.id }),
      }
    })
    const viewRows = input.views().map((view) => {
      const memberSessionIDs = viewSessionMemberIDs(view)
      const project = input.projects().find((item) => item.sessionIDs.some((sessionID) => memberSessionIDs.includes(sessionID)))
      const status = dashboardViewStatus(view, sessionByID, input.sync)
      return {
        id: `view:${view.id}`,
        kind: "view" as const,
        title: view.title,
        subtitle: `${viewMemberCount(view)} session${viewMemberCount(view) === 1 ? "" : "s"}`,
        projectID: project?.id,
        status,
        dashboardStatus: status,
        timeUpdated: view.timeUpdated,
        source: "manual",
        view,
        open: () => input.route.navigate({ type: "opencodex-view", viewID: view.id }),
      }
    })
    return [...sessionRows, ...swarmRows, ...viewRows].toSorted((a, b) => b.timeUpdated - a.timeUpdated)
  })
  const dashboardRows = createMemo(() => allDashboardRows().filter((row) => !input.selectedProjectID() || row.projectID === input.selectedProjectID()))
  const sessionRows = createMemo(() => dashboardRows().filter((row): row is DashboardRow & { session: DashboardSession } => row.kind === "session" && row.session !== undefined))
  const [orderState, setOrderState] = createSignal(emptyClientSessionOrderState())
  const orderItems = createMemo(() => sessionRows().map((row): DashboardSessionOrderItem => ({ id: row.session.id, bucket: clientSessionOrderBucketForStatus(row.dashboardStatus ?? row.status), timeUpdated: row.timeUpdated, timeCreated: row.session.time.created, row })))
  createEffect(() => setOrderState((state) => reconcileClientSessionOrderState(state, orderItems())))
  const primarySessionRows = createMemo(() => input.selectedProjectID() ? projectClientSessionItems(orderItems(), orderState()).map((item) => item.row) : recentClientSessionItems(orderItems(), orderState()).map((item) => item.row))
  const primaryIDs = createMemo(() => new Set(primarySessionRows().map((row) => row.id)))
  const priorSessionRows = createMemo(() => input.selectedProjectID() ? sessionRows().filter((row) => !primaryIDs().has(row.id)) : priorClientSessionItems(orderItems(), orderState()).map((item) => item.row))
  const swarmRows = createMemo(() => dashboardRows().filter((row): row is DashboardRow & { swarm: OpencodeXSwarm } => row.kind === "swarm" && row.swarm !== undefined))
  const viewRows = createMemo(() => dashboardRows().filter((row): row is DashboardRow & { view: OpencodeXView } => row.kind === "view" && row.view !== undefined))
  const projectSummaries = createMemo<DashboardProjectSummary[]>(() => input.projects().map((project) => {
    const rows = allDashboardRows().filter((row) => row.projectID === project.id)
    return { project, rows, sessionCount: project.sessionIDs.length, swarmCount: rows.filter((row) => row.kind === "swarm").length, lastUpdated: Math.max(0, ...rows.map((row) => row.timeUpdated)) }
  }).toSorted((a, b) => b.lastUpdated - a.lastUpdated))
  const attentionRows = createMemo(() => dashboardRows().filter((row): row is DashboardRow & { reason: string } => row.reason !== undefined).toSorted((a, b) => b.timeUpdated - a.timeUpdated))
  return {
    topLevelSessions, displaySwarmStatus, allDashboardRows, dashboardRows, sessionRows, primarySessionRows, priorSessionRows,
    sessionSectionTitle: () => input.selectedProjectID() ? "Recent Project Sessions" : "Recent Sessions",
    priorSessionSectionTitle: () => input.selectedProjectID() ? "Older Project Sessions" : "Prior Sessions",
    swarmRows, viewRows, projectSummaries, attentionRows,
  }
}

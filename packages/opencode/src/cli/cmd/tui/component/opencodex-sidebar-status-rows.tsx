import type { Session } from "@opencode-ai/sdk/v2"
import { createMemo } from "solid-js"
import type { createOpencodeXSidebarController } from "./opencodex-sidebar-controller"
import {
  modelLabel,
  sessionSwarmTitle,
  sessionTitle,
  sidebarStatusColor,
  sidebarStatusLabel,
} from "./opencodex-sidebar-model"
import { REVIEW_READY_ICON, deriveStatus, deriveViewStatus, isReviewReadyStatus, statusColor } from "./opencodex-session-status"
import { OpencodeXSidebarStatusCard } from "./opencodex-sidebar-status-card"
import type { OpencodeXViewInfo, SidebarStatus } from "./opencodex-sidebar-types"

export function OpencodeXSidebarSessionRow(props: {
  controller: ReturnType<typeof createOpencodeXSidebarController>
  session: Session
  rowID: string
  subtitle?: string
  titleSuffix?: string
}) {
  const status = createMemo(() => deriveStatus(props.session.id, props.controller.sync))
  const active = createMemo(() => props.controller.projection.currentSessionID() === props.session.id)
  const unviewed = createMemo(
    () => status() === "dormant" && (props.controller.sync.data.session_ui_state[props.session.id]?.updated ?? false),
  )
  const displayStatus = createMemo<SidebarStatus>(() => unviewed() ? "unviewed" : status())
  const statusFg = createMemo(() => sidebarStatusColor(displayStatus()))
  const attention = createMemo(() => isReviewReadyStatus(displayStatus()))
  const titleColor = createMemo(() => {
    if (attention()) return statusFg()
    if (status() !== "dormant") return statusColor(status())
    return active() ? props.controller.theme.text : props.controller.theme.textMuted
  })
  const detail = createMemo(() => [
    props.subtitle,
    sessionSwarmTitle(props.session, props.controller.swarms()) ?? modelLabel(props.session),
  ].filter(Boolean).join(" - "))

  return (
    <OpencodeXSidebarStatusCard
      controller={props.controller}
      rowID={props.rowID}
      active={active()}
      title={[sessionTitle(props.session, props.controller.sync), props.titleSuffix].filter(Boolean).join(" - ")}
      titleColor={titleColor()}
      preserveTitleColor={isReviewReadyStatus(displayStatus())}
      borderColor={attention() ? statusFg() : props.controller.isRowSelected(props.rowID) ? props.controller.theme.primary : statusFg()}
      animateTitle={displayStatus() === "input_needed" || attention()}
      detail={detail()}
      progress={status() === "in_progress"}
      progressColor={statusColor("in_progress")}
      progressWidth={3}
      statusText={isReviewReadyStatus(displayStatus()) ? REVIEW_READY_ICON : undefined}
      onOpen={() => props.controller.route.navigate({ type: "session", sessionID: props.session.id })}
    />
  )
}

export function OpencodeXSidebarViewRow(props: {
  controller: ReturnType<typeof createOpencodeXSidebarController>
  view: OpencodeXViewInfo
  rowID: string
}) {
  const active = createMemo(() => props.controller.projection.currentViewID() === props.view.id)
  const sessionsByID = createMemo(() => new Map(props.controller.sync.data.session.map((session) => [session.id, session])))
  const status = createMemo<SidebarStatus>(() => {
    const base = deriveViewStatus(props.view.sessionIDs, props.controller.sync)
    if (base !== "dormant") return base
    return props.view.sessionIDs.some((sessionID) => {
      const session = sessionsByID().get(sessionID)
      return session ? props.controller.sync.data.session_ui_state[session.id]?.updated ?? false : false
    }) ? "unviewed" : "dormant"
  })
  const statusFg = createMemo(() => sidebarStatusColor(status()))
  const attention = createMemo(() => isReviewReadyStatus(status()))
  const titleColor = createMemo(() => {
    if (attention() || status() !== "dormant") return statusFg()
    return active() ? props.controller.theme.text : props.controller.theme.textMuted
  })

  return (
    <OpencodeXSidebarStatusCard
      controller={props.controller}
      rowID={props.rowID}
      active={active()}
      title={props.view.title}
      titleColor={titleColor()}
      preserveTitleColor={isReviewReadyStatus(status())}
      borderColor={attention() ? statusFg() : props.controller.isRowSelected(props.rowID) ? props.controller.theme.primary : statusFg()}
      animateTitle={status() === "input_needed" || attention()}
      detail={`${props.view.sessionIDs.length} session${props.view.sessionIDs.length === 1 ? "" : "s"}`}
      progress={status() === "in_progress"}
      progressColor={statusColor("in_progress")}
      progressWidth={4}
      statusText={isReviewReadyStatus(status()) ? REVIEW_READY_ICON : sidebarStatusLabel(status())}
      onOpen={() => props.controller.route.navigate({ type: "opencodex-view", viewID: props.view.id })}
    />
  )
}

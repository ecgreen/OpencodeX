import type { RGBA } from "@opentui/core"
import type { createOpencodeXSidebarController } from "./opencodex-sidebar-controller"
import { projectTitle, titleLabel } from "./opencodex-sidebar-model"
import { createOpencodeXSidebarRowStyle } from "./opencodex-sidebar-row-style"
import { SIDEBAR_CARD_TITLE_WIDTH } from "./opencodex-sidebar-status-card"
import { OpencodeXSidebarSessionRow, OpencodeXSidebarViewRow } from "./opencodex-sidebar-status-rows"
import type { OpencodeXProjectInfo, SidebarRow } from "./opencodex-sidebar-types"
import { statusColor } from "./opencodex-session-status"

type Controller = ReturnType<typeof createOpencodeXSidebarController>

export function OpencodeXSidebarDashboard(props: { controller: Controller }) {
  const rowID = "nav:dashboard"
  const style = createOpencodeXSidebarRowStyle(props.controller)
  return (
    <box
      id={rowID}
      flexShrink={0}
      marginBottom={1}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="row"
      alignItems="center"
      backgroundColor={style.background(rowID, props.controller.route.data.type === "opencodex-dashboard")}
      onMouseUp={() => {
        props.controller.setSelectedRowID(rowID)
        props.controller.route.navigate({ type: "opencodex-dashboard" })
      }}
    >
      <text>
        <span style={{ fg: props.controller.theme.text }}><b>Opencode</b></span>
        <span style={{ fg: props.controller.theme.warning }}><b>X</b></span>
      </text>
      <text fg={props.controller.theme.textMuted}> Dashboard</text>
    </box>
  )
}

export function OpencodeXSidebarRow(props: { controller: Controller; row: SidebarRow }) {
  if (props.row.id === "section:pinned") {
    return <SidebarSection controller={props.controller} row={props.row} title="Pinned" collapsed={props.controller.pinnedCollapsed()} toggle={() => props.controller.setPinnedCollapsed((value) => !value)} />
  }
  if (props.row.id === "section:projects") {
    return <SidebarSection controller={props.controller} row={props.row} title="Projects" collapsed={props.controller.projectsCollapsed()} toggle={() => props.controller.setProjectsCollapsed((value) => !value)} action={() => void props.controller.createProject()} />
  }
  if (props.row.id === "section:sessions") {
    return <SidebarSection controller={props.controller} row={props.row} title="Recent Sessions" collapsed={props.controller.sessionsCollapsed()} toggle={() => props.controller.setSessionsCollapsed((value) => !value)} action={props.controller.createBlankSession} />
  }
  if (props.row.id === "section:prior-sessions") {
    return <SidebarSection controller={props.controller} row={props.row} title="Prior Sessions" collapsed={props.controller.priorSessionsCollapsed()} toggle={() => props.controller.setPriorSessionsCollapsed((value) => !value)} />
  }
  if (props.row.id === "section:views") {
    return <SidebarSection controller={props.controller} row={props.row} title="Views" collapsed={props.controller.viewsCollapsed()} toggle={() => props.controller.setViewsCollapsed((value) => !value)} action={props.controller.createView} />
  }
  if (props.row.id.startsWith("project:")) {
    const project = props.controller.projects().find((item) => item.id === props.row.id.slice("project:".length))
    return project ? <SidebarProject controller={props.controller} project={project} /> : <></>
  }
  if (props.row.id.startsWith("pending:")) return <SidebarPendingSession controller={props.controller} rowID={props.row.id} />
  if (isSessionRow(props.row.id)) {
    const sessionID = props.controller.sessionIDFromRow(props.row.id)
    const session = sessionID ? props.controller.projection.allSessionByID().get(sessionID) : undefined
    return session ? (
      <OpencodeXSidebarSessionRow
        controller={props.controller}
        session={session}
        rowID={props.row.id}
        subtitle={isTopLevelSessionRow(props.row) ? props.controller.projection.projectTitleBySessionID().get(session.id) : undefined}
      />
    ) : <></>
  }
  if (props.row.id.startsWith("pinned-view:")) {
    const view = props.controller.views().find((item) => item.id === props.row.id.slice("pinned-view:".length))
    return view ? <OpencodeXSidebarViewRow controller={props.controller} view={view} rowID={props.row.id} /> : <></>
  }
  if (props.row.id.startsWith("view:")) {
    const view = props.controller.views().find((item) => item.id === props.row.id.slice("view:".length))
    return view ? <OpencodeXSidebarViewRow controller={props.controller} view={view} rowID={props.row.id} /> : <></>
  }
  if (props.row.id === "empty:projects") return <SidebarEmpty controller={props.controller} rowID={props.row.id} label="No Projects" actionLabel="+ Project" action={() => void props.controller.createProject()} />
  if (props.row.id === "empty:sessions") return <SidebarEmpty controller={props.controller} rowID={props.row.id} label="No Recent Sessions" actionLabel="+ Session" action={props.controller.createBlankSession} />
  if (props.row.id === "empty:views") return <SidebarEmpty controller={props.controller} rowID={props.row.id} label="No Views" actionLabel="+ View" action={props.controller.createView} />
  if (props.row.id.startsWith("empty:project:")) {
    const project = props.controller.projects().find((item) => item.id === props.row.id.slice("empty:project:".length))
    return project ? <SidebarEmpty controller={props.controller} rowID={props.row.id} label="No Recent Sessions" actionLabel="+ Session" action={() => void props.controller.createSession(project)} /> : <></>
  }
  return <></>
}

function SidebarSection(props: {
  controller: Controller
  row: SidebarRow
  title: string
  collapsed: boolean
  toggle(): void
  action?: () => void
}) {
  const style = createOpencodeXSidebarRowStyle(props.controller)
  return (
    <box
      id={props.row.id}
      flexDirection="column"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={style.background(props.row.id, false)}
      onMouseUp={() => {
        props.controller.setSelectedRowID(props.row.id)
        props.toggle()
        props.controller.scheduleScrollSync(props.row.id)
      }}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={style.textColor(props.row.id, props.controller.theme.text)}>
          <b>{props.collapsed ? "[+] " : "[-] "}{props.title}</b>
        </text>
        {props.action ? <SidebarIconButton label="+" onPress={props.action} color={style.textColor(props.row.id)} /> : undefined}
      </box>
      <box width="100%" border={["bottom"]} borderColor={props.controller.theme.borderSubtle} />
    </box>
  )
}

function SidebarPendingSession(props: { controller: Controller; rowID: string }) {
  const style = createOpencodeXSidebarRowStyle(props.controller)
  const active = () => props.controller.route.data.type === "home"
  return (
    <box
      id={props.rowID}
      flexShrink={0}
      marginBottom={1}
      marginLeft={1}
      marginRight={1}
      flexDirection="column"
      backgroundColor={style.cardBackground(props.rowID, active())}
      onMouseUp={() => {
        props.controller.setSelectedRowID(props.rowID)
        props.controller.route.navigate({ type: "home" })
      }}
    >
      <box flexDirection="column" border={["left"]} borderColor={style.selected(props.rowID) ? props.controller.theme.primary : statusColor("dormant")}>
        <box height={1} paddingLeft={1} paddingRight={1}>
          <text fg={style.textColor(props.rowID, active() ? props.controller.theme.text : props.controller.theme.textMuted)} overflow="hidden" wrapMode="none" truncate>
            {titleLabel("New session", SIDEBAR_CARD_TITLE_WIDTH)}
          </text>
        </box>
        <box height={1} paddingLeft={1} paddingRight={1}><text fg={props.controller.theme.textMuted}>pending</text></box>
      </box>
    </box>
  )
}

function SidebarProject(props: { controller: Controller; project: OpencodeXProjectInfo }) {
  const rowID = `project:${props.project.id}`
  const style = createOpencodeXSidebarRowStyle(props.controller)
  const childCount = () => props.controller.projection.projectSessions(props.project).length
    + (props.controller.projection.pendingProjectSession()?.projectID === props.project.id ? 1 : 0)
  const label = () => {
    const count = ` (${childCount()})`
    return `${titleLabel(projectTitle(props.project), 28 - count.length)}${count}`
  }
  return (
    <box
      id={rowID}
      flexShrink={0}
      marginBottom={1}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      justifyContent="space-between"
      backgroundColor={style.background(rowID, false)}
      onMouseUp={() => {
        props.controller.setSelectedRowID(rowID)
        props.controller.toggleProject(props.project.id)
        props.controller.scheduleScrollSync(rowID)
      }}
    >
      <box flexDirection="row" gap={1}>
        <text fg={style.textColor(rowID)}>{props.controller.collapsed()[props.project.id] ? "▸" : "▾"}</text>
        <text fg={style.textColor(rowID, props.controller.theme.text)}><b>{label()}</b></text>
      </box>
      <SidebarIconButton label="+" onPress={() => void props.controller.createSession(props.project)} color={style.textColor(rowID)} />
    </box>
  )
}

function SidebarEmpty(props: { controller: Controller; rowID: string; label: string; actionLabel: string; action(): void }) {
  const style = createOpencodeXSidebarRowStyle(props.controller)
  return (
    <box
      id={props.rowID}
      flexShrink={0}
      marginBottom={1}
      paddingLeft={2}
      paddingRight={1}
      flexDirection="row"
      justifyContent="space-between"
      backgroundColor={style.background(props.rowID, false)}
      onMouseUp={() => {
        props.controller.setSelectedRowID(props.rowID)
        props.action()
      }}
    >
      <text fg={style.textColor(props.rowID)}>{props.label}</text>
      <text fg={style.selected(props.rowID) ? props.controller.theme.text : props.controller.theme.textMuted}>{props.actionLabel}</text>
    </box>
  )
}

function SidebarIconButton(props: { label: string; onPress(): void; color: RGBA }) {
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      onMouseDown={(event: { stopPropagation(): void }) => event.stopPropagation()}
      onMouseUp={(event: { stopPropagation(): void }) => {
        event.stopPropagation()
        props.onPress()
      }}
    >
      <text fg={props.color}>{props.label}</text>
    </box>
  )
}

function isSessionRow(rowID: string) {
  return ["session:", "pinned-session:", "recent-session:", "prior-session:", "project-session:"]
    .some((prefix) => rowID.startsWith(prefix))
}

function isTopLevelSessionRow(row: SidebarRow) {
  return ["section:prior-sessions", "section:sessions", "section:pinned"].includes(row.parentID ?? "")
}

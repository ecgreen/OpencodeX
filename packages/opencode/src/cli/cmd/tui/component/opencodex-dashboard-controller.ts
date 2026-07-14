import { useTerminalDimensions } from "@opentui/solid"
import { usePromptRef } from "@tui/context/prompt"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useTuiConfig } from "../context/tui-config"
import { useBindings, useCommandShortcut } from "../keymap"
import { getScrollAcceleration } from "../util/scroll"
import { createOpencodeXDashboardData } from "./opencodex-dashboard-data"
import { dashboardStatusColor } from "./opencodex-operation-model"
import type { DashboardItem, OpencodeXProject, OpencodeXSwarm, OpencodeXView } from "./opencodex-operations-types"
import { onOpencodeXRefresh } from "./opencodex-refresh"
import { createOpencodeXProjectDialog, useOxSidebar } from "./opencodex-sidebar"
import { setPendingOpencodeXProjectSession } from "./opencodex-session-state"
import { createOpencodeXViewDialog } from "./opencodex-view-dialog"

export function createOpencodeXDashboardController() {
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()
  const route = useRoute()
  const dialog = useDialog()
  const promptRef = usePromptRef()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const [, setOxSidebarOpen] = useOxSidebar()
  const [selected, setSelected] = createSignal(0)
  const [selectedProjectID, setSelectedProjectID] = createSignal<string>()
  const [projectsCollapsed, setProjectsCollapsed] = createSignal(false)
  const [attentionCollapsed, setAttentionCollapsed] = createSignal(false)
  const [sessionsCollapsed, setSessionsCollapsed] = createSignal(false)
  const [priorSessionsCollapsed, setPriorSessionsCollapsed] = createSignal(true)
  const [swarmsCollapsed, setSwarmsCollapsed] = createSignal(false)
  const [viewsCollapsed, setViewsCollapsed] = createSignal(false)
  const projects = createMemo(() => sync.data.opencodex_project as OpencodeXProject[])
  const swarms = createMemo(() => sync.data.opencodex_swarm as OpencodeXSwarm[])
  const views = createMemo(() => sync.data.opencodex_view as OpencodeXView[])
  const selectedProject = createMemo(() => projects().find((project) => project.id === selectedProjectID()))
  const data = createOpencodeXDashboardData({ sync, route, projects, swarms, views, selectedProjectID })
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const cardWidth = createMemo(() => dimensions().width >= 150 ? 42 : dimensions().width >= 110 ? 38 : 34)
  const paletteShortcut = useCommandShortcut("command.palette.show")
  const shortcutHint = createMemo(() => ["arrows/h/j/k/l move grid", "enter open", paletteShortcut() && `${paletteShortcut()} commands`].filter(Boolean).join("  "))
  let refreshRunning = false

  const refreshDashboard = () => {
    if (refreshRunning) return
    refreshRunning = true
    void sync.session.refresh().catch(() => {}).finally(() => { refreshRunning = false })
  }

  onMount(() => {
    setOxSidebarOpen(() => true)
    promptRef.current?.blur()
    promptRef.set(undefined)
  })
  onCleanup(onOpencodeXRefresh(refreshDashboard))

  const createSession = () => {
    const project = selectedProject()
    setPendingOpencodeXProjectSession(project ? { projectID: project.id, directory: project.folders?.[0]?.path ?? project.project.worktree } : undefined)
    route.navigate({ type: "home" })
    dialog.clear()
  }
  const createProject = () => void createOpencodeXProjectDialog({ sdk, dialog, theme, refetch: () => void sync.session.refresh() })
  const createSwarm = () => route.navigate({ type: "opencodex-swarm-create" })
  const clearProject = () => setSelectedProjectID(undefined)
  const selectProject = (projectID: string) => setSelectedProjectID((current) => current === projectID ? undefined : projectID)
  const createView = () => createOpencodeXViewDialog({ sdk, dialog, route, sessionIDs: data.primarySessionRows().slice(0, 4).map((row) => row.session.id) })
  const createActions = createMemo(() => [
    { id: "action:create-project", title: "Project", description: "Group work", tone: theme.warning, onSelect: createProject },
    { id: "action:create-session", title: "Session", description: selectedProject() ? "In focus" : "New chat", tone: dashboardStatusColor("dormant"), onSelect: createSession },
    { id: "action:create-swarm", title: "Swarm", description: "Agent team", tone: theme.success, onSelect: createSwarm },
    { id: "action:create-view", title: "View", description: "Multi-session", tone: theme.info, onSelect: () => void createView() },
  ])
  const dashboardItems = createMemo<DashboardItem[]>(() => [
    ...createActions().map((action) => ({ id: action.id, kind: "item" as const, action: action.onSelect })),
    { id: "section:projects", kind: "section", action: () => setProjectsCollapsed((value) => !value) },
    ...(selectedProjectID() ? [{ id: "action:clear-project", kind: "item" as const, action: clearProject }] : []),
    ...(projectsCollapsed() ? [] : data.projectSummaries().length > 0
      ? data.projectSummaries().map((summary) => ({ id: `project:${summary.project.id}`, kind: "item" as const, action: () => selectProject(summary.project.id) }))
      : [{ id: "empty:projects", kind: "item" as const, action: createProject }]),
    { id: "section:attention", kind: "section", action: () => setAttentionCollapsed((value) => !value) },
    ...(attentionCollapsed() ? [] : data.attentionRows().map((row) => ({ id: `attention:${row.id}`, kind: "item" as const, action: row.open }))),
    { id: "section:sessions", kind: "section", action: () => setSessionsCollapsed((value) => !value) },
    ...(sessionsCollapsed() ? [] : data.primarySessionRows().length > 0
      ? data.primarySessionRows().map((row) => ({ id: row.id, kind: "item" as const, action: row.open }))
      : [{ id: "empty:sessions", kind: "item" as const, action: createSession }]),
    { id: "section:swarms", kind: "section", action: () => setSwarmsCollapsed((value) => !value) },
    ...(swarmsCollapsed() ? [] : data.swarmRows().length > 0
      ? data.swarmRows().map((row) => ({ id: row.id, kind: "item" as const, action: row.open }))
      : [{ id: "empty:swarms", kind: "item" as const, action: createSwarm }]),
    { id: "section:views", kind: "section", action: () => setViewsCollapsed((value) => !value) },
    ...(viewsCollapsed() ? [] : data.viewRows().length > 0
      ? data.viewRows().map((row) => ({ id: row.id, kind: "item" as const, action: row.open }))
      : [{ id: "empty:views", kind: "item" as const, action: () => void createView() }]),
    { id: "section:prior-sessions", kind: "section", action: () => setPriorSessionsCollapsed((value) => !value) },
    ...(priorSessionsCollapsed() ? [] : data.priorSessionRows().map((row) => ({ id: row.id, kind: "item" as const, action: row.open }))),
  ])
  const navigationRows = createMemo(() => {
    const contentWidth = Math.max(1, dimensions().width - 4)
    const createColumns = Math.max(1, Math.floor((contentWidth + 1) / 25))
    const columns = Math.max(1, Math.floor((contentWidth + 1) / (cardWidth() + 1)))
    const rows: string[][] = []
    const pushGrid = (ids: string[], count: number) => {
      for (let index = 0; index < ids.length; index += count) rows.push(ids.slice(index, index + count))
    }
    pushGrid(createActions().map((action) => action.id), createColumns)
    rows.push(["section:projects", ...(selectedProjectID() ? ["action:clear-project"] : [])])
    if (!projectsCollapsed()) pushGrid(data.projectSummaries().length > 0 ? data.projectSummaries().map((summary) => `project:${summary.project.id}`) : ["empty:projects"], columns)
    rows.push(["section:attention"])
    if (!attentionCollapsed() && data.attentionRows().length > 0) pushGrid(data.attentionRows().map((row) => `attention:${row.id}`), columns)
    rows.push(["section:sessions"])
    if (!sessionsCollapsed()) pushGrid(data.primarySessionRows().length > 0 ? data.primarySessionRows().map((row) => row.id) : ["empty:sessions"], columns)
    rows.push(["section:swarms"])
    if (!swarmsCollapsed()) pushGrid(data.swarmRows().length > 0 ? data.swarmRows().map((row) => row.id) : ["empty:swarms"], columns)
    rows.push(["section:views"])
    if (!viewsCollapsed()) pushGrid(data.viewRows().length > 0 ? data.viewRows().map((row) => row.id) : ["empty:views"], columns)
    rows.push(["section:prior-sessions"])
    if (!priorSessionsCollapsed() && data.priorSessionRows().length > 0) pushGrid(data.priorSessionRows().map((row) => row.id), columns)
    return rows.filter((row) => row.length > 0)
  })
  const selectedItem = createMemo(() => dashboardItems()[selected()] ?? dashboardItems()[0])
  const isSelected = (id: string) => selectedItem()?.id === id
  const selectByID = (id: string) => {
    const index = dashboardItems().findIndex((item) => item.id === id)
    if (index >= 0) setSelected(index)
  }
  const moveLinear = (offset: number) => {
    const items = dashboardItems()
    if (items.length > 0) setSelected((selected() + offset + items.length) % items.length)
  }
  const selectedPosition = () => {
    const id = selectedItem()?.id
    if (!id) return
    for (const [row, ids] of navigationRows().entries()) {
      const column = ids.indexOf(id)
      if (column >= 0) return { row, column }
    }
  }
  const moveHorizontal = (offset: -1 | 1) => {
    const rows = navigationRows()
    const position = selectedPosition()
    if (!position || rows.length === 0) return moveLinear(offset)
    const current = rows[position.row]
    if (!current) return
    if (offset < 0 && position.column > 0) return selectByID(current[position.column - 1]!)
    if (offset > 0 && position.column < current.length - 1) return selectByID(current[position.column + 1]!)
    const target = rows[(position.row + offset + rows.length) % rows.length]
    if (target) selectByID(offset < 0 ? target[target.length - 1]! : target[0]!)
  }
  const moveVertical = (offset: -1 | 1) => {
    const rows = navigationRows()
    const position = selectedPosition()
    if (!position || rows.length === 0) return moveLinear(offset)
    const target = rows[(position.row + offset + rows.length) % rows.length]
    if (target) selectByID(target[Math.min(position.column, target.length - 1)]!)
  }
  const openSelected = () => selectedItem()?.action()

  createEffect(() => {
    if (selected() >= dashboardItems().length) setSelected(Math.max(0, dashboardItems().length - 1))
  })
  createEffect(() => {
    if (selectedProjectID() && !selectedProject()) setSelectedProjectID(undefined)
  })
  useBindings(() => ({
    enabled: route.data.type === "opencodex-dashboard" && dialog.stack.length === 0,
    commands: [
      { name: "opencodex.dashboard.route.up", title: "Select dashboard item above", category: "OpencodeX", run: () => moveVertical(-1) },
      { name: "opencodex.dashboard.route.down", title: "Select dashboard item below", category: "OpencodeX", run: () => moveVertical(1) },
      { name: "opencodex.dashboard.route.left", title: "Select dashboard item left", category: "OpencodeX", run: () => moveHorizontal(-1) },
      { name: "opencodex.dashboard.route.right", title: "Select dashboard item right", category: "OpencodeX", run: () => moveHorizontal(1) },
      { name: "opencodex.dashboard.route.open", title: "Open dashboard item", category: "OpencodeX", run: openSelected },
      { name: "opencodex.dashboard.route.refresh", title: "Refresh dashboard", category: "OpencodeX", run: refreshDashboard },
    ],
    bindings: [
      { key: "up,k", desc: "Select above", group: "OpencodeX", cmd: () => moveVertical(-1) },
      { key: "down,j", desc: "Select below", group: "OpencodeX", cmd: () => moveVertical(1) },
      { key: "left,h", desc: "Select left", group: "OpencodeX", cmd: () => moveHorizontal(-1) },
      { key: "right,l", desc: "Select right", group: "OpencodeX", cmd: () => moveHorizontal(1) },
      { key: "return,space", desc: "Open selected item", group: "OpencodeX", cmd: openSelected },
    ],
  }))

  return {
    sync, theme, route, projects, swarms, selectedProjectID, selectedProject, projectsCollapsed, setProjectsCollapsed,
    attentionCollapsed, setAttentionCollapsed, sessionsCollapsed, setSessionsCollapsed, priorSessionsCollapsed,
    setPriorSessionsCollapsed, swarmsCollapsed, setSwarmsCollapsed, viewsCollapsed, setViewsCollapsed, scrollAcceleration,
    cardWidth, shortcutHint, createActions, createSession, createProject, createSwarm, createView, clearProject, selectProject,
    isSelected, selectByID, ...data,
  }
}

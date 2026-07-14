import type { ScrollBoxRenderable } from "@opentui/core"
import { useKV } from "@tui/context/kv"
import { useLocal } from "@tui/context/local"
import { usePromptRef } from "@tui/context/prompt"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { useBindings, useCommandShortcut } from "../keymap"
import { createOpencodeXProjectDialog } from "./opencodex-project-dialogs"
import { onOpencodeXRefresh } from "./opencodex-refresh"
import { createOpencodeXProjectSession } from "./opencodex-session-dialogs"
import { createOpencodeXSidebarProjection, sessionIDFromRow, sessionRowID } from "./opencodex-sidebar-projection"
import { onOpencodeXSidebarFocus, useOxSidebar } from "./opencodex-sidebar-state"
import type { OpencodeXProjectInfo, OpencodeXSwarmInfo, OpencodeXViewInfo, SidebarRow } from "./opencodex-sidebar-types"
import { setPendingOpencodeXProjectSession } from "./opencodex-session-state"
import { createOpencodeXViewDialog } from "./opencodex-view-dialog"

export function createOpencodeXSidebarController() {
  const sync = useSync()
  const route = useRoute()
  const sdk = useSDK()
  const dialog = useDialog()
  const local = useLocal()
  const kv = useKV()
  const promptRef = usePromptRef()
  const { theme } = useTheme()
  const [open, setOpen] = useOxSidebar()
  const focusShortcut = useCommandShortcut("opencodex.sidebar.focus")
  const toggleShortcut = useCommandShortcut("opencodex.sidebar.toggle")
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})
  const [pinnedCollapsed, setPinnedCollapsed] = createSignal(false)
  const [projectsCollapsed, setProjectsCollapsed] = createSignal(false)
  const [sessionsCollapsed, setSessionsCollapsed] = createSignal(false)
  const [priorSessionsCollapsed, setPriorSessionsCollapsed] = createSignal(true)
  const [viewsCollapsed, setViewsCollapsed] = createSignal(false)
  const [sidebarFocused, setSidebarFocused] = createSignal(false)
  const [selectedRowID, setSelectedRowID] = createSignal<string>()
  const projects = createMemo(() => sync.data.opencodex_project as OpencodeXProjectInfo[])
  const swarms = createMemo(() => sync.data.opencodex_swarm as OpencodeXSwarmInfo[])
  const views = createMemo(() => sync.data.opencodex_view as OpencodeXViewInfo[])
  const projection = createOpencodeXSidebarProjection({ sync, route, local, projects, swarms, views })
  const refetch = () => void sync.session.refresh()
  let sidebarScroll: ScrollBoxRenderable | undefined
  let refreshRunning = false

  const refreshSidebar = () => {
    if (refreshRunning) return
    refreshRunning = true
    void sync.session.refresh().catch(() => {}).finally(() => { refreshRunning = false })
  }
  onCleanup(onOpencodeXRefresh(refreshSidebar))

  async function createProject() {
    await createOpencodeXProjectDialog({ sdk, dialog, theme, refetch })
  }
  async function createSession(project: OpencodeXProjectInfo) {
    await createOpencodeXProjectSession({ sdk, dialog, theme, route, sync, refetch, project })
  }
  function createBlankSession() {
    setPendingOpencodeXProjectSession(undefined)
    route.navigate({ type: "home" })
    dialog.clear()
  }
  function createView() {
    void createOpencodeXViewDialog({ sdk, dialog, route, sessionIDs: projection.currentSessionID() ? [projection.currentSessionID()!] : undefined })
  }
  const toggleProject = (projectID: string) => setCollapsed((state) => ({ ...state, [projectID]: !(state[projectID] ?? false) }))
  const setProjectCollapsed = (projectID: string, value: boolean) => setCollapsed((state) => ({ ...state, [projectID]: value }))
  const sidebarRows = createMemo((): SidebarRow[] => [
    { id: "nav:dashboard", activate: () => route.navigate({ type: "opencodex-dashboard" }) },
    { id: "section:pinned", activate: () => setPinnedCollapsed((value) => !value), collapse: () => setPinnedCollapsed(true), expand: () => setPinnedCollapsed(false), keepFocus: true },
    ...(pinnedCollapsed() ? [] : [
      ...projection.pinnedSessions().map((session) => ({ id: `pinned-session:${session.id}`, activate: () => route.navigate({ type: "session", sessionID: session.id }), parentID: "section:pinned" })),
      ...projection.pinnedViews().map((view) => ({ id: `pinned-view:${view.id}`, activate: () => route.navigate({ type: "opencodex-view", viewID: view.id }), parentID: "section:pinned" })),
    ]),
    { id: "section:projects", activate: () => setProjectsCollapsed((value) => !value), collapse: () => setProjectsCollapsed(true), expand: () => setProjectsCollapsed(false), keepFocus: true },
    ...(projectsCollapsed() ? [] : projects().length === 0
      ? [{ id: "empty:projects", activate: () => void createProject(), parentID: "section:projects" }]
      : projects().flatMap((project) => {
          const parentID = `project:${project.id}`
          const children = [
            ...(projection.pendingProjectSession()?.projectID === project.id ? [{ id: `pending:${project.id}`, activate: () => route.navigate({ type: "home" }), parentID }] : []),
            ...projection.projectSessions(project).map((session) => ({ id: sessionRowID("project", session.id, project.id), activate: () => route.navigate({ type: "session", sessionID: session.id }), parentID })),
          ]
          return [
            { id: parentID, activate: () => toggleProject(project.id), collapse: () => setProjectCollapsed(project.id, true), expand: () => setProjectCollapsed(project.id, false), keepFocus: true, parentID: "section:projects" },
            ...(collapsed()[project.id] ? [] : children.length > 0 ? children : [{ id: `empty:project:${project.id}`, activate: () => void createSession(project), parentID }]),
          ]
        })),
    { id: "section:sessions", activate: () => setSessionsCollapsed((value) => !value), collapse: () => setSessionsCollapsed(true), expand: () => setSessionsCollapsed(false), keepFocus: true },
    ...(sessionsCollapsed() ? [] : projection.recentSessions().length > 0
      ? projection.recentSessions().map((session) => ({ id: sessionRowID("recent", session.id), activate: () => route.navigate({ type: "session", sessionID: session.id }), parentID: "section:sessions" }))
      : [{ id: "empty:sessions", activate: createBlankSession, parentID: "section:sessions" }]),
    { id: "section:views", activate: () => setViewsCollapsed((value) => !value), collapse: () => setViewsCollapsed(true), expand: () => setViewsCollapsed(false), keepFocus: true },
    ...(viewsCollapsed() ? [] : views().length > 0
      ? views().map((view) => ({ id: `view:${view.id}`, activate: () => route.navigate({ type: "opencodex-view", viewID: view.id }), parentID: "section:views" }))
      : [{ id: "empty:views", activate: createView, parentID: "section:views" }]),
    { id: "section:prior-sessions", activate: () => setPriorSessionsCollapsed((value) => !value), collapse: () => setPriorSessionsCollapsed(true), expand: () => setPriorSessionsCollapsed(false), keepFocus: true },
    ...(priorSessionsCollapsed() ? [] : projection.priorSessions().map((session) => ({ id: sessionRowID("prior", session.id), activate: () => route.navigate({ type: "session", sessionID: session.id }), parentID: "section:prior-sessions" }))),
  ])
  const scrollRows = createMemo(() => sidebarRows().filter((row) => row.id !== "nav:dashboard"))
  const selectedRow = createMemo(() => sidebarRows().find((row) => row.id === selectedRowID()))
  const rowExists = (rowID?: string) => rowID ? sidebarRows().some((row) => row.id === rowID) : false
  function activeParentRowID() {
    if (route.data.type === "session") {
      const sessionID = route.data.sessionID
      if (projection.pinnedSessionIDs().has(sessionID)) return "section:pinned"
      if (projection.recentSessions().some((session) => session.id === sessionID)) return "section:sessions"
      if (projection.priorSessions().some((session) => session.id === sessionID)) return "section:prior-sessions"
      const projectID = projection.projectIDBySessionID().get(sessionID)
      if (projectID && rowExists(`project:${projectID}`)) return `project:${projectID}`
      return projectID ? "section:projects" : "section:sessions"
    }
    if (route.data.type === "opencodex-view") return local.view.isPinned(route.data.viewID) ? "section:pinned" : "section:views"
    const pending = projection.pendingProjectSession()
    if (route.data.type === "home" && pending) return rowExists(`project:${pending.projectID}`) ? `project:${pending.projectID}` : "section:projects"
  }
  function selectRow(rowID?: string) {
    const activeID = projection.activeRowID()
    const parentID = activeParentRowID()
    setSelectedRowID(rowExists(rowID) ? rowID : rowExists(activeID) ? activeID : rowExists(parentID) ? parentID : sidebarRows()[0]?.id)
  }
  function moveSelection(offset: number) {
    const rows = sidebarRows()
    if (rows.length === 0) return
    const current = rows.findIndex((row) => row.id === selectedRowID())
    const nextID = rows[current < 0 ? 0 : (current + offset + rows.length) % rows.length]?.id
    setSelectedRowID(nextID)
    scheduleScrollSync(nextID)
  }
  function exitFocus() {
    setSidebarFocused(false)
    setTimeout(() => promptRef.current?.focus(), 0)
  }
  function enterFocus() {
    if (!open()) setOpen(() => true)
    setSidebarFocused(true)
    promptRef.current?.blur()
    selectRow(projection.activeRowID() ?? selectedRowID())
    scheduleScrollSync()
  }
  function activateSelected() {
    const row = selectedRow()
    if (!row) return
    row.activate()
    scheduleScrollSync(row.id)
    if (!row.keepFocus) exitFocus()
  }
  function collapseSelected() {
    const row = selectedRow()
    if (!row) return
    if (row.collapse) {
      row.collapse()
      scheduleScrollSync(row.id)
      return
    }
    const parent = sidebarRows().find((item) => item.id === row.parentID)
    if (!parent?.collapse) return
    setSelectedRowID(parent.id)
    parent.collapse()
    scheduleScrollSync(parent.id)
  }
  function expandSelected() {
    const row = selectedRow()
    row?.expand?.()
    scheduleScrollSync(row?.id)
  }
  function clampScroll() {
    if (!sidebarScroll || sidebarScroll.isDestroyed) return
    const maxScroll = Math.max(0, sidebarScroll.scrollHeight - (sidebarScroll.viewport?.height ?? sidebarScroll.height))
    if (sidebarScroll.y > maxScroll) sidebarScroll.scrollTo(maxScroll)
  }
  function scrollIntoView(rowID?: string) {
    const targetID = rowID ?? selectedRowID()
    if (!sidebarScroll || sidebarScroll.isDestroyed || !targetID) return
    const target = sidebarScroll.getChildren().find((child: { id?: string }) => child.id === targetID)
    if (!target) return
    const viewportHeight = sidebarScroll.viewport?.height ?? sidebarScroll.height
    const y = target.y - sidebarScroll.y
    const bottom = y + Math.max(1, target.height ?? 1)
    if (y < 0) return sidebarScroll.scrollBy(y)
    if (bottom > viewportHeight) sidebarScroll.scrollBy(bottom - viewportHeight)
  }
  const syncScroll = (rowID?: string) => { clampScroll(); scrollIntoView(rowID) }
  const scheduleClamp = () => { setTimeout(clampScroll, 0); requestAnimationFrame(clampScroll) }
  const scheduleScrollSync = (rowID?: string) => { setTimeout(() => syncScroll(rowID), 0); requestAnimationFrame(() => syncScroll(rowID)) }

  onCleanup(onOpencodeXSidebarFocus(enterFocus))
  createEffect(() => { if (!open()) setSidebarFocused(false) })
  createEffect(() => {
    if (sidebarRows().length === 0) return setSelectedRowID(undefined)
    if (!rowExists(selectedRowID())) selectRow(selectedRowID())
  })
  createEffect(on(() => sidebarRows().map((row) => row.id).join("\n"), () => sidebarFocused() ? scheduleScrollSync() : scheduleClamp()))
  createEffect(on(selectedRowID, (rowID) => { if (sidebarFocused()) scheduleScrollSync(rowID) }))
  useBindings(() => ({
    enabled: sidebarFocused(),
    commands: [
      { name: "opencodex.sidebar.next", title: "Next sidebar item", category: "OpencodeX Sidebar", hidden: true, run: () => moveSelection(1) },
      { name: "opencodex.sidebar.previous", title: "Previous sidebar item", category: "OpencodeX Sidebar", hidden: true, run: () => moveSelection(-1) },
      { name: "opencodex.sidebar.open", title: "Open sidebar item", category: "OpencodeX Sidebar", hidden: true, run: activateSelected },
      { name: "opencodex.sidebar.close_focus", title: "Return to prompt", category: "OpencodeX Sidebar", hidden: true, run: exitFocus },
      { name: "opencodex.sidebar.collapse", title: "Collapse sidebar item", category: "OpencodeX Sidebar", hidden: true, run: collapseSelected },
      { name: "opencodex.sidebar.expand", title: "Expand sidebar item", category: "OpencodeX Sidebar", hidden: true, run: expandSelected },
    ],
    bindings: [
      { key: "down,j", desc: "Next sidebar item", group: "OpencodeX Sidebar", cmd: "opencodex.sidebar.next" },
      { key: "up,k", desc: "Previous sidebar item", group: "OpencodeX Sidebar", cmd: "opencodex.sidebar.previous" },
      { key: "return", desc: "Open sidebar item", group: "OpencodeX Sidebar", cmd: "opencodex.sidebar.open" },
      { key: "escape", desc: "Return to prompt", group: "OpencodeX Sidebar", cmd: "opencodex.sidebar.close_focus" },
      { key: "left,h", desc: "Collapse sidebar item", group: "OpencodeX Sidebar", cmd: "opencodex.sidebar.collapse" },
      { key: "right,l", desc: "Expand sidebar item", group: "OpencodeX Sidebar", cmd: "opencodex.sidebar.expand" },
    ],
  }))

  return {
    sync, route, sdk, dialog, local, kv, theme, open, setOpen, focusShortcut, toggleShortcut, collapsed, pinnedCollapsed,
    projectsCollapsed, sessionsCollapsed, priorSessionsCollapsed, viewsCollapsed, sidebarFocused, selectedRowID, projects,
    swarms, views, projection, sidebarRows, scrollRows, createProject, createSession, createBlankSession, createView,
    setSelectedRowID, setPinnedCollapsed, setProjectsCollapsed, setSessionsCollapsed, setPriorSessionsCollapsed,
    setViewsCollapsed, toggleProject, scheduleScrollSync, isRowSelected: (rowID?: string) => sidebarFocused() && rowID === selectedRowID(),
    setScroll: (scroll: ScrollBoxRenderable) => { sidebarScroll = scroll }, sessionIDFromRow,
  }
}

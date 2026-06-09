import type { GlobalEvent, OpencodeXSessionState, OpencodeXView, PermissionRequest, ProviderAuthMethod, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { CLIENT_SESSION_SYNC_INTERVAL_MS } from "@opencode-ai/sdk/v2/client-sync"
import type { GuiClient } from "./lib/client"
import type { GuiSnapshot, MessageBundle, SessionData } from "./lib/store"
import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
import { OpencodeXLogo, Titlebar } from "./components/chrome"
import { CollectionPage, ProjectCollectionPage, SessionCollectionPage, StatusPage } from "./components/collection-pages"
import { CommandPaletteModal, type PaletteCommand } from "./components/command-palette"
import { Dashboard } from "./components/dashboard"
import { DiffPage, type DiffMode } from "./components/diff-page"
import { DialogModal, type ChoiceOption, type DialogState } from "./components/dialog-modal"
import { RailSidebar, type RailDragTarget, type RailDropTarget, type RailSectionName } from "./components/rail-sidebar"
import { SessionPage } from "./components/session-page"
import { ViewPaneHost } from "./components/view-pane-host"
import { ViewsPage } from "./components/views"
import { connectGuiClient } from "./lib/client"
import { runCreateProjectSessionAction, runCreateSwarmAction, runCreateViewAction } from "./lib/creation-actions"
import { compactPath, formatRelative, title } from "./lib/format"
import { guiShortcutAction, isKeyboardEditingTarget, runGuiShortcutAction } from "./lib/keyboard-shortcuts"
import { prependOlderMessages, trimToLiveTail, type MessageWindow } from "./lib/message-window"
import { runCycleVariantAction, runSwitchAgentAction, runSwitchModelAction, runSwitchVariantAction } from "./lib/model-actions"
import { firstAvailableModel, modelValue, parseModelValue, selectedModelVariants, sessionModelDefaults } from "./lib/model-selection"
import { buildPaletteCommands } from "./lib/palette-commands"
import { runCreateProjectAction, runCreateSessionRouteAction, runDeleteProjectAction, runEditProjectAction, runEditProjectFoldersAction, runRenameProjectAction } from "./lib/project-actions"
import { droppedReorderIDs, mergeOrderedIDs, moveByOffset } from "./lib/reorder"
import { activeSessionIDForRoute, activeSessionRouteKey as sessionRouteKey, activeViewForRoute, focusedViewItemID, selectedSessionForRoute } from "./lib/route-selection"
import {
  globalEventAction,
  globalEventID,
  applySessionStateSnapshot,
  applySessionStatusSnapshot,
  isSnapshotPatchEvent,
  markViewSessionsLoaded,
  mergeSessionCardSnapshot,
  mergeSnapshot,
  patchSelectedSessionData,
  patchSnapshot,
  patchVisibleViewSessionData,
  runGlobalEventAction,
  sessionDataEventTargets,
} from "./lib/live-session-patch"
import { markSessionViewedInSnapshot } from "./lib/session-status"
import { runSelectedSessionSync, shouldSkipViewSessionSync, viewSessionLoadKey } from "./lib/session-sync"
import { runMoveSessionAction, runPermissionAction, sessionDirectoryForRequest } from "./lib/session-actions"
import { liveServerSyncPlan, visibleSessionSyncTarget } from "./lib/live-sync"
import { buildSessionSlashCommands, type SessionSlashCommand, type SessionSlashCommandContext } from "./lib/session-slash-commands"
import { syncViewSessionsInParallel, viewSessionsInOrder } from "./lib/view-sync"
import { runViewPromptAction } from "./lib/view-prompt"
import { runSessionPromptAction } from "./lib/session-prompt"
import { formatSessionTranscript } from "./lib/transcript"
import {
  abortSession,
  assignSwarmTask,
  authorizeProviderOauth,
  completeProviderOauth,
  createProject,
  createSession,
  createSwarm,
  createView,
  connectMcp,
  deleteView,
  deleteProject,
  deleteSession,
  disconnectMcp,
  disposeInstance,
  forkSession,
  listConsoleOrgs,
  listMcpStatus,
  listProviderAuthMethods,
  listProviders,
  listSkills,
  loadSessionDiff,
  loadSession,
  loadSessionCards,
  loadSessionMessages,
  loadSnapshot,
  loadVcsDiff,
  listWorkspaces,
  moveSession,
  rejectQuestion,
  removeWorkspace,
  renameProject,
  renameSession,
  reorderProjects,
  reorderViews,
  replyPermission,
  replyQuestion,
  sendPrompt,
  setProviderApiAuth,
  shareSession,
  summarizeSession,
  subscribeEvents,
  switchConsoleOrg,
  syncWorkspaces,
  unrevertSession,
  unshareSession,
  updateSessionUiState,
  updateView,
  updateProject,
  updateProjectFolders,
  updateViewFocus,
  validateProjectFolders,
  isRenderableSession,
  revertSession,
  warpSessionWorkspace,
  workspaceStatus,
} from "./lib/store"
import { pendingViewSessions, viewItemID, viewItemSession, type ViewItem } from "./lib/view-items"

type Route =
  | { name: "dashboard" }
  | { name: "sessions" }
  | { name: "new-session"; projectID?: string; directory?: string }
  | { name: "projects" }
  | { name: "session"; sessionID: string }
  | { name: "swarms" }
  | { name: "views"; viewID?: string }
  | { name: "diff"; mode?: DiffMode; sessionID?: string }
  | { name: "settings" }
  | { name: "status" }

const NAV_ITEMS = [
  { name: "dashboard", label: "Dashboard", icon: "dashboard", shortcut: "Ctrl+D", description: "Workspace command center" },
  { name: "projects", label: "Projects", icon: "folder", shortcut: "Ctrl+1", description: "Manage project groups and folders" },
  { name: "swarms", label: "Swarms", icon: "swarm", shortcut: "Ctrl+2", description: "Manage swarms (work in progress)" },
  { name: "views", label: "Views", icon: "views", shortcut: "Ctrl+3", description: "Manage views (work in progress)" },
] as const

const EMPTY_SESSION_DATA: SessionData = { messages: [], todos: [], diffs: [] }
const SESSION_MESSAGE_PAGE_LIMIT = 128
const VIEW_MESSAGE_PAGE_LIMIT = 48
const LOAD_MORE_MESSAGE_MULTIPLIER = 3
const SESSION_MESSAGE_WINDOW: MessageWindow = { count: 128, budget: 100_000 }
const VIEW_MESSAGE_WINDOW: MessageWindow = { count: 48, budget: 28_000 }
const LIVE_SYNC_INTERVAL_MS = CLIENT_SESSION_SYNC_INTERVAL_MS
const SNAPSHOT_SYNC_INTERVAL_MS = 5_000
const SEEN_EVENT_ID_LIMIT = 2_000
const DEFAULT_RAIL_SECTION_ORDER: RailSectionName[] = ["pinned", "projects", "recent", "views"]
const DEFAULT_RAIL_SECTIONS: Record<RailSectionName, boolean> = { pinned: false, projects: false, recent: false, views: true }
const CUSTOM_PROVIDER_OPTION = "__custom_provider__"
const CUSTOM_PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
type GuiThemeMode = "dark" | "light"
export function App() {
  const sidebarPreferences = readSidebarPreferences()
  const [client, setClient] = createSignal<GuiClient>()
  const [snapshot, setSnapshot] = createSignal<GuiSnapshot>()
  const [route, setRoute] = createSignal<Route>({ name: "dashboard" })
  const [sessionData, setSessionData] = createSignal<SessionData>(EMPTY_SESSION_DATA)
  const [viewSessionData, setViewSessionData] = createSignal<Record<string, SessionData>>({})
  const [viewSessionLoadedTimes, setViewSessionLoadedTimes] = createSignal<Record<string, number>>({})
  const [viewLoadingSessions, setViewLoadingSessions] = createSignal<Record<string, boolean>>({})
  const [sessionDataSessionID, setSessionDataSessionID] = createSignal("")
  const [loading, setLoading] = createSignal("Starting sidecar")
  const [error, setError] = createSignal<string>()
  const [prompt, setPrompt] = createSignal("")
  const [selectionSessionID, setSelectionSessionID] = createSignal("")
  const [selectedAgent, setSelectedAgent] = createSignal("")
  const [selectedModel, setSelectedModel] = createSignal("")
  const [selectedVariant, setSelectedVariant] = createSignal("")
  const [themeMode, setThemeMode] = createSignal<GuiThemeMode>(readThemeMode())
  const [showTranscriptTimestamps, setShowTranscriptTimestamps] = createSignal(false)
  const [showTranscriptThinking, setShowTranscriptThinking] = createSignal(true)
  const [notice, setNotice] = createSignal("")
  const [dialog, setDialog] = createSignal<DialogState>()
  const [commandPaletteOpen, setCommandPaletteOpen] = createSignal(false)
  const [railCollapsed, setRailCollapsed] = createSignal(sidebarPreferences.railCollapsed)
  const [loadingSessionID, setLoadingSessionID] = createSignal("")
  const [railSectionOrder, setRailSectionOrder] = createSignal<RailSectionName[]>(sidebarPreferences.railSectionOrder)
  const [railSections, setRailSections] = createSignal<Record<RailSectionName, boolean>>(sidebarPreferences.railSections)
  const [expandedProjectIDs, setExpandedProjectIDs] = createSignal<Record<string, boolean>>(sidebarPreferences.expandedProjectIDs)
  const [pinnedSessionIDs, setPinnedSessionIDs] = createSignal(sidebarPreferences.pinnedSessionIDs)
  const [pinnedViewIDs, setPinnedViewIDs] = createSignal(sidebarPreferences.pinnedViewIDs)
  const [viewAgents, setViewAgents] = createSignal<Record<string, string>>({})
  const [viewModels, setViewModels] = createSignal<Record<string, string>>({})
  const [viewVariants, setViewVariants] = createSignal<Record<string, string>>({})
  const [focusedViewSessionID, setFocusedViewSessionID] = createSignal("")
  const [viewComposerFocusRequest, setViewComposerFocusRequest] = createSignal({ sessionID: "", token: 0 })
  const [recentModels, setRecentModels] = createSignal(readRecentModels())
  const [dragTarget, setDragTarget] = createSignal<RailDragTarget>()
  const [dropTarget, setDropTarget] = createSignal<RailDropTarget>()
  const [projectVisualOrder, setProjectVisualOrder] = createSignal<string[]>([])
  let sessionSyncRequestID = 0
  let sessionDataLoadedTime = 0
  let lastActiveViewMembershipKey = ""
  let viewComposerFocusToken = 0
  let viewFocusPersistTimer: ReturnType<typeof setTimeout> | undefined
  const viewSessionLoadPromises = new Map<string, { key: string; promise: Promise<void> }>()
  const seenEventIDs = new Set<string>()
  const seenEventIDOrder: string[] = []
  let liveSyncRunning = false
  let lastSnapshotSync = 0
  const transcriptFollowBottom = new Map<string, boolean>()

  const selectedSession = createMemo(() => selectedSessionForRoute(route(), snapshot(), client()?.directory))
  const activeSessionID = createMemo(() => activeSessionIDForRoute(route()))
  const activeSessionRouteKey = createMemo(() => sessionRouteKey(route()))
  const activeSessionData = createMemo(() => sessionDataSessionID() === activeSessionID() ? sessionData() : EMPTY_SESSION_DATA)
  const activeSessionLoading = createMemo(() => Boolean(activeSessionID()) && sessionDataSessionID() !== activeSessionID())
  const activeView = createMemo(() => activeViewForRoute(route(), snapshot()?.views ?? []))
  const activeViewSessions = createMemo(() => {
    return viewSessionsInOrder(activeView()).slice(0, 8)
  })
  const activeViewItems = createMemo<ViewItem[]>(() => [
    ...activeViewSessions().map((session): ViewItem => ({ kind: "session", session })),
    ...pendingViewSessions(activeView()).map((slot): ViewItem => ({ kind: "pending", slot })),
  ].slice(0, 8))
  const activeViewLoadKey = createMemo(() => {
    const view = activeView()
    if (!view) return ""
    return [view.id, ...activeViewSessions().map((session) => `${session.id}:${session.directory ?? ""}:${session.time.updated}`)].join("\n")
  })
  const activeViewMembershipKey = createMemo(() => {
    const view = activeView()
    if (!view) return ""
    return [view.id, ...activeViewItems().map((item) => viewItemID(item))].join("\n")
  })
  const activeViewFocusedSessionID = createMemo(() => focusedViewItemID({ localID: focusedViewSessionID(), persistedID: activeView()?.focusedSessionID, items: activeViewItems() }))
  const selectedPermissions = createMemo(() => {
    const session = selectedSession()
    if (!session) return []
    return snapshot()?.permissions.filter((request) => request.sessionID === session.id) ?? []
  })
  const selectedQuestions = createMemo(() => {
    const session = selectedSession()
    if (!session) return []
    return snapshot()?.questions.filter((request) => request.sessionID === session.id) ?? []
  })
  const visibleSessions = createMemo(() => tuiSidebarSessions(snapshot()))
  const pinnedSessionIDSet = createMemo(() => new Set(pinnedSessionIDs()))
  const pinnedViewIDSet = createMemo(() => new Set(pinnedViewIDs()))
  const pinnedSessions = createMemo(() => {
    const byID = new Map(visibleSessions().map((session) => [session.id, session]))
    return pinnedSessionIDs().map((id) => byID.get(id)).filter((session): session is Session => session !== undefined)
  })
  const pinnedViews = createMemo(() => {
    const byID = new Map((snapshot()?.views ?? []).map((view) => [view.id, view]))
    return pinnedViewIDs().map((id) => byID.get(id)).filter((view): view is OpencodeXView => view !== undefined)
  })

  createEffect(() => {
    const mode = themeMode()
    document.documentElement.dataset.theme = mode
    localStorage.setItem("opencodex.gui.theme", mode)
  })

  createEffect(() => {
    writeSidebarPreferences({
      railCollapsed: railCollapsed(),
      railSectionOrder: railSectionOrder(),
      railSections: railSections(),
      expandedProjectIDs: expandedProjectIDs(),
      pinnedSessionIDs: pinnedSessionIDs(),
      pinnedViewIDs: pinnedViewIDs(),
    })
  })

  createEffect(() => {
    const current = snapshot()
    if (!current) return
    const sessionIDs = new Set(visibleSessions().map((session) => session.id))
    const viewIDs = new Set(current.views.map((view) => view.id))
    const nextSessionIDs = pinnedSessionIDs().filter((id) => sessionIDs.has(id))
    const nextViewIDs = pinnedViewIDs().filter((id) => viewIDs.has(id))
    if (nextSessionIDs.join("\n") !== pinnedSessionIDs().join("\n")) setPinnedSessionIDs(nextSessionIDs)
    if (nextViewIDs.join("\n") !== pinnedViewIDs().join("\n")) setPinnedViewIDs(nextViewIDs)
  })

  createEffect(() => {
    const visualOrder = projectVisualOrder()
    if (visualOrder.length === 0) return
    if ((snapshot()?.projects ?? []).map((project) => project.id).join("\n") === visualOrder.join("\n")) setProjectVisualOrder([])
  })

  async function refresh() {
    const gui = client()
    if (!gui) return
    const next = await loadSnapshot(gui)
    setSnapshot((current) => current ? mergeSnapshot(current, next) : next)
    const models = mergeRecentModels(recentModelsFromSessions(next.sessions), recentModels())
    if (models.join("\n") === recentModels().join("\n")) return
    setRecentModels(models)
    writeRecentModels(models)
  }

  async function refreshSessionCards() {
    const gui = client()
    if (!gui) return
    const result = await loadSessionCards(gui, snapshot()?.sessionSyncRevision)
    if (!result.changed) return
    const next = { ...result.snapshot, sessionSyncRevision: result.revision }
    setSnapshot((current) => current ? mergeSessionCardSnapshot(current, next) : current)
    const models = mergeRecentModels(recentModelsFromSessions(next.sessions), recentModels())
    if (models.join("\n") === recentModels().join("\n")) return
    setRecentModels(models)
    writeRecentModels(models)
  }

  async function runAction(action: () => Promise<void>) {
    try {
      await action()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function alert(message: string) {
    setNotice(message)
  }

  function askText(input: { title: string; message?: string; value?: string; multiline?: boolean }) {
    return new Promise<string | undefined>((resolve) => setDialog({ type: "text", ...input, resolve }))
  }

  function confirm(input: { title: string; message: string; confirm?: string }) {
    return new Promise<boolean>((resolve) => setDialog({ type: "confirm", ...input, resolve }))
  }

  function askChoice(input: { title: string; message?: string; options: ChoiceOption[] }) {
    return new Promise<string | undefined>((resolve) => setDialog({ type: "choice", ...input, resolve }))
  }

  async function syncSession(sessionID: string, options: { force?: boolean } = {}) {
    const gui = client()
    if (!gui) return
    const session = snapshot()?.sessions.find((item) => item.id === sessionID)
    await runSelectedSessionSync({
      force: options.force,
      sessionID,
      session,
      loadedSessionID: sessionDataSessionID(),
      loadedTime: sessionDataLoadedTime,
      nextRequestID: () => ++sessionSyncRequestID,
      latestRequestID: () => sessionSyncRequestID,
      route,
      loadingSessionID,
      setLoadingSessionID,
      clearLoadingSessionID: () => setLoadingSessionID(""),
      loadData: async (targetSessionID, directory) => trimToLiveTail(await loadSession(gui, targetSessionID, directory, { messageLimit: SESSION_MESSAGE_PAGE_LIMIT, messageRenderBudget: SESSION_MESSAGE_WINDOW.budget }), SESSION_MESSAGE_WINDOW),
      applyData: (data, loadedTime) => {
        setSessionData(data)
        setSessionDataSessionID(sessionID)
        sessionDataLoadedTime = loadedTime
      },
      applyFailure: (cause) => {
        setNotice(cause instanceof Error ? cause.message : String(cause))
        setSessionData(EMPTY_SESSION_DATA)
        setSessionDataSessionID(sessionID)
      },
    })
  }

  async function syncViewSession(session: Session, options: { force?: boolean } = {}) {
    const gui = client()
    if (!gui) return
    if (shouldSkipViewSessionSync({ force: options.force, session, data: viewSessionData()[session.id], loadedTime: viewSessionLoadedTimes()[session.id] })) return
    const loadKey = viewSessionLoadKey(session)
    const existing = viewSessionLoadPromises.get(session.id)
    if (existing?.key === loadKey) return existing.promise
    setViewLoadingSessions((current) => ({ ...current, [session.id]: true }))
    const promise = (async () => {
      const data = trimToLiveTail(await loadSession(gui, session.id, session.directory, { messageLimit: VIEW_MESSAGE_PAGE_LIMIT, messageRenderBudget: VIEW_MESSAGE_WINDOW.budget, includeSideData: false }), VIEW_MESSAGE_WINDOW)
      if (viewSessionLoadPromises.get(session.id)?.key !== loadKey) return
      setViewSessionData((current) => ({ ...current, [session.id]: data }))
      setViewSessionLoadedTimes((current) => ({ ...current, [session.id]: session.time.updated }))
    })().finally(() => {
      if (viewSessionLoadPromises.get(session.id)?.key !== loadKey) return
      viewSessionLoadPromises.delete(session.id)
      setViewLoadingSessions((current) => ({ ...current, [session.id]: false }))
    })
    viewSessionLoadPromises.set(session.id, { key: loadKey, promise })
    return promise
  }

  async function loadOlderSessionMessages(sessionID: string, before: string) {
    const gui = client()
    if (!gui || sessionDataSessionID() !== sessionID) return
    const session = snapshot()?.sessions.find((item) => item.id === sessionID)
    const page = await loadSessionMessages(gui, sessionID, session?.directory, {
      limit: SESSION_MESSAGE_PAGE_LIMIT * LOAD_MORE_MESSAGE_MULTIPLIER,
      renderBudget: SESSION_MESSAGE_WINDOW.budget * LOAD_MORE_MESSAGE_MULTIPLIER,
      before,
    })
    setSessionData((data) => sessionDataSessionID() === sessionID ? prependOlderMessages(data, page) : data)
  }

  async function loadOlderViewSessionMessages(sessionID: string, before: string) {
    const gui = client()
    if (!gui) return
    const session = snapshot()?.sessions.find((item) => item.id === sessionID)
    if (!session) return
    const page = await loadSessionMessages(gui, sessionID, session.directory, {
      limit: VIEW_MESSAGE_PAGE_LIMIT * LOAD_MORE_MESSAGE_MULTIPLIER,
      renderBudget: VIEW_MESSAGE_WINDOW.budget * LOAD_MORE_MESSAGE_MULTIPLIER,
      before,
    })
    setViewSessionData((current) => ({
      ...current,
      [sessionID]: prependOlderMessages(current[sessionID] ?? EMPTY_SESSION_DATA, page),
    }))
  }

  async function reloadLatestSessionMessages(sessionID: string) {
    await syncSession(sessionID, { force: true })
  }

  async function reloadLatestViewSessionMessages(sessionID: string) {
    const session = snapshot()?.sessions.find((item) => item.id === sessionID)
    if (!session) return
    await syncViewSession(session, { force: true })
  }

  function setSessionFollowingBottom(sessionID: string, value: boolean) {
    transcriptFollowBottom.set(sessionID, value)
  }

  function sessionFollowingBottom(sessionID: string) {
    return transcriptFollowBottom.get(sessionID) ?? true
  }

  async function syncActiveViewSessions() {
    await syncViewSessionsInParallel(activeViewSessions(), activeViewFocusedSessionID(), syncViewSession)
  }

  function applySessionStatusEvent(sessionID: string, status: NonNullable<GuiSnapshot["sessionStatus"][string]>) {
    setSnapshot((current) => applySessionStatusSnapshot(current, sessionID, status))
  }

  function applySessionStateEvent(sessionID: string, state: OpencodeXSessionState) {
    setSnapshot((current) => applySessionStateSnapshot(current, sessionID, state))
  }

  async function syncLiveServerState() {
    const gui = client()
    if (!gui || liveSyncRunning) return
    liveSyncRunning = true
    try {
      const now = Date.now()
      const plan = liveServerSyncPlan({
        now,
        route: route(),
        snapshot: snapshot(),
        loadedSessionID: sessionDataSessionID(),
        loadedSessionData: sessionData(),
        activeViewSessions: activeViewSessions(),
        followingBottom: sessionFollowingBottom,
        viewSessionData: viewSessionData(),
        lastSnapshotSync,
        snapshotSyncInterval: SNAPSHOT_SYNC_INTERVAL_MS,
      })
      if (plan.selectedSessionID) await syncSession(plan.selectedSessionID, { force: true })
      await Promise.all(plan.viewSessions.map((session) => syncViewSession(session, { force: true })))
      if (plan.refreshSnapshot) {
        lastSnapshotSync = now
        await refreshSessionCards()
      }
    } finally {
      liveSyncRunning = false
    }
  }

  function applySessionDataEvent(event: GlobalEvent) {
    const targets = sessionDataEventTargets(event, {
      route: route(),
      activeViewSessions: activeViewSessions(),
      loadedSessionID: sessionDataSessionID(),
      loadedSessionData: sessionData(),
      viewSessionData: viewSessionData(),
    })
    if (!targets) return false

    if (targets.selectedSessionID) {
      const sessionID = targets.selectedSessionID
      setSessionData((data) => patchSelectedSessionData({
        data,
        loadedSessionID: sessionDataSessionID(),
        targetSessionID: sessionID,
        event,
        limit: SESSION_MESSAGE_WINDOW,
        followingBottom: sessionFollowingBottom(sessionID),
        emptyData: EMPTY_SESSION_DATA,
      }))
      setSessionDataSessionID(sessionID)
      sessionDataLoadedTime = Date.now()
    }

    if (targets.visibleSessionIDs.length > 0) {
      setViewSessionData((data) => patchVisibleViewSessionData({
        data,
        sessionIDs: targets.visibleSessionIDs,
        event,
        limit: VIEW_MESSAGE_WINDOW,
        followingBottom: sessionFollowingBottom,
        emptyData: EMPTY_SESSION_DATA,
      }))
      setViewSessionLoadedTimes((data) => markViewSessionsLoaded(data, targets.visibleSessionIDs, Date.now()))
    }

    return true
  }

  function applySnapshotEvent(event: GlobalEvent) {
    if (!isSnapshotPatchEvent(event)) return false
    setSnapshot((current) => current ? patchSnapshot(current, event) : current)
    return true
  }

  function handleGlobalEvent(event: GlobalEvent) {
    if (!rememberGlobalEvent(event)) return

    const refreshAction = runGlobalEventAction(globalEventAction(event), {
      applyStatus: applySessionStatusEvent,
      syncVisible: syncVisibleSession,
      applyState: applySessionStateEvent,
      applySessionData: () => applySessionDataEvent(event),
      applySnapshot: () => applySnapshotEvent(event),
    })
    if (!refreshAction) return

    void refresh()
    if (refreshAction.sessionID) syncVisibleSession(refreshAction.sessionID)
  }

  function rememberGlobalEvent(event: GlobalEvent) {
    const id = globalEventID(event)
    return id ? rememberEventID(id) : true
  }

  function rememberEventID(id: string) {
    if (seenEventIDs.has(id)) return false
    seenEventIDs.add(id)
    seenEventIDOrder.push(id)
    while (seenEventIDOrder.length > SEEN_EVENT_ID_LIMIT) {
      const stale = seenEventIDOrder.shift()
      if (stale) seenEventIDs.delete(stale)
    }
    return true
  }

  function syncVisibleSession(sessionID: string) {
    const target = visibleSessionSyncTarget({ route: route(), sessionID, viewSessions: activeViewSessions(), followingBottom: sessionFollowingBottom })
    if (target?.type === "session") void syncSession(target.sessionID, { force: true })
    if (target?.type === "view") void syncViewSession(target.session, { force: true })
  }

  onMount(() => {
    let unsubscribe: (() => void) | undefined
    onCleanup(() => unsubscribe?.())

    void (async () => {
      try {
        const gui = await connectGuiClient()
        setClient(gui)
        setLoading("Loading workspace")
        await refresh()
        unsubscribe = subscribeEvents(gui, handleGlobalEvent)
        setLoading("")
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
  })

  onMount(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      if (disposed) return
      void syncLiveServerState().catch(() => undefined).finally(() => {
        if (!disposed) timer = setTimeout(tick, LIVE_SYNC_INTERVAL_MS)
      })
    }
    timer = setTimeout(tick, LIVE_SYNC_INTERVAL_MS)
    onCleanup(() => {
      disposed = true
      if (timer) clearTimeout(timer)
    })
  })

  function abortableSessionID() {
    const session = selectedSession()
    const status = session ? snapshot()?.sessionStatus[session.id]?.type : undefined
    return session && (status === "busy" || status === "retry") ? session.id : undefined
  }

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const action = guiShortcutAction(event, {
        editing: isKeyboardEditingTarget(event.target),
        dialogOpen: Boolean(dialog()),
        noticeVisible: Boolean(notice()),
        abortableSessionID: abortableSessionID(),
      })
      if (!action) return
      event.preventDefault()
      runGuiShortcutAction(action, {
        abortSession: (sessionID) => void runAction(() => handleAbortSession(sessionID)),
        clearNotice: () => setNotice(""),
        openCommandPalette: () => setCommandPaletteOpen(true),
        toggleRail: () => setRailCollapsed((value) => !value),
        focusComposer: () => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(),
        createSession: () => void runAction(() => handleCreateSession()),
        refresh: () => void runAction(refresh),
        route: (name) => setRoute({ name }),
      })
    }
    window.addEventListener("keydown", handleKeydown)
    onCleanup(() => window.removeEventListener("keydown", handleKeydown))
  })

  createEffect(() => {
    const current = route()
    if (current.name === "session" && client()) untrack(() => { void syncSession(current.sessionID) })
  })

  createEffect(() => {
    const current = route()
    const view = activeView()
    if (current.name !== "views" || !view) return
    if (current.viewID !== view.id) setRoute({ name: "views", viewID: view.id })
  })

  createEffect(() => {
    const current = route()
    const loadKey = activeViewLoadKey()
    const membershipKey = activeViewMembershipKey()
    if (current.name !== "views" || !loadKey || !client()) return
    if (membershipKey !== lastActiveViewMembershipKey) {
      lastActiveViewMembershipKey = membershipKey
      setFocusedViewSessionID("")
    }
    untrack(() => { void syncActiveViewSessions() })
  })

  createEffect(() => {
    if (route().name !== "session") return
    const session = selectedSession()
    if (!session) return
    markSessionViewed(session.id, Math.max(Date.now(), session.time.updated))
  })

  createEffect(() => {
    if (route().name !== "views") return
    activeViewSessions().forEach((session) => markSessionViewed(session.id, Math.max(Date.now(), session.time.updated)))
  })

  createEffect(() => {
    if (route().name !== "session") return
    const session = selectedSession()
    if (!session || selectionSessionID() === session.id) return
    const defaults = sessionModelDefaults(session, recentModels(), snapshot()?.providers ?? [])
    setSelectionSessionID(session.id)
    setSelectedAgent(defaults.agent)
    setSelectedModel(defaults.model)
    setSelectedVariant(defaults.variant)
  })

  createEffect(() => {
    if (selectedModel()) return
    const model = recentModels()[0] ?? firstAvailableModel(snapshot()?.providers ?? [])
    if (model) setSelectedModel(model)
  })

  async function submitPrompt(event: SubmitEvent, value?: string) {
    event.preventDefault()
    const gui = client()
    await runSessionPromptAction({
      gui,
      route: route(),
      session: selectedSession(),
      text: value ?? prompt(),
      permissionCount: selectedPermissions().length,
      questionCount: selectedQuestions().length,
      agent: selectedAgent(),
      model: selectedModel(),
      variant: selectedVariant(),
      setPrompt,
      setLoadingSessionID,
      sendPrompt: (sessionID, text, options) => gui ? sendPrompt(gui, sessionID, text, options).then(() => undefined) : Promise.resolve(),
      rememberModel,
      syncSession: (sessionID) => syncSession(sessionID, { force: true }),
      refresh,
      openCreatedSession: (sessionID) => setRoute({ name: "session", sessionID }),
    })
  }

  async function submitViewPrompt(event: SubmitEvent, item: ViewItem, value: string) {
    event.preventDefault()
    const gui = client()
    await runViewPromptAction({
      gui,
      item,
      view: activeView(),
      text: value,
      agentForSession: viewAgentValue,
      modelForSession: viewModelValue,
      variantForSession: viewVariantValue,
      setDraftLoading: (draftID, loading) => setViewLoadingSessions((current) => ({ ...current, [draftID]: loading })),
      setFocusedSessionID: setFocusedViewSessionID,
      alert,
      sendPrompt: (sessionID, text, options) => gui ? sendPrompt(gui, sessionID, text, options).then(() => undefined) : Promise.resolve(),
      rememberModel,
      syncViewSession: (session) => syncViewSession(session, { force: true }),
      refresh,
    })
  }

  function viewAgentValue(session: Session) {
    return viewAgents()[session.id] ?? session.agent ?? ""
  }

  function viewModelValue(session: Session) {
    return viewModels()[session.id] ?? (session.model ? modelValue(session.model.providerID, session.model.id) : selectedModel())
  }

  function viewVariantValue(session: Session) {
    return viewVariants()[session.id] ?? session.model?.variant ?? ""
  }

  function focusViewSession(sessionID: string, options: { focusComposer?: boolean } = {}) {
    const view = activeView()
    if (!view) return
    if (activeViewFocusedSessionID() === sessionID) return
    setFocusedViewSessionID(sessionID)
    if (options.focusComposer) setViewComposerFocusRequest({ sessionID, token: ++viewComposerFocusToken })
    scheduleViewFocusPersistence(view, sessionID)
  }

  function scheduleViewFocusPersistence(view: OpencodeXView, sessionID: string) {
    if (!activeViewSessions().some((session) => session.id === sessionID)) return
    if (viewFocusPersistTimer) clearTimeout(viewFocusPersistTimer)
    viewFocusPersistTimer = setTimeout(() => {
      viewFocusPersistTimer = undefined
      const gui = client()
      if (!gui) return
      void updateViewFocus(gui, view.id, sessionID).catch(() => undefined)
    }, 150)
  }

  onCleanup(() => {
    if (viewFocusPersistTimer) clearTimeout(viewFocusPersistTimer)
  })

  function rememberModel(value: string) {
    const next = mergeRecentModels([value], recentModels())
    setRecentModels(next)
    writeRecentModels(next)
  }

  function markSessionViewed(sessionID: string, time: number) {
    const gui = client()
    setSnapshot((current) => current ? markSessionViewedInSnapshot(current, sessionID, time) : current)
    if (gui) void updateSessionUiState(gui, sessionID, { seenAt: time, reviewedAt: time }).catch(() => undefined)
  }

  function toggleRailSection(name: RailSectionName) {
    setRailSections((current) => ({ ...current, [name]: !current[name] }))
  }

  function toggleSessionPinned(sessionID: string) {
    setPinnedSessionIDs((current) => current.includes(sessionID) ? current.filter((id) => id !== sessionID) : [...current, sessionID])
  }

  function toggleViewPinned(viewID: string) {
    setPinnedViewIDs((current) => current.includes(viewID) ? current.filter((id) => id !== viewID) : [...current, viewID])
  }

  function toggleProject(projectID: string) {
    setExpandedProjectIDs((current) => ({ ...current, [projectID]: !projectExpanded(projectID) }))
  }

  function projectOrderIDs() {
    const ids = (snapshot()?.projects ?? []).map((project) => project.id)
    return projectVisualOrder().length === 0 ? ids : mergeOrderedIDs(ids, projectVisualOrder())
  }

  function projectExpanded(projectID: string) {
    return expandedProjectIDs()[projectID] ?? true
  }

  function openSession(sessionID: string) {
    setRoute({ name: "session", sessionID })
  }

  async function handleAbortSession(sessionID: string) {
    const gui = client()
    const session = snapshot()?.sessions.find((item) => item.id === sessionID)
    if (!gui) return
    await abortSession(gui, sessionID, session?.directory)
    await refresh()
  }

  async function handleRenameSession(session: Session) {
    const gui = client()
    if (!gui) return
    const next = (await askText({ title: "Rename Session", value: session.title }))?.trim()
    if (!next) return
    await renameSession(gui, session.id, next, session.directory)
    await refresh()
  }

  async function handleMoveSession(session: Session) {
    const gui = client()
    const projects = snapshot()?.projects ?? []
    if (!gui) return
    await runMoveSessionAction({
      session,
      projects,
      alert,
      chooseProjectID,
      confirm,
      moveSession: (sessionID, projectID) => moveSession(gui, sessionID, projectID).then(() => undefined),
      refresh,
    })
  }

  async function handleDeleteSession(session: Session) {
    const gui = client()
    if (!gui) return
    if (!(await confirm({ title: "Delete Session", message: `Delete "${session.title}"?\n\nThis permanently deletes session data.`, confirm: "Delete" }))) return
    await deleteSession(gui, session.id)
    await refresh()
    setRoute({ name: "dashboard" })
  }

  async function handleSwitchSession() {
    const sessions = tuiSidebarSessions(snapshot())
    if (sessions.length === 0) return alert("No sessions available.")
    const sessionID = await askChoice({
      title: "Switch Session",
      message: "Choose a session to open.",
      options: sessions.map((session) => ({
        value: session.id,
        title: title(session.title),
        description: compactPath(session.directory),
        meta: formatRelative(session.time.updated),
      })),
    })
    if (sessionID) setRoute({ name: "session", sessionID })
  }

  async function handleSwitchModel() {
    await switchModelFor({
      setSelectedModel,
      setSelectedVariant,
    })
  }

  async function handleSwitchAgent() {
    await switchAgentFor(setSelectedAgent)
  }

  async function handleSwitchVariant() {
    await switchVariantFor({
      selectedModel: selectedModel(),
      setSelectedVariant,
    })
  }

  async function switchModelFor(input: {
    setSelectedModel: (value: string) => void
    setSelectedVariant: (value: string) => void
  }) {
    await runSwitchModelAction({
      providers: snapshot()?.providers ?? [],
      alert,
      askChoice,
      setSelectedModel: input.setSelectedModel,
      setSelectedVariant: input.setSelectedVariant,
      rememberModel,
    })
  }

  async function switchAgentFor(setAgent: (value: string) => void) {
    await runSwitchAgentAction({
      agents: snapshot()?.agents ?? [],
      alert,
      askChoice,
      setSelectedAgent: setAgent,
    })
  }

  async function switchVariantFor(input: {
    selectedModel: string
    setSelectedVariant: (value: string) => void
  }) {
    await runSwitchVariantAction({
      providers: snapshot()?.providers ?? [],
      selectedModel: input.selectedModel,
      alert,
      askChoice,
      setSelectedVariant: input.setSelectedVariant,
    })
  }

  function cycleVariant() {
    runCycleVariantAction({
      providers: snapshot()?.providers ?? [],
      selectedModel: selectedModel(),
      selectedVariant: selectedVariant(),
      alert,
      setSelectedVariant,
    })
  }

  async function copyWorkspacePath() {
    const path = selectedSession()?.directory || client()?.directory
    if (!path) return alert("No workspace path available.")
    await navigator.clipboard.writeText(path)
    alert("Copied workspace path.")
  }

  function focusComposer() {
    const current = route()
    if (current.name !== "session" && current.name !== "new-session" && visibleSessions().length > 0) setRoute({ name: "session", sessionID: visibleSessions()[0].id })
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus())
  }

  function showHelp() {
    alert([
      "Ctrl+P opens commands.",
      "Ctrl+/ focuses the composer.",
      "Ctrl+N creates a session.",
      "Ctrl+R refreshes.",
      "Ctrl+B toggles the sidebar.",
      "Ctrl+D and Ctrl+1-3 navigate sections.",
    ].join("\n"))
  }

  async function handleThemeSlash() {
    const value = await askChoice({
      title: "Theme",
      options: [
        { value: "dark", title: "Dark", description: "Use the dark GUI palette" },
        { value: "light", title: "Light", description: "Use the light GUI palette" },
      ],
    })
    if (value !== "dark" && value !== "light") return
    setThemeMode(value)
    alert(`${value === "dark" ? "Dark" : "Light"} mode enabled.`)
  }

  function handleDiffSlash(session?: Session) {
    setRoute({
      name: "diff",
      mode: session ? "last-turn" : "git",
      sessionID: session?.id,
    })
  }

  async function loadDiffForPage(input: { mode: DiffMode; session?: Session }) {
    const gui = client()
    if (!gui) return []
    if (input.mode === "last-turn") {
      if (!input.session) return []
      return (await loadSessionDiff(gui, { sessionID: input.session.id, directory: input.session.directory })).data ?? []
    }
    return (await loadVcsDiff(gui, { mode: "git", context: 12 })).data ?? []
  }

  async function updateDiffReviewedFiles(session: Session, reviewedFiles: string[]) {
    const gui = client()
    if (!gui) return
    const reviewedAt = reviewedFiles.length > 0 && session.summary?.files === reviewedFiles.length ? Math.max(Date.now(), session.time.updated) : undefined
    await updateSessionUiState(gui, session.id, { reviewedFiles, reviewedAt })
    setSnapshot((current) => current ? {
      ...current,
      sessionUiState: {
        ...current.sessionUiState,
        [session.id]: {
          sessionID: session.id,
          displayStatus: current.sessionUiState[session.id]?.displayStatus ?? "idle",
          reviewedFiles,
          updated: current.sessionUiState[session.id]?.updated ?? false,
          seenAt: current.sessionUiState[session.id]?.seenAt,
          reviewedAt: reviewedAt ?? current.sessionUiState[session.id]?.reviewedAt,
        },
      },
    } : current)
  }

  function handleToggleTimestampsSlash() {
    const next = !showTranscriptTimestamps()
    setShowTranscriptTimestamps(next)
    alert(next ? "Message timestamps shown." : "Message timestamps hidden.")
  }

  function handleToggleThinkingSlash() {
    const next = !showTranscriptThinking()
    setShowTranscriptThinking(next)
    alert(next ? "Thinking content shown." : "Thinking content hidden.")
  }

  async function handleSkillsSlash(context?: SessionSlashCommandContext) {
    const gui = client()
    if (!gui) return
    const skills = (await listSkills(gui)).data ?? []
    if (skills.length === 0) return alert("No skills are available.")
    const name = await askChoice({
      title: "Skills",
      options: skills.map((skill) => ({
        value: skill.name,
        title: skill.name,
        description: skill.description?.replace(/\s+/g, " ").trim(),
        meta: skill.location,
      })),
    })
    if (!name) return
    context?.setDraftPrompt(`/${name} `)
  }

  async function handleEditorSlash(session?: Session, context?: SessionSlashCommandContext) {
    if (!window.opencodex?.editor) return alert("External editor support is not available in this environment.")
    const current = context?.draftPrompt.trim().startsWith("/") ? "" : context?.draftPrompt ?? ""
    const content = await window.opencodex.editor({
      value: current,
      cwd: session?.directory || client()?.directory,
    })
    if (content === undefined) return alert("Set VISUAL or EDITOR to use /editor.")
    context?.setDraftPrompt(content)
  }

  async function handleMcpSlash() {
    const gui = client()
    if (!gui) return
    const status = (await listMcpStatus(gui)).data ?? {}
    const options = Object.entries(status).map(([name, item]) => ({
      value: name,
      title: name,
      meta: item.status,
      description: "error" in item ? item.error : item.status === "connected" ? "Disconnect this MCP server" : "Connect this MCP server",
    }))
    if (options.length === 0) return alert("No MCP servers are configured.")
    const name = await askChoice({ title: "Toggle MCP", message: "Connected servers will be disconnected; other servers will be connected.", options })
    if (!name) return
    if (status[name]?.status === "connected") {
      await disconnectMcp(gui, name)
      return alert(`Disconnected ${name}.`)
    }
    await connectMcp(gui, name)
    alert(`Connected ${name}.`)
  }

  async function handleOrgSlash() {
    const gui = client()
    if (!gui) return
    const orgs = (await listConsoleOrgs(gui)).data?.orgs ?? []
    if (orgs.length === 0) return alert("No Console organizations are available.")
    const value = await askChoice({
      title: "Switch Org",
      options: orgs.map((org) => ({
        value: `${org.accountID}:${org.orgID}`,
        title: org.orgName,
        meta: org.active ? "active" : org.accountEmail,
        description: org.accountUrl,
      })),
    })
    const org = orgs.find((item) => `${item.accountID}:${item.orgID}` === value)
    if (!org) return
    if (org.active) return alert(`${org.orgName} is already active.`)
    await switchConsoleOrg(gui, org.accountID, org.orgID)
    await disposeInstance(gui).catch(() => undefined)
    await refresh()
    alert(`Switched to ${org.orgName}.`)
  }

  async function handleConnectSlash() {
    const gui = client()
    if (!gui) return
    const providers = (await listProviders(gui)).data
    const authMethods = (await listProviderAuthMethods(gui)).data ?? {}
    const providerValue = await askChoice({
      title: "Connect Provider",
      options: [
        ...(providers?.all ?? []).map((provider) => ({
          value: provider.id,
          title: provider.name,
          meta: providers?.connected.includes(provider.id) ? "connected" : provider.source,
          description: provider.id,
        })),
        { value: CUSTOM_PROVIDER_OPTION, title: "Other", description: "Save credentials for a custom provider ID" },
      ],
    })
    if (!providerValue) return
    const providerID = providerValue === CUSTOM_PROVIDER_OPTION ? normalizeCustomProviderID(await askText({
      title: "Custom Provider",
      message: "Provider ids must start with a lowercase letter or number and only use lowercase letters, numbers, hyphens, and underscores.",
    })) : providerValue
    if (!providerID) return alert("Invalid provider ID.")
    const methods = authMethods[providerID] ?? [{ type: "api" as const, label: "API key" }]
    const methodValue = methods.length === 1 ? "0" : await askChoice({
      title: "Provider Auth",
      options: methods.map((method, index) => ({
        value: String(index),
        title: method.label,
        meta: method.type,
      })),
    })
    if (!methodValue) return
    const methodIndex = Number(methodValue)
    const method = methods[methodIndex]
    if (!method) return
    const inputs = await promptProviderInputs(method.prompts ?? [])
    if (!inputs) return
    if (method.type === "api") {
      const key = (await askText({ title: method.label, message: providerID === "opencode" ? "Enter your OpenCode Zen API key." : undefined }))?.trim()
      if (!key) return
      await setProviderApiAuth(gui, providerID, key, Object.keys(inputs).length > 0 ? inputs : undefined)
      await disposeInstance(gui).catch(() => undefined)
      await refresh()
      alert(`Connected ${providerID}.`)
      return
    }
    const authorization = (await authorizeProviderOauth(gui, { providerID, method: methodIndex, inputs })).data
    if (!authorization) return alert("No OAuth authorization details returned.")
    window.open(authorization.url, "_blank", "noopener,noreferrer")
    await navigator.clipboard.writeText(authorization.url).catch(() => undefined)
    if (authorization.method === "code") {
      const code = await askText({
        title: method.label,
        message: `${authorization.instructions}\n\n${authorization.url}`,
      })
      if (!code) return
      await completeProviderOauth(gui, { providerID, method: methodIndex, code })
    } else {
      const completed = await askChoice({
        title: method.label,
        message: `${authorization.instructions}\n\nThe authorization URL was opened and copied to the clipboard.`,
        options: [{ value: "done", title: "I completed authorization", description: "Continue provider setup" }],
      })
      if (!completed) return
      await completeProviderOauth(gui, { providerID, method: methodIndex })
    }
    await disposeInstance(gui).catch(() => undefined)
    await refresh()
    alert(`Connected ${providerID}.`)
  }

  async function handleCreateSwarmTaskSlash(input: { selectedAgent?: string; selectedVariant?: string } = {}) {
    const gui = client()
    if (!gui) return
    const swarms = (snapshot()?.swarms ?? []).filter((swarm) => swarm.status !== "cancelled")
    if (swarms.length === 0) return alert("Create an active swarm before assigning a task.")
    const swarmID = await askChoice({
      title: "New Swarm Task",
      options: swarms.map((swarm) => ({
        value: swarm.id,
        title: swarm.title,
        meta: swarm.status,
        description: swarm.prompt || `${swarm.roles.length} roles`,
      })),
    })
    if (!swarmID) return
    const promptText = (await askText({ title: "New Swarm Task", multiline: true }))?.trim()
    if (!promptText) return
    await assignSwarmTask(gui, swarmID, {
      prompt: promptText,
      agent: input.selectedAgent || undefined,
      variant: input.selectedVariant || undefined,
    })
    await refresh()
    setRoute({ name: "swarms" })
    alert("Swarm task assigned.")
  }

  async function handleEditViewSlash() {
    const gui = client()
    if (!gui) return
    const view = await chooseView("Edit View")
    if (!view) return
    const titleText = await askText({ title: "Rename View", value: view.title })
    const nextTitle = titleText?.trim()
    if (!nextTitle) return
    await updateView(gui, view.id, { title: nextTitle })
    await refresh()
    alert("View updated.")
  }

  async function handleDeleteViewSlash() {
    const gui = client()
    if (!gui) return
    const view = await chooseView("Delete View")
    if (!view) return
    if (!(await confirm({ title: "Delete View", message: `Delete "${view.title}"?`, confirm: "Delete" }))) return
    await deleteView(gui, view.id)
    await refresh()
    const current = route()
    if (current.name === "views" && current.viewID === view.id) setRoute({ name: "views" })
    alert("View deleted.")
  }

  async function handleWorkspacesSlash() {
    const gui = client()
    if (!gui) return
    await syncWorkspaces(gui).catch(() => undefined)
    const workspaces = (await listWorkspaces(gui)).data ?? []
    const statuses = new Map(((await workspaceStatus(gui)).data ?? []).map((status) => [status.workspaceID, status.status]))
    if (workspaces.length === 0) return alert("No workspaces are available.")
    const value = await askChoice({
      title: "Manage Workspaces",
      message: "Select a workspace to remove it after confirmation.",
      options: workspaces.map((workspace) => ({
        value: workspace.id,
        title: workspace.name,
        meta: [workspace.type, statuses.get(workspace.id)].filter(Boolean).join(" - "),
        description: [workspace.branch, workspace.directory].filter(Boolean).join(" - "),
      })),
    })
    const workspace = workspaces.find((item) => item.id === value)
    if (!workspace) return
    if (!(await confirm({ title: "Remove Workspace", message: `Remove "${workspace.name}"?`, confirm: "Remove" }))) return
    await removeWorkspace(gui, workspace.id)
    await refresh()
    alert("Workspace removed.")
  }

  async function handleWarpSlash(session?: Session) {
    const gui = client()
    if (!gui || !session) return
    await syncWorkspaces(gui).catch(() => undefined)
    const workspaces = (await listWorkspaces(gui)).data ?? []
    const value = await askChoice({
      title: "Warp Workspace",
      message: "Move this session into a workspace or detach it to the local project.",
      options: [
        { value: "__local__", title: "Local project", description: "Detach this session from workspace sync" },
        ...workspaces.map((workspace) => ({
          value: workspace.id,
          title: workspace.name,
          meta: workspace.type,
          description: [workspace.branch, workspace.directory].filter(Boolean).join(" - "),
        })),
      ],
    })
    if (!value) return
    const copyChanges = await askChoice({
      title: "Copy Changes",
      message: "Copy existing workspace changes into the destination?",
      options: [
        { value: "yes", title: "Copy changes", description: "Preserve pending changes during the warp" },
        { value: "no", title: "Do not copy", description: "Move the session without copying changes" },
      ],
    })
    if (!copyChanges) return
    await warpSessionWorkspace(gui, { id: value === "__local__" ? null : value, sessionID: session.id, copyChanges: copyChanges === "yes" })
    await refresh()
    await reloadSessionAfterSlash(session)
    alert("Session workspace updated.")
  }

  async function handleShareSlash(session?: Session) {
    const gui = client()
    if (!gui || !session) return
    const url = session.share?.url ?? (await shareSession(gui, session.id)).data?.share?.url
    if (!url) return alert("No share URL returned.")
    await navigator.clipboard.writeText(url)
    await refresh()
    alert("Share URL copied.")
  }

  async function handleUnshareSlash(session?: Session) {
    const gui = client()
    if (!gui || !session) return
    await unshareSession(gui, session.id)
    await refresh()
    alert("Session unshared.")
  }

  async function handleCompactSlash(session?: Session, currentModel = selectedModel()) {
    const gui = client()
    if (!gui || !session) return
    const model = parseModelValue(currentModel)
    if (!model) return alert("Select a model before compacting this session.")
    await summarizeSession(gui, { sessionID: session.id, providerID: model.providerID, modelID: model.modelID })
    await refresh()
    alert("Session compaction started.")
  }

  async function handleUndoSlash(session?: Session, data = activeSessionData(), restorePrompt: (value: string) => void = setPrompt) {
    const gui = client()
    if (!gui || !session) return
    const status = snapshot()?.sessionStatus[session.id]?.type
    if (status && status !== "idle") await abortSession(gui, session.id, session.directory).catch(() => undefined)
    const message = data.messages.findLast((item) => (!session.revert?.messageID || item.info.id < session.revert.messageID) && item.info.role === "user")
    if (!message) return alert("No previous user message to undo.")
    await revertSession(gui, { sessionID: session.id, messageID: message.info.id })
    restorePrompt(message.parts.map(textPartContent).join(""))
    await reloadSessionAfterSlash(session)
  }

  async function handleRedoSlash(session?: Session, data = activeSessionData()) {
    const gui = client()
    if (!gui || !session) return
    const messageID = session.revert?.messageID
    if (!messageID) return alert("No message to redo.")
    const message = data.messages.find((item) => item.info.role === "user" && item.info.id > messageID)
    if (!message) await unrevertSession(gui, session.id)
    else await revertSession(gui, { sessionID: session.id, messageID: message.info.id })
    await reloadSessionAfterSlash(session)
  }

  async function handleTimelineSlash(session?: Session, data = activeSessionData()) {
    if (!session) return
    const messageID = await chooseUserMessage("Jump to Message", data)
    if (!messageID) return
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `.session-page[data-session-id="${CSS.escape(session.id)}"] [data-message-id="${CSS.escape(messageID)}"]`,
        )
        ?.scrollIntoView({ block: "center" })
    })
  }

  async function handleForkSlash(session?: Session, data = activeSessionData()) {
    const gui = client()
    if (!gui || !session) return
    const value = await askChoice({
      title: "Fork Session",
      message: "Choose where to fork from.",
      options: [
        { value: "__full__", title: "Full session", description: "Fork from the current end of the session" },
        ...userMessageOptions(data),
      ],
    })
    if (!value) return
    const forked = await forkSession(gui, { sessionID: session.id, messageID: value === "__full__" ? undefined : value })
    const next = forked.data
    if (!next) return alert("No forked session returned.")
    if (value !== "__full__") {
      const message = data.messages.find((item) => item.info.id === value)
      setPrompt(message?.parts.map(textPartContent).join("") ?? "")
    }
    await refresh()
    setRoute({ name: "session", sessionID: next.id })
  }

  async function handleCopyTranscriptSlash(session?: Session) {
    const transcript = await loadTranscriptForSlash(session)
    if (!transcript) return
    await navigator.clipboard.writeText(transcript)
    alert("Session transcript copied.")
  }

  async function handleExportTranscriptSlash(session?: Session) {
    const transcript = await loadTranscriptForSlash(session)
    if (!transcript || !session) return
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([transcript], { type: "text/markdown" }))
    link.download = `session-${session.id.slice(0, 8)}.md`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  async function loadTranscriptForSlash(session?: Session) {
    const gui = client()
    if (!gui || !session) return
    const data = await loadSession(gui, session.id, session.directory, { messageLimit: 10_000 })
    return formatSessionTranscript({ session, messages: data.messages, providers: snapshot()?.providers ?? [] })
  }

  async function reloadSessionAfterSlash(session: Session) {
    await refresh()
    if (sessionDataSessionID() === session.id) await syncSession(session.id, { force: true })
    if (viewSessionData()[session.id]) await syncViewSession(session, { force: true })
  }

  async function chooseUserMessage(titleText: string, data: SessionData) {
    const options = userMessageOptions(data)
    if (options.length === 0) return alert("No user messages available.")
    return askChoice({ title: titleText, options })
  }

  function userMessageOptions(data: SessionData) {
    return data.messages
      .filter((message) => message.info.role === "user")
      .map((message) => ({
        value: message.info.id,
        title: message.parts.map(textPartContent).join("").replace(/\s+/g, " ").trim() || "User message",
        description: new Date(message.info.time.created).toLocaleString(),
      }))
      .toReversed()
  }

  function textPartContent(part: MessageBundle["parts"][number]) {
    if (part.type !== "text" || part.synthetic || part.ignored) return ""
    return part.text
  }

  function normalizeCustomProviderID(value?: string) {
    const providerID = value?.trim().replace(/^@ai-sdk\//, "")
    if (!providerID || !CUSTOM_PROVIDER_ID.test(providerID)) return
    return providerID
  }

  async function promptProviderInputs(prompts: NonNullable<ProviderAuthMethod["prompts"]>) {
    const inputs: Record<string, string> = {}
    for (const prompt of prompts) {
      if (prompt.when) {
        const value = inputs[prompt.when.key]
        const matches = value === undefined ? false : prompt.when.op === "eq" ? value === prompt.when.value : value !== prompt.when.value
        if (!matches) continue
      }
      const value = prompt.type === "select"
        ? await askChoice({
          title: prompt.message,
          options: prompt.options.map((option) => ({
            value: option.value,
            title: option.label,
            description: option.hint,
          })),
        })
        : await askText({ title: prompt.message, message: prompt.placeholder })
      if (value === undefined) return
      inputs[prompt.key] = value
    }
    return inputs
  }

  async function chooseView(titleText: string) {
    const views = snapshot()?.views ?? []
    if (views.length === 0) {
      alert("No views are available.")
      return
    }
    const value = await askChoice({
      title: titleText,
      options: views.map((view) => ({
        value: view.id,
        title: view.title,
        meta: `${view.sessions.length} sessions`,
        description: view.focusedSessionID ? `Focused session: ${view.focusedSessionID}` : undefined,
      })),
    })
    return views.find((view) => view.id === value)
  }

  function sessionSlashCommands(
    session?: Session,
    options: {
      data?: SessionData
      selectedModel?: string
      selectedAgent?: string
      selectedVariant?: string
      restorePrompt?: (value: string) => void
      switchModel?: () => void | Promise<void>
      switchAgent?: () => void | Promise<void>
      switchVariant?: () => void | Promise<void>
    } = {},
  ): SessionSlashCommand[] {
    return buildSessionSlashCommands({
      shared: !!session?.share?.url,
      canRedo: !!session?.revert?.messageID,
      variantCount: selectedModelVariants(snapshot()?.providers ?? [], options.selectedModel ?? selectedModel()).length,
      actions: {
        switchSession: handleSwitchSession,
        createSession: () => handleCreateSession(),
        openDashboard: () => {
          setRoute({ name: "dashboard" })
        },
        createProject: handleCreateProject,
        openSwarms: () => {
          setRoute({ name: "swarms" })
        },
        openSwarm: () => {
          setRoute({ name: "swarms" })
        },
        createSwarm: handleCreateSwarm,
        createSwarmTask: () => handleCreateSwarmTaskSlash({
          selectedAgent: options.selectedAgent ?? selectedAgent(),
          selectedVariant: options.selectedVariant ?? selectedVariant(),
        }),
        openView: () => {
          setRoute({ name: "views" })
        },
        createView: handleCreateView,
        editView: handleEditViewSlash,
        deleteView: handleDeleteViewSlash,
        createProjectSession: handleCreateProjectSession,
        manageWorkspaces: handleWorkspacesSlash,
        switchModel: (context) => {
          if (context?.openModelPicker) return context.openModelPicker()
          return (options.switchModel ?? handleSwitchModel)()
        },
        switchAgent: options.switchAgent ?? handleSwitchAgent,
        toggleMcps: handleMcpSlash,
        switchVariant: options.switchVariant ?? handleSwitchVariant,
        connectProvider: handleConnectSlash,
        switchOrg: handleOrgSlash,
        viewStatus: () => {
          setRoute({ name: "status" })
        },
        switchTheme: handleThemeSlash,
        showHelp,
        exitApp: () => void window.opencodex?.window("close"),
        openEditor: (context) => handleEditorSlash(session, context),
        openSkills: handleSkillsSlash,
        warpWorkspace: () => handleWarpSlash(session),
        openDiff: () => handleDiffSlash(session),
        shareSession: () => handleShareSlash(session),
        renameSession: () => session ? handleRenameSession(session) : undefined,
        openTimeline: () => handleTimelineSlash(session, options.data),
        forkSession: () => handleForkSlash(session, options.data),
        compactSession: () => handleCompactSlash(session, options.selectedModel),
        unshareSession: () => handleUnshareSlash(session),
        undoMessage: () => handleUndoSlash(session, options.data, options.restorePrompt),
        redoMessage: () => handleRedoSlash(session, options.data),
        toggleTimestamps: handleToggleTimestampsSlash,
        toggleThinking: handleToggleThinkingSlash,
        copyTranscript: () => handleCopyTranscriptSlash(session),
        exportTranscript: () => handleExportTranscriptSlash(session),
      },
    })
  }

  async function handlePermission(request: PermissionRequest, reply: "once" | "always" | "reject") {
    const gui = client()
    if (!gui) return
    await runPermissionAction({
      request,
      reply,
      sessions: snapshot()?.sessions ?? [],
      askText,
      confirm,
      replyPermission: (requestID, reply, message, directory) => replyPermission(gui, requestID, reply, message, directory).then(() => undefined),
      refresh,
    })
  }

  async function handleQuestionReply(request: QuestionRequest, answers: QuestionAnswer[]) {
    const gui = client()
    if (!gui) return
    await replyQuestion(gui, request.id, answers, sessionDirectoryForRequest(snapshot()?.sessions ?? [], request))
    await refresh()
  }

  async function handleQuestionReject(request: QuestionRequest) {
    const gui = client()
    if (!gui) return
    await rejectQuestion(gui, request.id, sessionDirectoryForRequest(snapshot()?.sessions ?? [], request))
    await refresh()
  }

  async function chooseFolder(fallback: string) {
    return window.opencodex?.folder(fallback || undefined)
  }

  async function handleCreateProject() {
    const gui = client()
    if (!gui) return
    await runCreateProjectAction({
      fallbackDirectory: gui.directory,
      chooseFolder,
      validateProjectFolders: (folders) => validateProjectFolders(gui, { folders }),
      createProject: (name, directory) => createProject(gui, { name, directory }).then(() => undefined),
      refresh,
      alert,
    })
  }

  async function handleRenameProject(projectID: string, current?: string) {
    const gui = client()
    if (!gui) return
    await runRenameProjectAction({
      projectID,
      current,
      askText,
      renameProject: (targetProjectID, name) => renameProject(gui, targetProjectID, name).then(() => undefined),
      refresh,
    })
  }

  async function handleEditProjectFolders(projectID: string, folders: string[]) {
    const gui = client()
    if (!gui) return
    await runEditProjectFoldersAction({
      projectID,
      folders,
      askText,
      validateProjectFolders: (targetProjectID, next) => validateProjectFolders(gui, { projectID: targetProjectID, folders: next }),
      updateProjectFolders: (targetProjectID, next) => updateProjectFolders(gui, targetProjectID, next).then(() => undefined),
      refresh,
      alert,
    })
  }

  async function handleEditProject(projectID: string, currentName: string, folders: string[]) {
    const gui = client()
    if (!gui) return
    await runEditProjectAction({
      projectID,
      currentName,
      folders,
      askText,
      validateProjectFolders: (targetProjectID, next) => validateProjectFolders(gui, { projectID: targetProjectID, folders: next }),
      updateProject: (targetProjectID, next) => updateProject(gui, targetProjectID, next).then(() => undefined),
      refresh,
      alert,
    })
  }

  async function handleDeleteProject(projectID: string, name: string) {
    const gui = client()
    if (!gui) return
    await runDeleteProjectAction({
      projectID,
      name,
      confirm,
      deleteProject: (targetProjectID) => deleteProject(gui, targetProjectID).then(() => undefined),
      refresh,
    })
  }

  async function handleCreateSession(projectID?: string, directory?: string) {
    const gui = client()
    if (!gui) return
    runCreateSessionRouteAction({
      projectID,
      directory,
      projects: snapshot()?.projects ?? [],
      guiDirectory: gui.directory,
      setPrompt,
      openNewSession: (targetProjectID, targetDirectory) => setRoute({ name: "new-session", projectID: targetProjectID, directory: targetDirectory }),
      focusComposer: () => requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus()),
    })
  }

  async function handleCreateSwarm() {
    const gui = client()
    const projects = snapshot()?.projects ?? []
    if (!gui) return
    await runCreateSwarmAction({
      projects,
      alert,
      chooseProjectID,
      createSwarm: (projectID, title, prompt) => createSwarm(gui, { projectID, title, prompt }).then(() => undefined),
      refresh,
      openSwarms: () => setRoute({ name: "swarms" }),
    })
  }

  async function handleCreateView() {
    const gui = client()
    const sessions = snapshot()?.sessions ?? []
    if (!gui) return
    await runCreateViewAction({
      sessions,
      alert,
      chooseSessionIDs,
      createView: (title, sessionIDs) => createView(gui, { title, sessionIDs }).then(() => undefined),
      refresh,
      openViews: () => setRoute({ name: "views" }),
    })
  }

  function handleMoveRailSection(section: RailSectionName, offset: number) {
    const sectionOrder = moveByOffset(railSectionOrder(), section, offset)
    if (sectionOrder.length === 0) return
    setRailSectionOrder(mergeOrderedIDs(DEFAULT_RAIL_SECTION_ORDER, sectionOrder))
  }

  function handleDropRailSection(targetID: string, placement: "before" | "after") {
    const source = dragTarget()
    const sectionOrder = droppedReorderIDs({
      ids: railSectionOrder(),
      source,
      sourceType: "section",
      targetID,
      placement,
    })
    if (sectionOrder.length === 0) {
      clearDragTarget()
      return
    }
    setRailSectionOrder(mergeOrderedIDs(DEFAULT_RAIL_SECTION_ORDER, sectionOrder))
    clearDragTarget()
  }

  function handleReorderRailSection(sourceID: RailSectionName, targetID: RailSectionName, placement: "before" | "after") {
    const sectionOrder = droppedReorderIDs({
      ids: railSectionOrder(),
      source: { type: "section", id: sourceID },
      sourceType: "section",
      targetID,
      placement,
    })
    if (sectionOrder.length === 0) {
      clearDragTarget()
      return
    }
    setRailSectionOrder(mergeOrderedIDs(DEFAULT_RAIL_SECTION_ORDER, sectionOrder))
    clearDragTarget()
  }

  async function handleMoveProject(projectID: string, offset: number) {
    const projectIDs = moveByOffset(projectOrderIDs(), projectID, offset)
    const gui = client()
    if (!gui || projectIDs.length === 0) return
    setProjectVisualOrder(projectIDs)
    await reorderProjects(gui, projectIDs)
    await refresh()
  }

  async function handleMoveView(viewID: string, offset: number) {
    const viewIDs = moveByOffset((snapshot()?.views ?? []).map((view) => view.id), viewID, offset)
    const gui = client()
    if (!gui || viewIDs.length === 0) return
    await reorderViews(gui, viewIDs)
    await refresh()
  }

  async function handleDropProject(targetID: string, placement: "before" | "after") {
    const source = dragTarget()
    const projectIDs = droppedReorderIDs({
      ids: projectOrderIDs(),
      source,
      sourceType: "project",
      targetID,
      placement,
    })
    const gui = client()
    if (!gui || projectIDs.length === 0) {
      clearDragTarget()
      return
    }
    setProjectVisualOrder(projectIDs)
    clearDragTarget()
    await reorderProjects(gui, projectIDs)
    await refresh()
  }

  async function handleReorderProject(sourceID: string, targetID: string, placement: "before" | "after") {
    const projectIDs = droppedReorderIDs({
      ids: projectOrderIDs(),
      source: { type: "project", id: sourceID },
      sourceType: "project",
      targetID,
      placement,
    })
    const gui = client()
    if (!gui || projectIDs.length === 0) {
      clearDragTarget()
      return
    }
    setProjectVisualOrder(projectIDs)
    clearDragTarget()
    await reorderProjects(gui, projectIDs)
    await refresh()
  }

  async function handleDropView(targetID: string, placement: "before" | "after") {
    const source = dragTarget()
    clearDragTarget()
    const viewIDs = droppedReorderIDs({
      ids: (snapshot()?.views ?? []).map((view) => view.id),
      source,
      sourceType: "view",
      targetID,
      placement,
    })
    const gui = client()
    if (!gui || viewIDs.length === 0) return
    await reorderViews(gui, viewIDs)
    await refresh()
  }

  async function chooseProjectID(projects: GuiSnapshot["projects"]) {
    if (projects.length === 1) return projects[0].id
    return askChoice({
      title: "Choose Project",
      message: "Choose a project to use.",
      options: projects.map((project) => ({
        value: project.id,
        title: title(project.name ?? project.project.name),
        description: project.folders.map((folder) => compactPath(folder.path)).join(", "),
      })),
    })
  }

  async function chooseSessionIDs(sessions: Session[]) {
    const options = sessions.slice(0, 20).map((session) => `${session.id} - ${title(session.title)}`).join("\n")
    const selected = await askText({ title: "Choose Sessions", message: `Comma-separated session IDs:\n${options}` })
    if (!selected) return []
    const available = new Set(sessions.map((session) => session.id))
    return selected
      .split(",")
      .map((id) => id.trim())
      .filter((id, index, all) => available.has(id) && all.indexOf(id) === index)
      .slice(0, 8)
  }

  async function handleCreateProjectSession() {
    const projects = snapshot()?.projects ?? []
    await runCreateProjectSessionAction({
      projects,
      alert,
      chooseProjectID,
      createSession: handleCreateSession,
    })
  }

  function startDrag(event: DragEvent, target: RailDragTarget) {
    setDragTarget(target)
    setDropTarget(undefined)
    event.dataTransfer?.setData("text/plain", target.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
  }

  function dragOver(event: DragEvent, target: RailDragTarget) {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
    const source = dragTarget()
    if (!source || source.type !== target.type || source.id === target.id) {
      setDropTarget(undefined)
      return
    }
    setDropTarget({ ...target, placement: dropPlacement(event) })
  }

  function projectPointerDrag(sourceID: string, targetID?: string, placement?: "before" | "after") {
    setDragTarget({ type: "project", id: sourceID })
    setDropTarget(targetID && placement ? { type: "project", id: targetID, placement } : undefined)
  }

  function sectionPointerDrag(sourceID: RailSectionName, targetID?: RailSectionName, placement?: "before" | "after") {
    setDragTarget({ type: "section", id: sourceID })
    setDropTarget(targetID && placement ? { type: "section", id: targetID, placement } : undefined)
  }

  function clearDragTarget() {
    setDragTarget(undefined)
    setDropTarget(undefined)
  }

  const paletteCommands = createMemo<PaletteCommand[]>(() =>
    buildPaletteCommands({
      visibleSessionCount: visibleSessions().length,
      currentRouteName: route().name,
      workspacePath: selectedSession()?.directory || client()?.directory,
      variantCount: selectedModelVariants(snapshot()?.providers ?? [], selectedModel()).length,
      actions: {
        switchSession: handleSwitchSession,
        createSession: () => handleCreateSession(),
        openRoute: (name) => setRoute({ name }),
        createProject: handleCreateProject,
        createProjectSession: handleCreateProjectSession,
        toggleRail: () => setRailCollapsed((prev) => !prev),
        focusSidebar: () => {
          setRailCollapsed(false)
          requestAnimationFrame(() => document.querySelector<HTMLElement>(".rail button")?.focus())
        },
        createSwarm: handleCreateSwarm,
        createView: handleCreateView,
        copyWorkspacePath,
        switchModel: handleSwitchModel,
        switchAgent: handleSwitchAgent,
        cycleVariant,
        switchVariant: handleSwitchVariant,
        showHelp,
        focusComposer,
        refresh,
        openDocs: () => { window.open("https://opencode.ai/docs", "_blank", "noopener,noreferrer") },
        exitApp: () => void window.opencodex?.window("close"),
      },
    }),
  )

  function renderViewPane(item: ViewItem) {
    const session = viewItemSession(item)
    return (
      <ViewPaneHost
        item={item}
        snapshot={snapshot()}
        data={viewSessionData()}
        emptyData={EMPTY_SESSION_DATA}
        loading={viewLoadingSessions()}
        focusedSessionID={activeViewFocusedSessionID()}
        composerFocusRequest={viewComposerFocusRequest()}
        providers={snapshot()?.providers ?? []}
        agents={snapshot()?.agents ?? []}
        recentModels={recentModels()}
        selectedAgent={viewAgentValue(session)}
        setSelectedAgent={(sessionID, value) => setViewAgents((current) => ({ ...current, [sessionID]: value }))}
        selectedModel={viewModelValue(session)}
        setSelectedModel={(sessionID, value) => {
          setViewModels((current) => ({ ...current, [sessionID]: value }))
          if (value) rememberModel(value)
        }}
        selectedVariant={viewVariantValue(session)}
        setSelectedVariant={(sessionID, value) => setViewVariants((current) => ({ ...current, [sessionID]: value }))}
        focus={(sessionID, focusComposer) => focusViewSession(sessionID, { focusComposer })}
        submit={(event, item, text) => void runAction(() => submitViewPrompt(event, item, text))}
        replyPermission={(request, reply) => void runAction(() => handlePermission(request, reply))}
        replyQuestion={(request, answers) => void runAction(() => handleQuestionReply(request, answers))}
        rejectQuestion={(request) => void runAction(() => handleQuestionReject(request))}
        abortSession={(sessionID) => void runAction(() => handleAbortSession(sessionID))}
        renameSession={(session) => void runAction(() => handleRenameSession(session))}
        moveSession={(session) => void runAction(() => handleMoveSession(session))}
        deleteSession={(session) => void runAction(() => handleDeleteSession(session))}
        slashCommands={sessionSlashCommands(session, {
          data: viewSessionData()[session.id] ?? EMPTY_SESSION_DATA,
          selectedAgent: viewAgentValue(session),
          selectedModel: viewModelValue(session),
          selectedVariant: viewVariantValue(session),
          switchModel: () => switchModelFor({
            setSelectedModel: (value) => setViewModels((current) => ({ ...current, [session.id]: value })),
            setSelectedVariant: (value) => setViewVariants((current) => ({ ...current, [session.id]: value })),
          }),
          switchAgent: () => switchAgentFor((value) => setViewAgents((current) => ({ ...current, [session.id]: value }))),
          switchVariant: () => switchVariantFor({
            selectedModel: viewModelValue(session),
            setSelectedVariant: (value) => setViewVariants((current) => ({ ...current, [session.id]: value })),
          }),
        })}
        showTimestamps={showTranscriptTimestamps()}
        showThinking={showTranscriptThinking()}
        messageWindow={VIEW_MESSAGE_WINDOW}
        loadOlderMessages={(sessionID, cursor) => runAction(() => loadOlderViewSessionMessages(sessionID, cursor))}
        reloadLatestMessages={(sessionID) => runAction(() => reloadLatestViewSessionMessages(sessionID))}
        onFollowBottomChange={(sessionID, value) => setSessionFollowingBottom(sessionID, value)}
      />
    )
  }

  return (
    <div class="app-shell" classList={{ "rail-collapsed": railCollapsed() }}>
      <Titlebar />
      <RailSidebar
        snapshot={snapshot()}
        sessions={visibleSessions()}
        pinnedSessions={pinnedSessions()}
        pinnedViews={pinnedViews()}
        navItems={NAV_ITEMS}
        activeRouteName={route().name}
        activeSessionID={activeSessionID()}
        activeViewID={activeView()?.id}
        railCollapsed={railCollapsed()}
        railSectionOrder={railSectionOrder()}
        railSections={railSections()}
        dragTarget={dragTarget()}
        dropTarget={dropTarget()}
        projectVisualOrder={projectVisualOrder()}
        projectSessions={(project) => projectSessions(project, snapshot())}
        projectExpanded={projectExpanded}
        sessionPinned={(sessionID) => pinnedSessionIDSet().has(sessionID)}
        viewPinned={(viewID) => pinnedViewIDSet().has(viewID)}
        toggleRail={() => setRailCollapsed((value) => !value)}
        toggleRailSection={toggleRailSection}
        toggleProject={toggleProject}
        openDashboard={() => setRoute({ name: "dashboard" })}
        openRoute={(name) => setRoute({ name })}
        openSession={openSession}
        openView={(viewID) => setRoute({ name: "views", viewID })}
        createProject={() => void runAction(handleCreateProject)}
        createSession={(projectID, directory) => void runAction(() => handleCreateSession(projectID, directory))}
        createView={() => void runAction(handleCreateView)}
        toggleSessionPinned={toggleSessionPinned}
        toggleViewPinned={toggleViewPinned}
        startDrag={startDrag}
        dragOver={dragOver}
        clearDragTarget={clearDragTarget}
        sectionPointerDrag={sectionPointerDrag}
        reorderRailSection={handleReorderRailSection}
        projectPointerDrag={projectPointerDrag}
        reorderProject={(sourceID, targetID, placement) => void runAction(() => handleReorderProject(sourceID, targetID, placement))}
        dropRailSection={handleDropRailSection}
        dropProject={(targetID, placement) => void runAction(() => handleDropProject(targetID, placement))}
        dropView={(targetID, placement) => void runAction(() => handleDropView(targetID, placement))}
        moveRailSection={handleMoveRailSection}
        moveProject={(projectID, offset) => void runAction(() => handleMoveProject(projectID, offset))}
        moveView={(viewID, offset) => void runAction(() => handleMoveView(viewID, offset))}
      />
      <main class="stage">
        <Show when={notice()}>
          <button class="notice" onClick={() => setNotice("")}>{notice()}</button>
        </Show>
        <Show when={loading()}>
          <div class="loading-card">{loading()}...</div>
        </Show>
        <Show when={error()}>
          <div class="error-card">{error()}</div>
        </Show>
        <Show when={!loading() && !error()}>
          <Switch>
            <Match when={route().name === "dashboard"}>
              <Dashboard
                snapshot={snapshot()}
                logo={<OpencodeXLogo />}
                openSession={(sessionID) => setRoute({ name: "session", sessionID })}
                openView={(viewID) => setRoute({ name: "views", viewID })}
                sessionPinned={(sessionID) => pinnedSessionIDSet().has(sessionID)}
                viewPinned={(viewID) => pinnedViewIDSet().has(viewID)}
                createProject={() => void runAction(handleCreateProject)}
                createSession={(projectID, directory) => void runAction(() => handleCreateSession(projectID, directory))}
                createSwarm={() => void runAction(handleCreateSwarm)}
                createView={() => void runAction(handleCreateView)}
                toggleSessionPinned={toggleSessionPinned}
                toggleViewPinned={toggleViewPinned}
                renameProject={(projectID, current) => void runAction(() => handleRenameProject(projectID, current))}
                editProjectFolders={(projectID, folders) => void runAction(() => handleEditProjectFolders(projectID, folders))}
                deleteProject={(projectID, name) => void runAction(() => handleDeleteProject(projectID, name))}
              />
            </Match>
            <Match when={route().name === "session" || route().name === "new-session"}>
              <Show when={activeSessionRouteKey()} keyed={true}>
                {(_key) => (
                  <SessionPage
                    session={selectedSession()}
                    data={activeSessionData()}
                    loading={activeSessionLoading()}
                    prompt={prompt()}
                    setPrompt={setPrompt}
                    providers={snapshot()?.providers ?? []}
                    agents={snapshot()?.agents ?? []}
                    selectedAgent={selectedAgent()}
                    setSelectedAgent={setSelectedAgent}
                    selectedModel={selectedModel()}
                    recentModels={recentModels()}
                    setSelectedModel={(value) => {
                      setSelectedModel(value)
                      setSelectedVariant("")
                      if (value) rememberModel(value)
                    }}
                    selectedVariant={selectedVariant()}
                    setSelectedVariant={setSelectedVariant}
                    submit={submitPrompt}
                    permissions={selectedPermissions()}
                    questions={selectedQuestions()}
                    replyPermission={(request, reply) => void runAction(() => handlePermission(request, reply))}
                    replyQuestion={(request, answers) => void runAction(() => handleQuestionReply(request, answers))}
                    rejectQuestion={(request) => void runAction(() => handleQuestionReject(request))}
                    abortSession={(sessionID) => void runAction(() => handleAbortSession(sessionID))}
                    renameSession={(session) => void runAction(() => handleRenameSession(session))}
                    moveSession={(session) => void runAction(() => handleMoveSession(session))}
                    deleteSession={(session) => void runAction(() => handleDeleteSession(session))}
                    slashCommands={sessionSlashCommands(selectedSession(), {
                      data: activeSessionData(),
                      restorePrompt: setPrompt,
                    })}
                    showTimestamps={showTranscriptTimestamps()}
                    showThinking={showTranscriptThinking()}
                    status={route().name === "session" && selectedSession() ? snapshot()?.sessionStatus[selectedSession()!.id]?.type : undefined}
                    pending={route().name === "new-session"}
                    messageWindow={SESSION_MESSAGE_WINDOW}
                    loadOlderMessages={(cursor) => selectedSession() ? runAction(() => loadOlderSessionMessages(selectedSession()!.id, cursor)) : Promise.resolve()}
                    reloadLatestMessages={() => selectedSession() ? runAction(() => reloadLatestSessionMessages(selectedSession()!.id)) : Promise.resolve()}
                    onFollowBottomChange={(sessionID, value) => setSessionFollowingBottom(sessionID, value)}
                  />
                )}
              </Show>
            </Match>
            <Match when={route().name === "sessions"}>
              <SessionCollectionPage sessions={tuiSidebarSessions(snapshot())} sessionStatus={snapshot()?.sessionStatus ?? {}} openSession={(sessionID) => setRoute({ name: "session", sessionID })} />
            </Match>
            <Match when={route().name === "projects"}>
              <ProjectCollectionPage
                projects={snapshot()?.projects ?? []}
                sessionCount={(project) => projectSessions(project, snapshot()).length}
                createSession={(projectID, directory) => void runAction(() => handleCreateSession(projectID, directory))}
                editProject={(projectID, currentName, folders) => void runAction(() => handleEditProject(projectID, currentName, folders))}
              />
            </Match>
            <Match when={route().name === "swarms"}>
              <CollectionPage title="Swarms" count={snapshot()?.swarms.length ?? 0} description="Create, run, cancel, and inspect orchestrated swarm work here while management tools are built out." />
            </Match>
            <Match when={route().name === "views"}>
              <Show
                when={activeView()}
                keyed={true}
                fallback={<CollectionPage title="Views" count={snapshot()?.views.length ?? 0} description="Create, edit, reorder, and inspect multi-session views here while management tools are built out." />}
              >
                {(view) => (
                  <ViewsPage
                    view={view}
                    items={activeViewItems()}
                    renderItem={renderViewPane}
                  />
                )}
              </Show>
            </Match>
            <Match when={route().name === "diff"}>
              {(() => {
                const current = route()
                const session = current.name === "diff"
                  ? snapshot()?.sessions.find((item) => item.id === current.sessionID) ?? selectedSession()
                  : selectedSession()
                const mode = current.name === "diff" ? current.mode ?? "git" : "git"
                return (
                  <DiffPage
                    mode={mode}
                    session={session}
                    sessions={visibleSessions()}
                    sessionUiState={snapshot()?.sessionUiState ?? {}}
                    setMode={(mode) => setRoute({ name: "diff", mode, sessionID: session?.id })}
                    selectSession={(sessionID) => setRoute({ name: "diff", mode: sessionID ? "last-turn" : "git", sessionID })}
                    close={() => session ? setRoute({ name: "session", sessionID: session.id }) : setRoute({ name: "dashboard" })}
                    loadDiff={loadDiffForPage}
                    updateReviewedFiles={updateDiffReviewedFiles}
                  />
                )
              })()}
            </Match>
            <Match when={route().name === "status"}>
              <StatusPage snapshot={snapshot()} />
            </Match>
            <Match when={route().name === "settings"}>
              <CollectionPage title="Settings" count={snapshot()?.agents.length ?? 0} description="Theme, provider, status, docs, debug, and safe GUI preferences are reserved here while settings parity is built out." />
            </Match>
          </Switch>
        </Show>
      </main>
      <CommandPaletteModal
        open={commandPaletteOpen()}
        commands={paletteCommands()}
        close={() => setCommandPaletteOpen(false)}
        run={(command) => {
          setCommandPaletteOpen(false)
          void runAction(async () => { await command.run() })
        }}
      />
      <DialogModal dialog={dialog()} close={() => setDialog(undefined)} />
    </div>
  )
}

function isTUISidebarSession(session: Session) {
  return !session.parentID && !isSwarmSession(session) && isRenderableSession(session)
}

function isSwarmSession(session: Session) {
  const opencodex = session.metadata?.opencodex
  return typeof opencodex === "object" && opencodex !== null && "swarmID" in opencodex && typeof opencodex.swarmID === "string"
}

function tuiSidebarSessions(snapshot?: GuiSnapshot) {
  return (snapshot?.sessions ?? []).filter(isTUISidebarSession).toSorted((a, b) => b.time.updated - a.time.updated)
}

function projectSessions(project: GuiSnapshot["projects"][number], snapshot?: GuiSnapshot) {
  const byID = new Map(tuiSidebarSessions(snapshot).map((session) => [session.id, session]))
  return project.sessions
    .filter(isTUISidebarSession)
    .map((session) => byID.get(session.id) ?? session)
    .filter(isTUISidebarSession)
    .toSorted((a, b) => b.time.updated - a.time.updated)
}

function sessionProjectName(session: Session, snapshot?: GuiSnapshot) {
  const project = (snapshot?.projects ?? []).find((item) => item.sessions.some((projectSession) => projectSession.id === session.id))
  if (!project) return
  return title(project.name ?? project.project.name)
}

function recentModelsFromSessions(sessions: Session[]) {
  return mergeRecentModels(
    sessions
      .filter((session) => session.model)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((session) => modelValue(session.model!.providerID, session.model!.id)),
  )
}

function mergeRecentModels(...groups: string[][]) {
  return Array.from(new Set(groups.flat().filter(Boolean))).slice(0, 10)
}

function readRecentModels() {
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem("opencodex.gui.recentModels")
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === "string").slice(0, 10)
  } catch {
    return []
  }
}

function writeRecentModels(values: string[]) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem("opencodex.gui.recentModels", JSON.stringify(values.slice(0, 10)))
  } catch {
    return
  }
}

function readThemeMode(): GuiThemeMode {
  if (typeof localStorage === "undefined") return "dark"
  return localStorage.getItem("opencodex.gui.theme") === "light" ? "light" : "dark"
}

type SidebarPreferences = {
  railCollapsed: boolean
  railSectionOrder: RailSectionName[]
  railSections: Record<RailSectionName, boolean>
  expandedProjectIDs: Record<string, boolean>
  pinnedSessionIDs: string[]
  pinnedViewIDs: string[]
}

function readSidebarPreferences(): SidebarPreferences {
  if (typeof localStorage === "undefined") return defaultSidebarPreferences()
  try {
    const raw = localStorage.getItem("opencodex.gui.sidebar")
    if (!raw) return defaultSidebarPreferences()
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return defaultSidebarPreferences()
    const input = parsed as Record<string, unknown>
    return {
      railCollapsed: typeof input.railCollapsed === "boolean" ? input.railCollapsed : false,
      railSectionOrder: mergeOrderedIDs(DEFAULT_RAIL_SECTION_ORDER, Array.isArray(input.railSectionOrder) ? input.railSectionOrder.filter((value): value is string => typeof value === "string") : []),
      railSections: readRailSections(input.railSections),
      expandedProjectIDs: readBooleanMap(input.expandedProjectIDs),
      pinnedSessionIDs: readStringList(input.pinnedSessionIDs),
      pinnedViewIDs: readStringList(input.pinnedViewIDs),
    }
  } catch {
    return defaultSidebarPreferences()
  }
}

function writeSidebarPreferences(value: SidebarPreferences) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem("opencodex.gui.sidebar", JSON.stringify(value))
  } catch {
    return
  }
}

function defaultSidebarPreferences(): SidebarPreferences {
  return {
    railCollapsed: false,
    railSectionOrder: DEFAULT_RAIL_SECTION_ORDER,
    railSections: DEFAULT_RAIL_SECTIONS,
    expandedProjectIDs: {},
    pinnedSessionIDs: [],
    pinnedViewIDs: [],
  }
}

function readRailSections(value: unknown): Record<RailSectionName, boolean> {
  if (typeof value !== "object" || value === null) return DEFAULT_RAIL_SECTIONS
  const input = value as Record<string, unknown>
  return {
    pinned: typeof input.pinned === "boolean" ? input.pinned : DEFAULT_RAIL_SECTIONS.pinned,
    projects: typeof input.projects === "boolean" ? input.projects : DEFAULT_RAIL_SECTIONS.projects,
    recent: typeof input.recent === "boolean" ? input.recent : DEFAULT_RAIL_SECTIONS.recent,
    views: typeof input.views === "boolean" ? input.views : DEFAULT_RAIL_SECTIONS.views,
  }
}

function readBooleanMap(value: unknown): Record<string, boolean> {
  if (typeof value !== "object" || value === null) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"))
}

function readStringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string")))
}

function dropPlacement(event: DragEvent): "before" | "after" {
  const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : undefined
  if (!rect) return "before"
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before"
}

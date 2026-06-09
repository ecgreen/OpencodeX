import type { GlobalEvent, OpencodeXSessionState, OpencodeXView, PermissionRequest, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { CLIENT_SESSION_SYNC_INTERVAL_MS } from "@opencode-ai/sdk/v2/client-sync"
import type { GuiClient } from "./lib/client"
import type { GuiSnapshot, SessionData } from "./lib/store"
import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
import { OpencodeXLogo, Titlebar } from "./components/chrome"
import { CollectionPage, ProjectCollectionPage, SessionCollectionPage, StatusPage } from "./components/collection-pages"
import { CommandPaletteModal, type PaletteCommand } from "./components/command-palette"
import { Dashboard } from "./components/dashboard"
import { DialogModal, type ChoiceOption, type DialogState } from "./components/dialog-modal"
import { RailSidebar, type RailDragTarget, type RailSectionName } from "./components/rail-sidebar"
import { SessionPage } from "./components/session-page"
import { ViewPaneHost } from "./components/view-pane-host"
import { ViewsPage } from "./components/views"
import { connectGuiClient } from "./lib/client"
import { runCreateProjectSessionAction, runCreateSwarmAction, runCreateViewAction } from "./lib/creation-actions"
import { compactPath, formatRelative, title } from "./lib/format"
import { guiShortcutAction, isKeyboardEditingTarget, runGuiShortcutAction } from "./lib/keyboard-shortcuts"
import { prependOlderMessages, trimToLiveTail, type MessageWindow } from "./lib/message-window"
import { runCycleVariantAction, runSwitchAgentAction, runSwitchModelAction, runSwitchVariantAction } from "./lib/model-actions"
import { firstAvailableModel, modelValue, selectedModelVariants, sessionModelDefaults } from "./lib/model-selection"
import { buildPaletteCommands } from "./lib/palette-commands"
import { runCreateProjectAction, runCreateSessionRouteAction, runDeleteProjectAction, runEditProjectFoldersAction, runRenameProjectAction } from "./lib/project-actions"
import { droppedReorderIDs, moveByOffset } from "./lib/reorder"
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
import { syncViewSessionsInParallel, viewSessionsInOrder } from "./lib/view-sync"
import { runViewPromptAction } from "./lib/view-prompt"
import { runSessionPromptAction } from "./lib/session-prompt"
import {
  abortSession,
  createProject,
  createSession,
  createSwarm,
  createView,
  deleteProject,
  deleteSession,
  loadSession,
  loadSessionCards,
  loadSessionMessages,
  loadSnapshot,
  moveSession,
  rejectQuestion,
  renameProject,
  renameSession,
  reorderProjects,
  reorderViews,
  replyPermission,
  replyQuestion,
  sendPrompt,
  subscribeEvents,
  updateSessionUiState,
  updateView,
  updateProjectFolders,
  updateViewFocus,
  validateProjectFolders,
  isRenderableSession,
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
  | { name: "settings" }
  | { name: "status" }

const NAV_ITEMS = [
  { name: "dashboard", label: "Dashboard", icon: "dashboard", shortcut: "Ctrl+D", description: "Workspace command center" },
  { name: "sessions", label: "Sessions", icon: "session", shortcut: "Ctrl+1", description: "Resume and monitor agent sessions" },
  { name: "projects", label: "Projects", icon: "folder", shortcut: "Ctrl+2", description: "Project groups and folders" },
  { name: "views", label: "Views", icon: "views", shortcut: "Ctrl+4", description: "Multi-session views" },
  { name: "swarms", label: "Swarms", icon: "swarm", shortcut: "Ctrl+3", description: "Coordinate AI team runs" },
  { name: "status", label: "Status", icon: "activity", shortcut: "Ctrl+5", description: "Provider and runtime health" },
  { name: "settings", label: "Settings", icon: "settings", shortcut: "Ctrl+6", description: "Preferences and provider setup" },
] as const

const EMPTY_SESSION_DATA: SessionData = { messages: [], todos: [], diffs: [] }
const SESSION_MESSAGE_PAGE_LIMIT = 128
const VIEW_MESSAGE_PAGE_LIMIT = 48
const SESSION_MESSAGE_WINDOW: MessageWindow = { count: 128, budget: 100_000 }
const VIEW_MESSAGE_WINDOW: MessageWindow = { count: 48, budget: 28_000 }
const LIVE_SYNC_INTERVAL_MS = CLIENT_SESSION_SYNC_INTERVAL_MS
const SNAPSHOT_SYNC_INTERVAL_MS = 5_000
const SEEN_EVENT_ID_LIMIT = 2_000
export function App() {
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
  const [notice, setNotice] = createSignal("")
  const [dialog, setDialog] = createSignal<DialogState>()
  const [commandPaletteOpen, setCommandPaletteOpen] = createSignal(false)
  const [railCollapsed, setRailCollapsed] = createSignal(false)
  const [loadingSessionID, setLoadingSessionID] = createSignal("")
  const [railSections, setRailSections] = createSignal<Record<RailSectionName, boolean>>({ projects: false, recent: false, swarms: false, views: true })
  const [expandedProjectIDs, setExpandedProjectIDs] = createSignal<Record<string, boolean>>({})
  const [viewAgents, setViewAgents] = createSignal<Record<string, string>>({})
  const [viewModels, setViewModels] = createSignal<Record<string, string>>({})
  const [viewVariants, setViewVariants] = createSignal<Record<string, string>>({})
  const [focusedViewSessionID, setFocusedViewSessionID] = createSignal("")
  const [viewComposerFocusRequest, setViewComposerFocusRequest] = createSignal({ sessionID: "", token: 0 })
  const [recentModels, setRecentModels] = createSignal(readRecentModels())
  const [dragTarget, setDragTarget] = createSignal<RailDragTarget>()
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
    const page = await loadSessionMessages(gui, sessionID, session?.directory, { limit: SESSION_MESSAGE_PAGE_LIMIT, renderBudget: SESSION_MESSAGE_WINDOW.budget, before })
    setSessionData((data) => sessionDataSessionID() === sessionID ? prependOlderMessages(data, page) : data)
  }

  async function loadOlderViewSessionMessages(sessionID: string, before: string) {
    const gui = client()
    if (!gui) return
    const session = snapshot()?.sessions.find((item) => item.id === sessionID)
    if (!session) return
    const page = await loadSessionMessages(gui, sessionID, session.directory, { limit: VIEW_MESSAGE_PAGE_LIMIT, renderBudget: VIEW_MESSAGE_WINDOW.budget, before })
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

  function toggleProject(projectID: string) {
    setExpandedProjectIDs((current) => ({ ...current, [projectID]: !projectExpanded(projectID) }))
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
    await runSwitchModelAction({
      providers: snapshot()?.providers ?? [],
      alert,
      askChoice,
      setSelectedModel,
      setSelectedVariant,
      rememberModel,
    })
  }

  async function handleSwitchAgent() {
    await runSwitchAgentAction({
      agents: snapshot()?.agents ?? [],
      alert,
      askChoice,
      setSelectedAgent,
    })
  }

  async function handleSwitchVariant() {
    await runSwitchVariantAction({
      providers: snapshot()?.providers ?? [],
      selectedModel: selectedModel(),
      alert,
      askChoice,
      setSelectedVariant,
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
      "Ctrl+D and Ctrl+1-6 navigate sections.",
    ].join("\n"))
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

  async function handleMoveProject(projectID: string, offset: number) {
    const projectIDs = moveByOffset((snapshot()?.projects ?? []).map((project) => project.id), projectID, offset)
    const gui = client()
    if (!gui || projectIDs.length === 0) return
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
    setDragTarget(undefined)
    const projectIDs = droppedReorderIDs({
      ids: (snapshot()?.projects ?? []).map((project) => project.id),
      source,
      sourceType: "project",
      targetID,
      placement,
    })
    const gui = client()
    if (!gui || projectIDs.length === 0) return
    await reorderProjects(gui, projectIDs)
    await refresh()
  }

  async function handleDropView(targetID: string, placement: "before" | "after") {
    const source = dragTarget()
    setDragTarget(undefined)
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
    const options = projects.map((project) => `${project.id} - ${title(project.name ?? project.project.name)}`).join("\n")
    const selected = (await askText({ title: "Choose Project", message: options, value: projects[0].id }))?.trim()
    return projects.some((project) => project.id === selected) ? selected : undefined
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
    event.dataTransfer?.setData("text/plain", target.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
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
        navItems={NAV_ITEMS}
        activeRouteName={route().name}
        activeSessionID={activeSessionID()}
        activeViewID={activeView()?.id}
        railCollapsed={railCollapsed()}
        railSections={railSections()}
        dragTarget={dragTarget()}
        projectSessions={(project) => projectSessions(project, snapshot())}
        projectExpanded={projectExpanded}
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
        startDrag={startDrag}
        clearDragTarget={() => setDragTarget(undefined)}
        dropProject={(targetID, placement) => void runAction(() => handleDropProject(targetID, placement))}
        dropView={(targetID, placement) => void runAction(() => handleDropView(targetID, placement))}
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
                createProject={() => void runAction(handleCreateProject)}
                createSession={(projectID, directory) => void runAction(() => handleCreateSession(projectID, directory))}
                createSwarm={() => void runAction(handleCreateSwarm)}
                createView={() => void runAction(handleCreateView)}
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
              <ProjectCollectionPage projects={snapshot()?.projects ?? []} sessionCount={(project) => projectSessions(project, snapshot()).length} createSession={(projectID, directory) => void runAction(() => handleCreateSession(projectID, directory))} />
            </Match>
            <Match when={route().name === "swarms"}>
              <CollectionPage title="Swarms" count={snapshot()?.swarms.length ?? 0} description="Create, run, cancel, and inspect orchestrated swarm work through existing OpencodeX endpoints." />
            </Match>
            <Match when={route().name === "views"}>
              <ViewsPage
                view={activeView()}
                items={activeViewItems()}
                renderItem={renderViewPane}
              />
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

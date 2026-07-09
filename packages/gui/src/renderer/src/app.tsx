import type {
  GlobalEvent,
  OpencodeXSessionState,
  OpencodeXSwarmRoleInput,
  OpencodeXView,
  PermissionRequest,
  ProviderAuthMethod,
  QuestionAnswer,
  QuestionRequest,
  Session,
} from "@opencode-ai/sdk/v2/client"
import {
  CLIENT_SESSION_SYNC_INTERVAL_MS,
  createClientStateSync,
  selectClientStateSyncSnapshot,
  type ClientStateSyncState,
} from "@opencode-ai/sdk/v2/client-sync"
import type { GuiClient } from "./lib/client"
import type { GuiSnapshot, MessageBundle, SessionData, SessionLoadOptions } from "./lib/store"
import {
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
  type Accessor,
} from "solid-js"
import { OpencodeXLogo, Titlebar } from "./components/chrome"
import { CollectionPage, ProjectCollectionPage, SessionCollectionPage, StatusPage } from "./components/collection-pages"
import { CommandPaletteModal, type PaletteCommand } from "./components/command-palette"
import { Dashboard } from "./components/dashboard"
import { DashboardSection } from "./components/dashboard-primitives"
import { DiffPage, type DiffMode } from "./components/diff-page"
import { KeyboardHelpModal } from "./components/keyboard-help"
import { DialogModal, type ChoiceOption, type DialogState, type ProjectDialogValue } from "./components/dialog-modal"
import { PluginsPage } from "./components/plugins-page"
import { RailSidebar, type RailDragTarget, type RailDropTarget, type RailSectionName } from "./components/rail-sidebar"
import { SessionPage } from "./components/session-page"
import {
  SessionSidePanel,
  type SessionSidePanelContextOption,
  type SessionSidePanelRequest,
  type SessionSidePanelTarget,
} from "./components/session-side-panel"
import { SwarmEditorPage, SwarmsPage } from "./components/swarms-page"
import { ViewPaneHost } from "./components/view-pane-host"
import { ViewEditorPage, ViewsManagerPage } from "./components/views-manager-page"
import { WorkbenchPage } from "./components/workbench-page"
import { connectGuiClient } from "./lib/client"
import {
  readBoolPreference,
  readRecentModels,
  readThemeMode,
  writeBoolPreference,
  writeRecentModels,
  type GuiThemeMode,
} from "./lib/app-preferences"
import {
  emptySessionOrderState,
  mergeRecentModels,
  projectSessions,
  reconcileSessionOrderState,
  recentModelsFromSessions,
  tuiSidebarSessions,
} from "./lib/app-session-lists"
import { runCreateProjectSessionAction } from "./lib/creation-actions"
import { compactPath, formatRelative, title } from "./lib/format"
import {
  guiPluginCommands,
  guiPluginThemeCss,
  installGuiPlugin as installDeclarativeGuiPlugin,
  readInstalledGuiPlugins,
  type GuiPluginManifest,
  type InstalledGuiPlugin,
  writeInstalledGuiPlugins,
} from "./lib/gui-plugins"
import { guiShortcutAction, isKeyboardEditingTarget, runGuiShortcutAction } from "./lib/keyboard-shortcuts"
import { prependOlderMessages, trimToLiveTail, type MessageWindow } from "./lib/message-window"
import {
  runCycleVariantAction,
  runSwitchAgentAction,
  runSwitchModelAction,
  runSwitchVariantAction,
} from "./lib/model-actions"
import {
  firstAvailableModel,
  modelValue,
  parseModelValue,
  selectedModelVariants,
  sessionModelDefaults,
} from "./lib/model-selection"
import { buildPaletteCommands } from "./lib/palette-commands"
import { restorePromptPartsFromEditedText } from "./lib/prompt-autocomplete"
import type { GuiPromptInfo } from "./lib/prompt-state"
import {
  runCreateProjectAction,
  runCreateSessionRouteAction,
  runDeleteProjectAction,
  runEditProjectAction,
} from "./lib/project-actions"
import { droppedReorderIDs, mergeOrderedIDs, moveByOffset } from "./lib/reorder"
import {
  activeProjectForRoute,
  activeSessionIDForRoute,
  activeSessionRouteKey,
  activeViewForRoute,
  focusedViewItemID,
  selectedSessionForRoute,
} from "./lib/route-selection"
import {
  globalEventAction,
  globalEventID,
  applySessionStateSnapshot,
  applySessionStatusSnapshot,
  isSnapshotPatchEvent,
  mergeLiveSessionData,
  mergeSessionCardSnapshot,
  mergeSnapshot,
  patchSelectedSessionData,
  patchSnapshot,
  patchVisibleViewSessionData,
  runGlobalEventAction,
  sessionDataEventTargets,
} from "./lib/live-session-patch"
import { markSessionSeenInSnapshot, markSessionViewedInSnapshot } from "./lib/session-status"
import { opencodeXSwarmExecutionMode } from "./lib/swarm-actions"
import {
  runSelectedSessionSync,
  shouldShowSelectedSessionLoading,
  shouldShowViewSessionLoading,
  shouldSkipViewSessionSync,
  viewSessionLoadKey,
} from "./lib/session-sync"
import { runMoveSessionAction, runPermissionAction, sessionDirectoryForRequest } from "./lib/session-actions"
import { liveServerSyncPlan, visibleSessionSyncTarget } from "./lib/live-sync"
import {
  buildSessionSlashCommands,
  type SessionSlashCommand,
  type SessionSlashCommandContext,
} from "./lib/session-slash-commands"
import {
  DEFAULT_RAIL_SECTION_ORDER,
  dropPlacement,
  readSidebarPreferences,
  writeSidebarPreferences,
} from "./lib/sidebar-preferences"
import { syncViewSessionsInParallel, viewSessionsInOrder } from "./lib/view-sync"
import { runViewPromptAction } from "./lib/view-prompt"
import { runSessionPromptAction } from "./lib/session-prompt"
import { workbenchPromptTarget } from "./lib/workbench"
import { formatSessionTranscript } from "./lib/transcript"
import {
  defaultTranscriptExportOptions,
  prepareSessionTranscriptExport,
  type GuiTranscriptExportOptions,
} from "./lib/transcript-export"
import {
  EMPTY_VIEW_PANE_RUNTIME_STATE,
  pruneRecordKeys,
  setRecordEntry,
  updateViewPaneRuntimeState,
  type ViewPaneRuntimeState,
} from "./lib/view-pane-state"
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
  cancelSwarm,
  deleteSwarm,
  deleteView,
  deleteProject,
  deleteSession,
  disconnectMcp,
  disposeInstance,
  forkSession,
  findFiles,
  installPlugin,
  isRenderableSession,
  listConsoleOrgs,
  listMcpStatus,
  listProviderAuthMethods,
  listProviders,
  listPlugins,
  listSkills,
  loadClientStateSession,
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
  renameSession,
  reorderProjects,
  reorderViews,
  replyPermission,
  replyQuestion,
  runShellCommand,
  runSessionCommand,
  sendPrompt,
  setProviderApiAuth,
  shareSession,
  summarizeSession,
  subscribeEvents,
  sessionDataFromClientState,
  switchConsoleOrg,
  syncWorkspaces,
  togglePlugin,
  unrevertSession,
  unshareSession,
  updateSessionUiState,
  updateSwarm,
  updateView,
  updateProject,
  updateViewFocus,
  validateProjectFolders,
  revertSession,
  warpSessionWorkspace,
  workspaceStatus,
} from "./lib/store"
import {
  pendingViewSessions,
  viewItemID,
  viewItemSession,
  viewItemsMembershipKey,
  viewSessionsSyncKey,
  type ViewItem,
} from "./lib/view-items"

type Route =
  | { name: "dashboard" }
  | { name: "sessions" }
  | { name: "new-session"; projectID?: string; directory?: string }
  | { name: "projects"; projectID?: string }
  | { name: "session"; sessionID: string }
  | { name: "swarms"; swarmID?: string }
  | { name: "swarm-create"; swarmID?: string; projectID?: string }
  | { name: "views"; viewID?: string }
  | { name: "view-edit"; viewID?: string }
  | { name: "plugins" }
  | { name: "workbench"; projectID?: string }
  | { name: "diff"; mode?: DiffMode; sessionID?: string }
  | { name: "settings" }
  | { name: "status" }

const NAV_ITEMS = [
  {
    name: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    shortcut: "Ctrl+D",
    description: "Workspace command center",
  },
  {
    name: "projects",
    label: "Projects",
    icon: "folder",
    shortcut: "Ctrl+1",
    description: "Manage project groups and folders",
  },
  {
    name: "swarms",
    label: "Swarms",
    icon: "swarm",
    shortcut: "Ctrl+2",
    description: "Create, manage, and run agent swarms",
  },
  {
    name: "views",
    label: "Views",
    icon: "views",
    shortcut: "Ctrl+3",
    description: "Create and manage multi-session views",
  },
  {
    name: "plugins",
    label: "Plugins",
    icon: "settings",
    shortcut: "Ctrl+4",
    description: "Install and manage plugins",
  },
  {
    name: "workbench",
    label: "Workbench",
    icon: "browser",
    shortcut: "Ctrl+5",
    description: "Files, GitHub, Git, browser, and artifacts",
  },
] as const

const EMPTY_SESSION_DATA: SessionData = { messages: [], todos: [], diffs: [] }
const SESSION_MESSAGE_PAGE_LIMIT = 128
const VIEW_MESSAGE_PAGE_LIMIT = 48
const LOAD_MORE_MESSAGE_MULTIPLIER = 3
const SESSION_MESSAGE_WINDOW: MessageWindow = { count: 128, budget: 100_000 }
const VIEW_MESSAGE_WINDOW: MessageWindow = { count: 48, budget: 28_000 }
const LIVE_SYNC_INTERVAL_MS = CLIENT_SESSION_SYNC_INTERVAL_MS
const SNAPSHOT_SYNC_INTERVAL_MS = 5_000
const SESSION_VIEWED_MARK_DELAY_MS = 2_000
const SEEN_EVENT_ID_LIMIT = 2_000
const CUSTOM_PROVIDER_OPTION = "__custom_provider__"
const CUSTOM_PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
export function App() {
  const sidebarPreferences = readSidebarPreferences()
  const [client, setClient] = createSignal<GuiClient>()
  const [snapshot, setSnapshot] = createSignal<GuiSnapshot>()
  const [route, setRouteValue] = createSignal<Route>({ name: "dashboard" })
  const [sessionOrderState, setSessionOrderState] = createSignal(emptySessionOrderState())
  const [sessionData, setSessionData] = createSignal<SessionData>(EMPTY_SESSION_DATA)
  const [selectedSessionDataCache, setSelectedSessionDataCache] = createSignal<
    Record<string, { data: SessionData; loadedTime: number }>
  >({})
  const [viewSessionData, setViewSessionData] = createSignal<Record<string, SessionData>>({})
  const [viewPaneStates, setViewPaneStates] = createSignal<Record<string, ViewPaneRuntimeState>>({})
  const [sessionDataSessionID, setSessionDataSessionID] = createSignal("")
  const [loading, setLoading] = createSignal("Starting sidecar")
  const [error, setError] = createSignal<string>()
  const [prompt, setPrompt] = createSignal("")
  const [selectionSessionID, setSelectionSessionID] = createSignal("")
  const [selectedAgent, setSelectedAgent] = createSignal("")
  const [selectedModel, setSelectedModel] = createSignal("")
  const [selectedVariant, setSelectedVariant] = createSignal("")
  const [themeMode, setThemeMode] = createSignal<GuiThemeMode>(readThemeMode())
  const [concealTranscriptCodeBlocks, setConcealTranscriptCodeBlocks] = createSignal(
    readBoolPreference("opencodex.gui.transcript.concealCode", true),
  )
  const [showTranscriptTimestamps, setShowTranscriptTimestamps] = createSignal(
    readBoolPreference("opencodex.gui.transcript.timestamps", false),
  )
  const [showTranscriptThinking, setShowTranscriptThinking] = createSignal(
    readBoolPreference("opencodex.gui.transcript.thinking", true),
  )
  const [showTranscriptToolDetails, setShowTranscriptToolDetails] = createSignal(
    readBoolPreference("opencodex.gui.transcript.toolDetails", true),
  )
  const [showTranscriptScrollbar, setShowTranscriptScrollbar] = createSignal(
    readBoolPreference("opencodex.gui.transcript.scrollbar", true),
  )
  const [showTranscriptGenericToolOutput, setShowTranscriptGenericToolOutput] = createSignal(
    readBoolPreference("opencodex.gui.transcript.genericToolOutput", true),
  )
  const [dialog, setDialog] = createSignal<DialogState>()
  const [commandPaletteOpen, setCommandPaletteOpen] = createSignal(false)
  const [keyboardHelpOpen, setKeyboardHelpOpen] = createSignal(false)
  const [railCollapsed, setRailCollapsed] = createSignal(sidebarPreferences.railCollapsed)
  const [loadingSessionID, setLoadingSessionID] = createSignal("")
  const [railSectionOrder, setRailSectionOrder] = createSignal<RailSectionName[]>(sidebarPreferences.railSectionOrder)
  const [railSections, setRailSections] = createSignal<Record<RailSectionName, boolean>>(
    sidebarPreferences.railSections,
  )
  const [expandedProjectIDs, setExpandedProjectIDs] = createSignal<Record<string, boolean>>(
    sidebarPreferences.expandedProjectIDs,
  )
  const [pinnedSessionIDs, setPinnedSessionIDs] = createSignal(sidebarPreferences.pinnedSessionIDs)
  const [pinnedViewIDs, setPinnedViewIDs] = createSignal(sidebarPreferences.pinnedViewIDs)
  const [pendingPinnedSessionRouteKey, setPendingPinnedSessionRouteKey] = createSignal("")
  const [materializingSession, setMaterializingSession] = createSignal<Session>()
  const [materializingSessionID, setMaterializingSessionID] = createSignal("")
  const [guiPlugins, setGuiPlugins] = createSignal<InstalledGuiPlugin[]>(readInstalledGuiPlugins())
  const [focusedViewSessionID, setFocusedViewSessionID] = createSignal("")
  const [viewComposerFocusRequest, setViewComposerFocusRequest] = createSignal({ sessionID: "", token: 0 })
  const [viewSidePanelOpenByViewID, setViewSidePanelOpenByViewID] = createSignal<Record<string, boolean>>({})
  const [viewSidePanelWidthRatio, setViewSidePanelWidthRatio] = createSignal(0.4)
  const [viewSidePanelSessionID, setViewSidePanelSessionID] = createSignal("")
  const [viewSidePanelRequest, setViewSidePanelRequest] = createSignal<SessionSidePanelRequest>()
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
  const appliedSessionDigests = new Map<string, string>()
  const seenEventIDs = new Set<string>()
  const seenEventIDOrder: string[] = []
  const routeHistory: Route[] = [{ name: "dashboard" }]
  const [routeHistoryIndex, setRouteHistoryIndex] = createSignal(0)
  let liveSyncRunning = false
  let lastSnapshotSync = 0
  let stateSync: ReturnType<typeof createClientStateSync> | undefined

  function setRoute(next: Route) {
    const current = route()
    if (JSON.stringify(current) === JSON.stringify(next)) return
    routeHistory.splice(routeHistoryIndex() + 1)
    routeHistory.push(next)
    setRouteHistoryIndex(routeHistory.length - 1)
    setRouteValue(next)
  }

  function goRouteHistory(offset: -1 | 1) {
    const nextIndex = routeHistoryIndex() + offset
    const next = routeHistory[nextIndex]
    if (!next) return
    setRouteHistoryIndex(nextIndex)
    setRouteValue(next)
  }

  const selectedSession = createMemo(() => {
    const current = route()
    const materializing = materializingSession()
    if (current.name === "new-session" && materializing) return materializing
    if (current.name === "session" && current.sessionID === materializing?.id) return materializing
    const selected = selectedSessionForRoute(current, snapshot(), client()?.directory)
    if (selected) return selected
  })
  const activeSessionID = createMemo(() => {
    const current = route()
    const materializing = materializingSessionID()
    if (current.name === "new-session" && materializing) return materializing
    return activeSessionIDForRoute(current)
  })
  const activeSessionProjectName = createMemo(() => {
    const current = route()
    if (current.name === "new-session") return projectNameForProjectID(current.projectID)
    return projectNameForSession(selectedSession())
  })
  const activeSessionCache = createMemo(() => {
    const sessionID = activeSessionID()
    return sessionID ? selectedSessionDataCache()[sessionID] : undefined
  })
  const activeSessionData = createMemo(() => {
    const sessionID = activeSessionID()
    if (!sessionID) return EMPTY_SESSION_DATA
    return sessionDataSessionID() === sessionID ? sessionData() : (activeSessionCache()?.data ?? EMPTY_SESSION_DATA)
  })
  const activeSessionLoading = createMemo(() =>
    shouldShowSelectedSessionLoading({
      sessionID: selectedSession() ? activeSessionID() : undefined,
      materializingSessionID: materializingSessionID(),
      loadedSessionID: sessionDataSessionID(),
      cachedData: activeSessionCache()?.data,
    }),
  )
  const activeProject = createMemo(() => activeProjectForRoute(route(), snapshot()?.projects ?? []))
  const activeView = createMemo(() => activeViewForRoute(route(), snapshot()?.views ?? []))
  const viewSidePanelOpen = createMemo(() => {
    const id = activeView()?.id
    return id ? (viewSidePanelOpenByViewID()[id] ?? false) : false
  })
  const editingView = createMemo(() => {
    const current = route()
    if (current.name !== "view-edit" || !current.viewID) return
    return snapshot()?.views.find((view) => view.id === current.viewID)
  })
  const activeViewSessions = createMemo(() => {
    return viewSessionsInOrder(activeView()).slice(0, 8)
  })
  const activeViewItems = createMemo<ViewItem[]>(() =>
    [
    ...activeViewSessions().map((session): ViewItem => ({ kind: "session", session })),
    ...pendingViewSessions(activeView()).map((slot): ViewItem => ({ kind: "pending", slot })),
    ].slice(0, 8),
  )
  const activeViewLoadKey = createMemo(() => {
    const view = activeView()
    return viewSessionsSyncKey(view?.id, activeViewSessions())
  })
  const activeViewMembershipKey = createMemo(() => {
    const view = activeView()
    return viewItemsMembershipKey(view?.id, activeViewItems())
  })
  const activeViewFocusedSessionID = createMemo(() =>
    focusedViewItemID({
      localID: focusedViewSessionID(),
      persistedID: activeView()?.focusedSessionID,
      items: activeViewItems(),
    }),
  )
  const viewSidePanelContextOptions = createMemo<SessionSidePanelContextOption[]>(() =>
    activeViewSessions().map((session) => ({
      id: session.id,
      label: title(session.title),
      description: compactPath(session.directory),
    })),
  )
  const viewSidePanelSession = createMemo(() => {
    const sessions = activeViewSessions()
    if (sessions.length === 0) return
    return (
      sessions.find((session) => session.id === viewSidePanelSessionID()) ??
      sessions.find((session) => session.id === activeViewFocusedSessionID()) ??
      sessions[0]
    )
  })
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
  createEffect(() => {
    const current = snapshot()
    setSessionOrderState((state) => reconcileSessionOrderState(state, current))
  })

  const visibleSessions = createMemo(() => tuiSidebarSessions(snapshot(), sessionOrderState()))
  const pinnedSessionIDSet = createMemo(() => new Set(pinnedSessionIDs()))
  const pinnedViewIDSet = createMemo(() => new Set(pinnedViewIDs()))
  const pinnedSessions = createMemo(() => {
    const byID = new Map(visibleSessions().map((session) => [session.id, session]))
    return pinnedSessionIDs()
      .map((id) => byID.get(id))
      .filter((session): session is Session => session !== undefined)
  })
  const pinnedViews = createMemo(() => {
    const byID = new Map((snapshot()?.views ?? []).map((view) => [view.id, view]))
    return pinnedViewIDs()
      .map((id) => byID.get(id))
      .filter((view): view is OpencodeXView => view !== undefined)
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
    const current = route()
    const materializing = materializingSessionID()
    if (!materializing) return
    if (current.name !== "new-session" && !(current.name === "session" && current.sessionID === materializing)) {
      setMaterializingSession(undefined)
      setMaterializingSessionID("")
      return
    }
    if (current.name === "session" && (snapshot()?.sessions ?? []).some((session) => session.id === materializing)) {
      setMaterializingSession(undefined)
      setMaterializingSessionID("")
    }
  })

  createEffect(() => {
    const visualOrder = projectVisualOrder()
    if (visualOrder.length === 0) return
    if ((snapshot()?.projects ?? []).map((project) => project.id).join("\n") === visualOrder.join("\n"))
      setProjectVisualOrder([])
  })

  async function refresh() {
    const gui = client()
    if (!gui) return
    const next = await loadSnapshot(gui)
    setSnapshot((current) => (current ? mergeSnapshot(current, next) : next))
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
    setSnapshot((current) => (current ? mergeSessionCardSnapshot(current, next) : current))
    const models = mergeRecentModels(recentModelsFromSessions(next.sessions), recentModels())
    if (models.join("\n") === recentModels().join("\n")) return
    setRecentModels(models)
    writeRecentModels(models)
  }

  function applyAuthoritativeState(state: ClientStateSyncState) {
    const catalog = selectClientStateSyncSnapshot(state, isRenderableSession)
    if (!catalog) return
    const next = { ...catalog, sessionSyncRevision: state.digest }
    setSnapshot((current) => (current ? mergeSessionCardSnapshot(current, next) : current))
    Object.keys(state.sessionDetails).forEach((sessionID) => {
      const detail = state.sessionDetails[sessionID]
      if (!detail || appliedSessionDigests.get(sessionID) === detail.snapshot.digest) return
      appliedSessionDigests.set(sessionID, detail.snapshot.digest)
      const data = sessionDataFromClientState(state, sessionID)
      if (!data) return
      const loadedTime = detail.snapshot.session.time.updated
      setSelectedSessionDataCache((current) => {
        const cached = current[sessionID]
        if (!cached) return current
        return setRecordEntry(current, sessionID, { data: mergeLiveSessionData(cached.data, data), loadedTime })
      })
      if (sessionDataSessionID() === sessionID) {
        const merged = mergeLiveSessionData(sessionData(), data)
        setSessionData(merged)
        sessionDataLoadedTime = loadedTime
        rememberSelectedSessionData(sessionID, merged, loadedTime)
      }
      if (viewSessionData()[sessionID]) {
        setViewSessionData((current) =>
          setRecordEntry(current, sessionID, mergeLiveSessionData(current[sessionID], data)),
        )
        setViewPaneLoadedTime(sessionID, loadedTime)
      }
    })
    const models = mergeRecentModels(recentModelsFromSessions(next.sessions), recentModels())
    if (models.join("\n") === recentModels().join("\n")) return
    setRecentModels(models)
    writeRecentModels(models)
  }

  async function refreshPlugins() {
    const gui = client()
    if (!gui) return
    const plugins = await listPlugins(gui)
    setSnapshot((current) => (current ? { ...current, plugins } : current))
  }

  createEffect(() => {
    writeInstalledGuiPlugins(guiPlugins())
  })

  createEffect(
    on(
      () => {
        const view = activeView()
        return view ? `${view.id}:${view.timeUpdated}:${view.focusedSessionID ?? ""}` : ""
      },
      () => setFocusedViewSessionID(""),
    ),
  )

  function handleInstallGuiPlugin(manifest: GuiPluginManifest, source: InstalledGuiPlugin["source"]) {
    setGuiPlugins((plugins) => installDeclarativeGuiPlugin(plugins, manifest, source))
  }

  function handleToggleGuiPlugin(id: string) {
    setGuiPlugins((plugins) =>
      plugins.map((plugin) => (plugin.manifest.id === id ? { ...plugin, enabled: !plugin.enabled } : plugin)),
    )
  }

  function handleRemoveGuiPlugin(id: string) {
    setGuiPlugins((plugins) => plugins.filter((plugin) => plugin.manifest.id !== id))
  }

  async function runAction(action: () => Promise<void>) {
    try {
      await action()
    } catch (cause) {
      console.error(cause)
    }
  }

  function alert(message: string) {
    console.info(message)
  }

  function viewPaneState(paneID: string) {
    return viewPaneStates()[paneID] ?? EMPTY_VIEW_PANE_RUNTIME_STATE
  }

  function updateViewPaneState(paneID: string, update: (state: ViewPaneRuntimeState) => ViewPaneRuntimeState) {
    setViewPaneStates((current) => updateViewPaneRuntimeState(current, paneID, update))
  }

  function setViewPaneLoading(paneID: string, loading: boolean) {
    updateViewPaneState(paneID, (state) => (state.loading === loading ? state : { ...state, loading }))
  }

  function setViewPaneLoadedTime(paneID: string, loadedTime: number) {
    updateViewPaneState(paneID, (state) => (state.loadedTime === loadedTime ? state : { ...state, loadedTime }))
  }

  function askText(input: { title: string; message?: string; value?: string; multiline?: boolean }) {
    return new Promise<string | undefined>((resolve) => setDialog({ type: "text", ...input, resolve }))
  }

  function askProject(input: { title: string; message?: string; name: string; folders: string[] }) {
    return new Promise<ProjectDialogValue | undefined>((resolve) => setDialog({ type: "project", ...input, resolve }))
  }

  function confirm(input: { title: string; message: string; confirm?: string }) {
    return new Promise<boolean>((resolve) => setDialog({ type: "confirm", ...input, resolve }))
  }

  function askChoice(input: { title: string; message?: string; options: ChoiceOption[] }) {
    return new Promise<string | undefined>((resolve) => setDialog({ type: "choice", ...input, resolve }))
  }

  function askExportOptions(input: { title: string; message?: string; defaults: GuiTranscriptExportOptions }) {
    return new Promise<GuiTranscriptExportOptions | undefined>((resolve) =>
      setDialog({ type: "export", ...input, resolve }),
    )
  }

  function rememberSelectedSessionData(sessionID: string, data: SessionData, loadedTime: number) {
    setSelectedSessionDataCache((current) => setRecordEntry(current, sessionID, { data, loadedTime }))
  }

  function restoreSelectedSessionData(sessionID: string) {
    if (sessionDataSessionID() === sessionID) return
    const cached = selectedSessionDataCache()[sessionID]
    if (!cached) return
    setSessionData(cached.data)
    setSessionDataSessionID(sessionID)
    sessionDataLoadedTime = cached.loadedTime
  }

  async function loadAuthoritativeSession(
    gui: GuiClient,
    sessionID: string,
    directory: string | undefined,
    options: SessionLoadOptions,
  ) {
    const controller = stateSync
    if (controller?.getState().phase === "ready") {
      return loadClientStateSession(controller, sessionID, {
        limit: options.messageLimit,
        before: options.messageBefore,
      })
    }
    return loadSession(gui, sessionID, directory, options)
  }

  async function syncSession(sessionID: string, options: { force?: boolean } = {}) {
    const gui = client()
    if (!gui) return
    restoreSelectedSessionData(sessionID)
    const session =
      snapshot()?.sessions.find((item) => item.id === sessionID) ??
      (materializingSessionID() === sessionID ? materializingSession() : undefined)
    await runSelectedSessionSync({
      force: options.force,
      sessionID,
      session,
      loadedSessionID: sessionDataSessionID(),
      loadedTime: sessionDataLoadedTime,
      nextRequestID: () => ++sessionSyncRequestID,
      latestRequestID: () => sessionSyncRequestID,
      route: () =>
        route().name === "new-session" && materializingSessionID() === sessionID
          ? { name: "session", sessionID }
          : route(),
      loadingSessionID,
      setLoadingSessionID,
      clearLoadingSessionID: () => setLoadingSessionID(""),
      loadData: async (targetSessionID, directory) =>
        trimToLiveTail(
          await loadAuthoritativeSession(gui, targetSessionID, directory, {
            messageLimit: SESSION_MESSAGE_PAGE_LIMIT,
            messageRenderBudget: SESSION_MESSAGE_WINDOW.budget,
          }),
          SESSION_MESSAGE_WINDOW,
        ),
      applyData: (data, loadedTime) => {
        const next = sessionDataSessionID() === sessionID ? mergeLiveSessionData(sessionData(), data) : data
        setSessionData(next)
        setSessionDataSessionID(sessionID)
        sessionDataLoadedTime = loadedTime
        rememberSelectedSessionData(sessionID, next, loadedTime)
        if (route().name === "new-session" && materializingSessionID() === sessionID)
          setRoute({ name: "session", sessionID })
      },
      applyFailure: (cause) => {
        console.error(cause)
        if (sessionDataSessionID() === sessionID || selectedSessionDataCache()[sessionID]) return
        setSessionData(EMPTY_SESSION_DATA)
        setSessionDataSessionID(sessionID)
      },
    })
  }

  async function syncViewSession(session: Session, options: { force?: boolean } = {}) {
    const gui = client()
    if (!gui) return
    if (
      shouldSkipViewSessionSync({
        force: options.force,
        session,
        data: viewSessionData()[session.id],
        loadedTime: viewPaneState(session.id).loadedTime,
      })
    )
      return
    const loadKey = viewSessionLoadKey(session)
    const existing = viewSessionLoadPromises.get(session.id)
    if (existing?.key === loadKey) return existing.promise
    const showLoading = shouldShowViewSessionLoading(viewSessionData()[session.id])
    if (showLoading) setViewPaneLoading(session.id, true)
    const promise = (async () => {
      const data = trimToLiveTail(
        await loadAuthoritativeSession(gui, session.id, session.directory, {
          messageLimit: VIEW_MESSAGE_PAGE_LIMIT,
          messageRenderBudget: VIEW_MESSAGE_WINDOW.budget,
          includeSideData: false,
        }),
        VIEW_MESSAGE_WINDOW,
      )
      if (viewSessionLoadPromises.get(session.id)?.key !== loadKey) return
      setViewSessionData((current) =>
        setRecordEntry(current, session.id, mergeLiveSessionData(current[session.id], data)),
      )
      setViewPaneLoadedTime(session.id, session.time.updated)
    })().finally(() => {
      if (viewSessionLoadPromises.get(session.id)?.key !== loadKey) return
      viewSessionLoadPromises.delete(session.id)
      if (showLoading) setViewPaneLoading(session.id, false)
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
    if (sessionDataSessionID() !== sessionID) return
    const next = prependOlderMessages(sessionData(), page)
    setSessionData(next)
    rememberSelectedSessionData(sessionID, next, sessionDataLoadedTime)
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
    setViewSessionData((current) =>
      setRecordEntry(current, sessionID, prependOlderMessages(current[sessionID] ?? EMPTY_SESSION_DATA, page)),
    )
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
        viewSessionData: viewSessionData(),
        lastSnapshotSync,
        snapshotSyncInterval: SNAPSHOT_SYNC_INTERVAL_MS,
      })
      if (plan.selectedSessionID) await syncSession(plan.selectedSessionID, { force: true })
      await Promise.all(plan.viewSessions.map((session) => syncViewSession(session, { force: true })))
      if (plan.refreshSnapshot) {
        lastSnapshotSync = now
        await refresh()
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
      const next = patchSelectedSessionData({
        data:
          sessionDataSessionID() === sessionID
            ? sessionData()
            : (selectedSessionDataCache()[sessionID]?.data ?? EMPTY_SESSION_DATA),
        loadedSessionID: sessionID,
        targetSessionID: sessionID,
        event,
        limit: SESSION_MESSAGE_WINDOW,
        emptyData: EMPTY_SESSION_DATA,
      })
      setSessionDataSessionID(sessionID)
      setSessionData(next)
      const loadedTime = Date.now()
      sessionDataLoadedTime = loadedTime
      rememberSelectedSessionData(sessionID, next, loadedTime)
    }

    if (targets.visibleSessionIDs.length > 0) {
      setViewSessionData((data) =>
        patchVisibleViewSessionData({
        data,
        sessionIDs: targets.visibleSessionIDs,
        event,
        limit: VIEW_MESSAGE_WINDOW,
        emptyData: EMPTY_SESSION_DATA,
        }),
      )
      const loadedTime = Date.now()
      targets.visibleSessionIDs.forEach((sessionID) => setViewPaneLoadedTime(sessionID, loadedTime))
    }

    return true
  }

  function applySnapshotEvent(event: GlobalEvent) {
    if (!isSnapshotPatchEvent(event)) return false
    setSnapshot((current) => (current ? patchSnapshot(current, event) : current))
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
    const target = visibleSessionSyncTarget({ route: route(), sessionID, viewSessions: activeViewSessions() })
    if (target?.type === "session") void syncSession(target.sessionID, { force: true })
    if (target?.type === "view") void syncViewSession(target.session, { force: true })
  }

  onMount(() => {
    let unsubscribe: (() => void) | undefined
    let unsubscribeState: (() => void) | undefined
    onCleanup(() => {
      unsubscribe?.()
      unsubscribeState?.()
      stateSync?.stop()
    })

    void (async () => {
      try {
        const gui = await connectGuiClient()
        setClient(gui)
        setLoading("Loading workspace")
        await refresh()
        unsubscribe = subscribeEvents(gui, handleGlobalEvent)
        stateSync = createClientStateSync({ client: gui.client, directory: gui.directory || undefined })
        unsubscribeState = stateSync.subscribe(applyAuthoritativeState)
        await stateSync.start().catch((cause) => console.error(cause))
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
      void syncLiveServerState()
        .catch(() => undefined)
        .finally(() => {
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
        abortableSessionID: abortableSessionID(),
      })
      if (!action) return
      event.preventDefault()
      runGuiShortcutAction(action, {
        abortSession: (sessionID) => void runAction(() => handleAbortSession(sessionID)),
        openCommandPalette: () => setCommandPaletteOpen(true),
        toggleRail: () => setRailCollapsed((value) => !value),
        focusComposer: () =>
          document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus({ preventScroll: true }),
        createSession: () => void runAction(() => handleCreateSession()),
        refresh: () => void runAction(refresh),
        showKeyboardHelp: () => setKeyboardHelpOpen(true),
        copyLastAssistantMessage: () => void runAction(copyLastAssistantMessage),
        transcript: moveTranscript,
        route: (name) => setRoute({ name }),
      })
    }
    window.addEventListener("keydown", handleKeydown)
    onCleanup(() => window.removeEventListener("keydown", handleKeydown))
  })

  createEffect(() => {
    const current = route()
    if (current.name === "session" && client())
      untrack(() => {
        void syncSession(current.sessionID)
      })
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
      const paneIDs = new Set(activeViewItems().map((item) => viewItemID(item)))
      const sessionIDs = new Set(activeViewSessions().map((session) => session.id))
      setViewPaneStates((states) => pruneRecordKeys(states, paneIDs))
      setViewSessionData((data) => pruneRecordKeys(data, sessionIDs))
      setFocusedViewSessionID("")
      setViewSidePanelSessionID("")
    }
    untrack(() => {
      void syncActiveViewSessions()
    })
  })

  createEffect(() => {
    if (route().name !== "views") return
    const session = viewSidePanelSession()
    if (!session) return
    if (viewSidePanelSessionID() !== session.id) setViewSidePanelSessionID(session.id)
  })

  createEffect(
    on(
      () => {
        const session = route().name === "session" ? selectedSession() : undefined
        return session ? `${session.id}:${session.time.updated}` : ""
      },
      () => {
        const session = route().name === "session" ? selectedSession() : undefined
    if (!session) return
        const timer = setTimeout(
          () => markSessionViewed(session.id, Math.max(Date.now(), session.time.updated)),
          SESSION_VIEWED_MARK_DELAY_MS,
        )
        onCleanup(() => clearTimeout(timer))
      },
    ),
  )

  createEffect(
    on(
      () => {
        if (route().name !== "views") return ""
        return activeViewSessions()
          .map((session) => `${session.id}:${session.time.updated}`)
          .join("\n")
      },
      () => {
    if (route().name !== "views") return
        const timers = activeViewSessions().map((session) =>
          setTimeout(
            () => markSessionViewed(session.id, Math.max(Date.now(), session.time.updated)),
            SESSION_VIEWED_MARK_DELAY_MS,
          ),
        )
        onCleanup(() => timers.forEach((timer) => clearTimeout(timer)))
      },
    ),
  )

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
    const providers = snapshot()?.providers ?? []
    const model = recentModels().find((item) => modelAvailable(item, providers)) ?? firstAvailableModel(providers)
    if (model) setSelectedModel(model)
  })

  createEffect(() => {
    const key = pendingPinnedSessionRouteKey()
    if (key && activeSessionRouteKey(route()) !== key) setPendingPinnedSessionRouteKey("")
  })

  createEffect(() => {
    const current = selectedModel()
    if (!current) return
    const providers = snapshot()?.providers ?? []
    if (modelAvailable(current, providers)) return
    setSelectedModel(firstAvailableModel(providers) ?? "")
    setSelectedVariant("")
  })

  function modelAvailable(value: string, providers: NonNullable<GuiSnapshot>["providers"]) {
    const selection = parseModelValue(value)
    if (!selection) return false
    return Boolean(providers.find((provider) => provider.id === selection.providerID)?.models[selection.modelID])
  }

  async function submitPrompt(event: SubmitEvent, value?: string | GuiPromptInfo) {
    event.preventDefault()
    const gui = client()
    const session = selectedSession()
    const pinCreatedSession = pendingPinnedSessionRouteKey() === activeSessionRouteKey(route())
    await runSessionPromptAction({
      gui,
      route: route(),
      session,
      text: value ?? prompt(),
      permissionCount: selectedPermissions().length,
      questionCount: selectedQuestions().length,
      agent: selectedAgent(),
      model: selectedModel(),
      variant: selectedVariant(),
      setPrompt,
      setLoadingSessionID,
      sendPrompt: (sessionID, text, options) =>
        gui ? sendPrompt(gui, sessionID, text, options).then(() => undefined) : Promise.resolve(),
      runCommand: (sessionID, command, args, options) =>
        gui
          ? runSessionCommand(gui, sessionID, { command, arguments: args, ...options }).then(() => undefined)
          : Promise.resolve(),
      runShell: (sessionID, command, options) =>
        gui
          ? runShellCommand(gui, sessionID, {
              command,
              directory: options.directory,
              agent: options.agent,
              model: options.model,
            }).then(() => undefined)
          : Promise.resolve(),
      serverCommands: snapshot()?.commands ?? [],
      rememberModel,
      syncSession: (sessionID) => syncSession(sessionID, { force: true }),
      refresh,
      openCreatedSession: (sessionID, session) => {
        if (pinCreatedSession) pinSession(sessionID)
        setMaterializingSession(session)
        setMaterializingSessionID(sessionID)
        setPendingPinnedSessionRouteKey("")
      },
    })
  }

  function openWorkbenchPrompt(text: string) {
    setPrompt(text)
    const session = selectedSession()
    if (session) {
      setRoute({ name: "session", sessionID: session.id })
      requestComposerFocus()
      return
    }
    const project = snapshot()?.projects[0]
    setRoute(
      workbenchPromptTarget({
      projectID: project?.id,
      projectDirectory: project?.folders[0]?.path,
      fallbackDirectory: client()?.directory,
      }),
    )
    requestComposerFocus()
  }

  function requestComposerFocus() {
    setTimeout(
      () => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus({ preventScroll: true }),
      0,
    )
  }

  function projectNameForProjectID(projectID?: string) {
    const project = snapshot()?.projects.find((item) => item.id === projectID)
    return project?.name ?? project?.project.name
  }

  function projectNameForSession(session: Session | undefined) {
    if (!session) return
    const project = snapshot()?.projects.find(
      (item) =>
        item.id === session.projectID || item.sessions.some((projectSession) => projectSession.id === session.id),
    )
    return project?.name ?? project?.project.name
  }

  async function submitViewPrompt(event: SubmitEvent, item: ViewItem, value: GuiPromptInfo) {
    event.preventDefault()
    const gui = client()
    const paneID = viewItemID(item)
    await runViewPromptAction({
      gui,
      item,
      view: activeView(),
      text: value,
      agentForSession: (session) => viewAgentValue(paneID, session),
      modelForSession: (session) => viewModelValue(paneID, session),
      variantForSession: (session) => viewVariantValue(paneID, session),
      setDraftLoading: setViewPaneLoading,
      setFocusedSessionID: setFocusedViewSessionID,
      alert,
      sendPrompt: (sessionID, text, options) =>
        gui ? sendPrompt(gui, sessionID, text, options).then(() => undefined) : Promise.resolve(),
      runCommand: (sessionID, command, args, options) =>
        gui
          ? runSessionCommand(gui, sessionID, { command, arguments: args, ...options }).then(() => undefined)
          : Promise.resolve(),
      runShell: (sessionID, command, options) =>
        gui
          ? runShellCommand(gui, sessionID, {
              command,
              directory: options.directory,
              agent: options.agent,
              model: options.model,
            }).then(() => undefined)
          : Promise.resolve(),
      serverCommands: snapshot()?.commands ?? [],
      rememberModel,
      syncViewSession: (session) => syncViewSession(session, { force: true }),
      refresh,
    })
  }

  function viewAgentValue(paneID: string, session: Session) {
    return viewPaneState(paneID).selectedAgent ?? session.agent ?? ""
  }

  function viewModelValue(paneID: string, session: Session) {
    return (
      viewPaneState(paneID).selectedModel ??
      (session.model ? modelValue(session.model.providerID, session.model.id) : selectedModel())
    )
  }

  function viewVariantValue(paneID: string, session: Session) {
    return viewPaneState(paneID).selectedVariant ?? session.model?.variant ?? ""
  }

  function focusViewSession(sessionID: string, options: { focusComposer?: boolean } = {}) {
    const view = activeView()
    if (!view) return
    setViewSidePanelSessionID(sessionID)
    if (activeViewFocusedSessionID() === sessionID) return
    setFocusedViewSessionID(sessionID)
    if (options.focusComposer) setViewComposerFocusRequest({ sessionID, token: ++viewComposerFocusToken })
    scheduleViewFocusPersistence(view, sessionID)
  }

  function setActiveViewSidePanelOpen(value: boolean) {
    const id = activeView()?.id
    if (!id) return
    setViewSidePanelOpenByViewID((current) => (current[id] === value ? current : { ...current, [id]: value }))
  }

  function openViewSidePanel(sessionID = activeViewFocusedSessionID(), target?: SessionSidePanelTarget) {
    const session = activeViewSessions().find((item) => item.id === sessionID) ?? viewSidePanelSession()
    if (session) setViewSidePanelSessionID(session.id)
    setActiveViewSidePanelOpen(true)
    if (target) setViewSidePanelRequest({ ...target, token: Date.now() } as SessionSidePanelRequest)
  }

  function toggleViewSidePanel() {
    if (viewSidePanelOpen()) {
      setActiveViewSidePanelOpen(false)
      return
    }
    openViewSidePanel()
  }

  const startViewSidePanelResize = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const container = event.currentTarget.parentElement
    const containerWidth = container?.getBoundingClientRect().width ?? window.innerWidth
    const startX = event.clientX
    const startRatio = viewSidePanelWidthRatio()
    const onMove = (moveEvent: PointerEvent) => {
      setViewSidePanelWidthRatio(
        clampViewSidePanelWidthRatio(startRatio - (moveEvent.clientX - startX) / containerWidth),
      )
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  function scheduleViewFocusPersistence(view: OpencodeXView, sessionID: string) {
    if (!activeViewSessions().some((session) => session.id === sessionID)) return
    if (viewFocusPersistTimer) clearTimeout(viewFocusPersistTimer)
    viewFocusPersistTimer = setTimeout(() => {
      viewFocusPersistTimer = undefined
      const gui = client()
      if (!gui) return
      void updateViewFocus(gui, view.id, sessionID).catch(() => {
        setFocusedViewSessionID("")
        void (stateSync?.getState().phase === "ready" ? stateSync.refresh() : refreshSessionCards()).catch(
          () => undefined,
        )
      })
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
    setSnapshot((current) => (current ? markSessionSeenInSnapshot(current, sessionID, time) : current))
    if (gui)
      void updateSessionUiState(gui, sessionID, { seenAt: time }).catch(() =>
        (stateSync?.getState().phase === "ready" ? stateSync.refresh() : refreshSessionCards()).catch(() => undefined),
      )
  }

  function markSessionReviewed(session: Session) {
    const time = Math.max(Date.now(), session.time.updated)
    const gui = client()
    setSnapshot((current) => (current ? markSessionViewedInSnapshot(current, session.id, time) : current))
    if (gui)
      void updateSessionUiState(gui, session.id, { seenAt: time, reviewedAt: time }).catch(() =>
        (stateSync?.getState().phase === "ready" ? stateSync.refresh() : refreshSessionCards()).catch(() => undefined),
      )
  }

  function toggleRailSection(name: RailSectionName) {
    setRailSections((current) => ({ ...current, [name]: !current[name] }))
  }

  function toggleSessionPinned(sessionID: string) {
    setPinnedSessionIDs((current) =>
      current.includes(sessionID) ? current.filter((id) => id !== sessionID) : [...current, sessionID],
    )
  }

  function pinSession(sessionID: string) {
    setPinnedSessionIDs((current) => (current.includes(sessionID) ? current : [...current, sessionID]))
  }

  function toggleViewPinned(viewID: string) {
    setPinnedViewIDs((current) =>
      current.includes(viewID) ? current.filter((id) => id !== viewID) : [...current, viewID],
    )
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
    const next = (
      await askText({
        title: "Edit Session",
        message: "Update the title shown in the sidebar and session list.",
        value: session.title,
      })
    )?.trim()
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
    if (
      !(await confirm({
        title: "Delete Session",
        message: `Delete "${session.title}"?\n\nThis permanently deletes session data.`,
        confirm: "Delete",
      }))
    )
      return
    await deleteSession(gui, session.id)
    await refresh()
    setRoute({ name: "dashboard" })
  }

  async function handleSwitchSession() {
    const sessions = visibleSessions()
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

  async function switchVariantFor(input: { selectedModel: string; setSelectedVariant: (value: string) => void }) {
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
    if (current.name !== "session" && current.name !== "new-session" && visibleSessions().length > 0)
      setRoute({ name: "session", sessionID: visibleSessions()[0].id })
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus({ preventScroll: true }),
    )
  }

  function showHelp() {
    setKeyboardHelpOpen(true)
  }

  function transcriptElement() {
    return document.querySelector<HTMLElement>(".session-page .transcript")
  }

  function transcriptMessages() {
    return Array.from(document.querySelectorAll<HTMLElement>(".session-page .message[data-message-id]"))
  }

  function moveTranscript(action: "first" | "last" | "next" | "previous" | "last-user") {
    const transcript = transcriptElement()
    const messages = transcriptMessages()
    if (!transcript || messages.length === 0) return
    if (action === "first") {
      transcript.scrollTo({ top: 0, behavior: "smooth" })
      return
    }
    if (action === "last") {
      transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" })
      return
    }
    const current = messages.findIndex(
      (message) => message.getBoundingClientRect().bottom > transcript.getBoundingClientRect().top + 12,
    )
    const target =
      action === "last-user"
      ? messages.findLast((message) => message.classList.contains("user"))
        : messages[
            Math.max(0, Math.min(messages.length - 1, (current === -1 ? 0 : current) + (action === "next" ? 1 : -1)))
          ]
    target?.scrollIntoView({ block: "start", behavior: "smooth" })
  }

  async function copyLastAssistantMessage() {
    const message = activeSessionData().messages.findLast((bundle) => bundle.info.role === "assistant")
    const text = message?.parts
      .flatMap((part) => (part.type === "text" && !part.synthetic && !part.ignored ? [part.text] : []))
      .join("\n")
      .trim()
    if (!text) return alert("No assistant text is available to copy.")
    await navigator.clipboard.writeText(text)
    alert("Assistant message copied.")
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
      return (
        (await loadSessionDiff(gui, { sessionID: input.session.id, directory: input.session.directory })).data ?? []
      )
    }
    return (await loadVcsDiff(gui, { mode: "git", context: 12 })).data ?? []
  }

  function sidePanelDirectoryForSession(session?: Session) {
    if (!session) return client()?.directory
    const project = snapshot()?.projects.find((item) =>
      item.sessions.some((projectSession) => projectSession.id === session.id),
    )
    return project?.folders[0]?.path || session.directory || client()?.directory
  }

  async function updateDiffReviewedFiles(session: Session, reviewedFiles: string[]) {
    const gui = client()
    if (!gui) return
    const reviewedAt =
      reviewedFiles.length > 0 && session.summary?.files === reviewedFiles.length
        ? Math.max(Date.now(), session.time.updated)
        : undefined
    await updateSessionUiState(gui, session.id, { reviewedFiles, reviewedAt })
    setSnapshot((current) =>
      current
        ? {
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
          }
        : current,
    )
  }

  function handleToggleTimestampsSlash() {
    const next = !showTranscriptTimestamps()
    setShowTranscriptTimestamps(next)
    writeBoolPreference("opencodex.gui.transcript.timestamps", next)
    alert(next ? "Message timestamps shown." : "Message timestamps hidden.")
  }

  function handleToggleCodeConcealSlash() {
    const next = !concealTranscriptCodeBlocks()
    setConcealTranscriptCodeBlocks(next)
    writeBoolPreference("opencodex.gui.transcript.concealCode", next)
    alert(next ? "Code blocks concealed." : "Code blocks expanded.")
  }

  function handleToggleThinkingSlash() {
    const next = !showTranscriptThinking()
    setShowTranscriptThinking(next)
    writeBoolPreference("opencodex.gui.transcript.thinking", next)
    alert(next ? "Thinking content shown." : "Thinking content hidden.")
  }

  function handleToggleToolDetailsSlash() {
    const next = !showTranscriptToolDetails()
    setShowTranscriptToolDetails(next)
    writeBoolPreference("opencodex.gui.transcript.toolDetails", next)
    alert(next ? "Tool details shown." : "Tool details hidden.")
  }

  function handleToggleScrollbarSlash() {
    const next = !showTranscriptScrollbar()
    setShowTranscriptScrollbar(next)
    writeBoolPreference("opencodex.gui.transcript.scrollbar", next)
    alert(next ? "Session scrollbar shown." : "Session scrollbar hidden.")
  }

  function handleToggleGenericToolOutputSlash() {
    const next = !showTranscriptGenericToolOutput()
    setShowTranscriptGenericToolOutput(next)
    writeBoolPreference("opencodex.gui.transcript.genericToolOutput", next)
    alert(next ? "Generic tool output shown." : "Generic tool output hidden.")
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
    const current = context?.draftPrompt.trim().startsWith("/") ? "" : (context?.draftPrompt ?? "")
    const content = await window.opencodex.editor({
      value: current,
      cwd: session?.directory || client()?.directory,
    })
    if (content === undefined) return alert("Set VISUAL or EDITOR to use /editor.")
    context?.setDraftPrompt(content)
    context?.setDraftParts?.(restorePromptPartsFromEditedText(context.draftParts ?? [], content))
  }

  async function handleMcpSlash() {
    const gui = client()
    if (!gui) return
    const status = (await listMcpStatus(gui)).data ?? {}
    const options = Object.entries(status).map(([name, item]) => ({
      value: name,
      title: name,
      meta: item.status,
      description:
        "error" in item
          ? item.error
          : item.status === "connected"
            ? "Disconnect this MCP server"
            : "Connect this MCP server",
    }))
    if (options.length === 0) return alert("No MCP servers are configured.")
    const name = await askChoice({
      title: "Toggle MCP",
      message: "Connected servers will be disconnected; other servers will be connected.",
      options,
    })
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
    const providerID =
      providerValue === CUSTOM_PROVIDER_OPTION
        ? normalizeCustomProviderID(
            await askText({
      title: "Custom Provider",
              message:
                "Provider ids must start with a lowercase letter or number and only use lowercase letters, numbers, hyphens, and underscores.",
            }),
          )
        : providerValue
    if (!providerID) return alert("Invalid provider ID.")
    const methods = authMethods[providerID] ?? [{ type: "api" as const, label: "API key" }]
    const methodValue =
      methods.length === 1
        ? "0"
        : await askChoice({
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
      const key = (
        await askText({
          title: method.label,
          message: providerID === "opencode" ? "Enter your OpenCode Zen API key." : undefined,
        })
      )?.trim()
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
      mode: opencodeXSwarmExecutionMode(input.selectedAgent || selectedAgent() || undefined),
      variant: input.selectedVariant || undefined,
    })
    await refresh()
    setRoute({ name: "swarms", swarmID })
    alert("Swarm task assigned.")
  }

  async function handleEditViewSlash() {
    const gui = client()
    if (!gui) return
    const view = await chooseView("Edit View")
    if (!view) return
    setRoute({ name: "view-edit", viewID: view.id })
  }

  async function handleDeleteViewSlash() {
    const gui = client()
    if (!gui) return
    const view = await chooseView("Delete View")
    if (!view) return
    await handleDeleteViewByID(view.id, view.title)
  }

  async function handleDeleteViewByID(viewID: string, name: string) {
    const gui = client()
    if (!gui) return
    if (!(await confirm({ title: "Delete View", message: `Delete "${name}"?`, confirm: "Delete" }))) return
    await deleteView(gui, viewID)
    await refresh()
    const current = route()
    if (
      (current.name === "views" && current.viewID === viewID) ||
      (current.name === "view-edit" && current.viewID === viewID)
    )
      setRoute({ name: "views" })
    alert("View deleted.")
  }

  async function handleWorkspacesSlash() {
    const gui = client()
    if (!gui) return
    await syncWorkspaces(gui).catch(() => undefined)
    const workspaces = (await listWorkspaces(gui)).data ?? []
    const statuses = new Map(
      ((await workspaceStatus(gui)).data ?? []).map((status) => [status.workspaceID, status.status]),
    )
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
    if (!(await confirm({ title: "Remove Workspace", message: `Remove "${workspace.name}"?`, confirm: "Remove" })))
      return
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
    await warpSessionWorkspace(gui, {
      id: value === "__local__" ? null : value,
      sessionID: session.id,
      copyChanges: copyChanges === "yes",
    })
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

  async function handleUndoSlash(
    session?: Session,
    data = activeSessionData(),
    restorePrompt: (value: string) => void = setPrompt,
  ) {
    const gui = client()
    if (!gui || !session) return
    const status = snapshot()?.sessionStatus[session.id]?.type
    if (status && status !== "idle") await abortSession(gui, session.id, session.directory).catch(() => undefined)
    const message = data.messages.findLast(
      (item) => (!session.revert?.messageID || item.info.id < session.revert.messageID) && item.info.role === "user",
    )
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
    const forked = await forkSession(gui, {
      sessionID: session.id,
      messageID: value === "__full__" ? undefined : value,
    })
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
    const gui = client()
    if (!gui || !session) return
    const options = await askExportOptions({
      title: "Export Options",
      defaults: defaultTranscriptExportOptions({
        session,
        thinking: showTranscriptThinking(),
        toolDetails: showTranscriptToolDetails(),
        assistantMetadata: true,
      }),
    })
    if (!options) return
    const data = await loadSession(gui, session.id, session.directory, { messageLimit: 10_000 })
    const transcript = prepareSessionTranscriptExport({
      session,
      messages: data.messages,
      providers: snapshot()?.providers ?? [],
      options,
    })
    const href = URL.createObjectURL(new Blob([transcript.markdown], { type: "text/markdown" }))
    if (transcript.openWithoutSaving) {
      const opened = window.open(href, "_blank", "noopener,noreferrer")
      setTimeout(() => URL.revokeObjectURL(href), 30_000)
      if (!opened) alert("Export preview was blocked.")
      return
    }
    const link = document.createElement("a")
    link.href = href
    link.download = transcript.filename
    link.click()
    URL.revokeObjectURL(href)
  }

  async function loadTranscriptForSlash(session?: Session) {
    const gui = client()
    if (!gui || !session) return
    const data = await loadSession(gui, session.id, session.directory, { messageLimit: 10_000 })
    return formatSessionTranscript({
      session,
      messages: data.messages,
      providers: snapshot()?.providers ?? [],
      options: {
        thinking: showTranscriptThinking(),
        toolDetails: showTranscriptToolDetails(),
        assistantMetadata: true,
      },
    })
  }

  async function reloadSessionAfterSlash(session: Session) {
    await refresh()
    if (sessionDataSessionID() === session.id) await syncSession(session.id, { force: true })
    if (viewSessionData()[session.id]) await syncViewSession(session, { force: true })
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
        const matches =
          value === undefined
            ? false
            : prompt.when.op === "eq"
              ? value === prompt.when.value
              : value !== prompt.when.value
        if (!matches) continue
      }
      const value =
        prompt.type === "select"
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
    const local = buildSessionSlashCommands({
      shared: !!session?.share?.url,
      canRedo: !!session?.revert?.messageID,
      variantCount: selectedModelVariants(snapshot()?.providers ?? [], options.selectedModel ?? selectedModel()).length,
      actions: {
        switchSession: handleSwitchSession,
        createSession: () => handleCreateSession(),
        openDashboard: () => {
          setRoute({ name: "dashboard" })
        },
        createProject: () => handleCreateProject(),
        openSwarms: () => {
          setRoute({ name: "swarms" })
        },
        openSwarm: () => {
          setRoute({ name: "swarms" })
        },
        createSwarm: () => handleCreateSwarm(),
        createSwarmTask: () =>
          handleCreateSwarmTaskSlash({
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
        renameSession: () => (session ? handleRenameSession(session) : undefined),
        forkSession: () => handleForkSlash(session, options.data),
        compactSession: () => handleCompactSlash(session, options.selectedModel),
        unshareSession: () => handleUnshareSlash(session),
        undoMessage: () => handleUndoSlash(session, options.data, options.restorePrompt),
        redoMessage: () => handleRedoSlash(session, options.data),
        toggleCodeConceal: handleToggleCodeConcealSlash,
        toggleTimestamps: handleToggleTimestampsSlash,
        toggleThinking: handleToggleThinkingSlash,
        toggleToolDetails: handleToggleToolDetailsSlash,
        toggleScrollbar: handleToggleScrollbarSlash,
        toggleGenericToolOutput: handleToggleGenericToolOutputSlash,
        copyTranscript: () => handleCopyTranscriptSlash(session),
        exportTranscript: () => handleExportTranscriptSlash(session),
      },
    })
    const localNames = new Set(local.flatMap((command) => [command.name, ...(command.aliases ?? [])]))
    const server = (snapshot()?.commands ?? [])
      .filter((command) => command.source !== "skill" && !localNames.has(command.name))
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(
        (command): SessionSlashCommand => ({
        name: command.name,
        title: command.source === "mcp" ? `${command.name}:mcp` : command.name,
        detail: command.description ?? "Run backend command",
        category: command.source === "mcp" ? "MCP Commands" : "Project Commands",
        run: (context) => context?.setDraftPrompt(`/${command.name} `),
        }),
      )
    return [...local, ...server]
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
      replyPermission: (requestID, reply, message, directory) =>
        replyPermission(gui, requestID, reply, message, directory).then(() => undefined),
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

  async function chooseFolders(fallback: string) {
    const folders = await window.opencodex?.folders?.(fallback || undefined)
    if (folders) return folders
    const folder = await chooseFolder(fallback)
    return folder ? [folder] : undefined
  }

  async function handleCreateProject() {
    const gui = client()
    if (!gui) return
    await runCreateProjectAction({
      fallbackDirectory: gui.directory,
      chooseFolders,
      validateProjectFolders: (folders) => validateProjectFolders(gui, { folders }),
      createProject: (name, directory, folders) =>
        createProject(gui, { name, directory, folders }).then(() => undefined),
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
      askProject,
      validateProjectFolders: (targetProjectID, next) =>
        validateProjectFolders(gui, { projectID: targetProjectID, folders: next }),
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
    openCreateSessionRoute(projectID, directory)
  }

  function openCreateSessionRoute(projectID?: string, directory?: string) {
    const gui = client()
    if (!gui) return
    return runCreateSessionRouteAction({
      projectID,
      directory,
      projects: snapshot()?.projects ?? [],
      guiDirectory: gui.directory,
      setPrompt,
      openNewSession: (targetProjectID, targetDirectory) =>
        setRoute({ name: "new-session", projectID: targetProjectID, directory: targetDirectory }),
      focusComposer: () =>
        requestAnimationFrame(() =>
          document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus({ preventScroll: true }),
        ),
    })
  }

  async function handleCreatePinnedSession() {
    const target = openCreateSessionRoute()
    if (!target) return
    setPendingPinnedSessionRouteKey(
      activeSessionRouteKey({ name: "new-session", projectID: target.projectID, directory: target.directory }),
    )
  }

  async function handleCreateSwarm(projectID?: string) {
    if ((snapshot()?.projects.length ?? 0) === 0) return alert("Create or load a project before creating a swarm.")
    setRoute({ name: "swarm-create", projectID })
  }

  async function handleSaveSwarm(input: {
    projectID: string
    title?: string
    roles: OpencodeXSwarmRoleInput[]
    swarmID?: string
  }) {
    const gui = client()
    if (!gui) return
    const swarm = input.swarmID
      ? await updateSwarm(gui, input.swarmID, { title: input.title, roles: input.roles }).then((result) => result.data)
      : await createSwarm(gui, { projectID: input.projectID, title: input.title, roles: input.roles }).then(
          (result) => result.data,
        )
    await refresh()
    setRoute({ name: "swarms", swarmID: swarm?.id ?? input.swarmID })
  }

  async function handleAssignSwarmTask(swarmID: string, promptText: string) {
    const gui = client()
    if (!gui) return
    await assignSwarmTask(gui, swarmID, {
      prompt: promptText,
      agent: selectedAgent() || undefined,
      mode: opencodeXSwarmExecutionMode(selectedAgent() || undefined),
      variant: selectedVariant() || undefined,
    })
    await refresh()
    setRoute({ name: "swarms", swarmID })
  }

  async function handleCancelSwarm(swarmID: string) {
    const gui = client()
    if (!gui) return
    await cancelSwarm(gui, swarmID)
    await refresh()
  }

  async function handleDeleteSwarm(swarmID: string, name: string) {
    const gui = client()
    if (!gui) return
    if (
      !(await confirm({
        title: "Delete Swarm",
        message: `Delete "${name}"? This removes the swarm, roles, tasks, and events.`,
        confirm: "Delete",
      }))
    )
      return
    await deleteSwarm(gui, swarmID)
    await refresh()
    setRoute({ name: "swarms" })
  }

  async function handleCreateView() {
    setRoute({ name: "view-edit" })
  }

  async function handleCreateProjectView(projectID: string, sessionIDs: string[]) {
    const gui = client()
    const project = snapshot()?.projects.find((item) => item.id === projectID)
    if (!gui || !project) return
    if (sessionIDs.length === 0) return alert("Create a project session before creating a view.")
    const view = await createView(gui, {
      title: `${title(project.name ?? project.project.name)} view`,
      sessionIDs: sessionIDs.slice(0, 8),
    }).then((result) => result.data)
    await refresh()
    setRoute({ name: "views", viewID: view?.id })
  }

  async function handleSaveView(input: {
    viewID?: string
    title: string
    sessionIDs: string[]
    metadata?: Record<string, unknown>
  }) {
    const gui = client()
    if (!gui) return
    const view = input.viewID
      ? await updateView(gui, input.viewID, {
          title: input.title,
          sessionIDs: input.sessionIDs,
          metadata: input.metadata,
        }).then((result) => result.data)
      : await createView(gui, { title: input.title, sessionIDs: input.sessionIDs, metadata: input.metadata }).then(
          (result) => result.data,
        )
    await refresh()
    setRoute({ name: "views", viewID: view?.id ?? input.viewID })
  }

  async function handleInstallPlugin(input: { spec: string; global?: boolean }) {
    const gui = client()
    if (!gui) return
    const result = await installPlugin(gui, input)
    if (!result.ok) throw new Error(result.message ?? "Failed to install plugin.")
    await refresh()
    const targets = [result.server ? "server" : "", result.tui ? "TUI" : ""].filter(Boolean).join(" and ")
    alert(`Installed ${input.spec}${targets ? ` for ${targets}` : ""}.`)
  }

  async function handleTogglePlugin(plugin: NonNullable<GuiSnapshot["plugins"]>[number]) {
    const gui = client()
    if (!gui) return
    await togglePlugin(gui, { id: plugin.id, enabled: !plugin.enabled })
    await refreshPlugins()
    alert(`${plugin.enabled ? "Disabled" : "Enabled"} ${plugin.spec}.`)
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

  function handleReorderRailSection(
    sourceID: RailSectionName,
    targetID: RailSectionName,
    placement: "before" | "after",
  ) {
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
    const viewIDs = moveByOffset(
      (snapshot()?.views ?? []).map((view) => view.id),
      viewID,
      offset,
    )
    const gui = client()
    if (!gui || viewIDs.length === 0) return
    await reorderViews(gui, viewIDs)
    await refresh()
  }

  async function handleReorderViews(viewIDs: string[]) {
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
    const options = sessions
      .slice(0, 20)
      .map((session) => `${session.id} - ${title(session.title)}`)
      .join("\n")
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

  const paletteCommands = createMemo<PaletteCommand[]>(() => [
    ...buildPaletteCommands({
      visibleSessionCount: visibleSessions().length,
      currentRouteName: route().name,
      workspacePath: selectedSession()?.directory || client()?.directory,
      variantCount: selectedModelVariants(snapshot()?.providers ?? [], selectedModel()).length,
      actions: {
        switchSession: handleSwitchSession,
        createSession: () => handleCreateSession(),
        openRoute: (name) => setRoute({ name }),
        createProject: () => handleCreateProject(),
        createProjectSession: handleCreateProjectSession,
        toggleRail: () => setRailCollapsed((prev) => !prev),
        focusSidebar: () => {
          setRailCollapsed(false)
          requestAnimationFrame(() => document.querySelector<HTMLElement>(".rail button")?.focus())
        },
        createSwarm: () => handleCreateSwarm(),
        createSwarmTask: () =>
          handleCreateSwarmTaskSlash({
          selectedAgent: selectedAgent(),
          selectedVariant: selectedVariant(),
        }),
        createView: handleCreateView,
        editView: handleEditViewSlash,
        deleteView: handleDeleteViewSlash,
        manageWorkspaces: handleWorkspacesSlash,
        copyWorkspacePath,
        switchModel: handleSwitchModel,
        switchAgent: handleSwitchAgent,
        toggleMcps: handleMcpSlash,
        cycleVariant,
        switchVariant: handleSwitchVariant,
        connectProvider: handleConnectSlash,
        switchOrg: handleOrgSlash,
        switchTheme: handleThemeSlash,
        showHelp,
        showKeyboardHelp: () => {
          setKeyboardHelpOpen(true)
        },
        copyLastAssistantMessage,
        copyTranscript: () => handleCopyTranscriptSlash(selectedSession()),
        toggleCodeConceal: handleToggleCodeConcealSlash,
        toggleTimestamps: handleToggleTimestampsSlash,
        toggleThinking: handleToggleThinkingSlash,
        toggleToolDetails: handleToggleToolDetailsSlash,
        toggleScrollbar: handleToggleScrollbarSlash,
        toggleGenericToolOutput: handleToggleGenericToolOutputSlash,
        transcriptFirst: () => moveTranscript("first"),
        transcriptLast: () => moveTranscript("last"),
        transcriptNextMessage: () => moveTranscript("next"),
        transcriptPreviousMessage: () => moveTranscript("previous"),
        transcriptLastUser: () => moveTranscript("last-user"),
        focusComposer,
        refresh,
        installPlugin: () => {
          setRoute({ name: "plugins" })
        },
        openDocs: () => {
          window.open("https://opencode.ai/docs", "_blank", "noopener,noreferrer")
        },
        exitApp: () => void window.opencodex?.window("close"),
      },
    }),
    ...guiPluginCommands(guiPlugins()).map(
      ({ plugin, command }): PaletteCommand => ({
      name: `gui-plugin.${plugin.manifest.id}.${command.id}`,
      title: command.title,
      category: "GUI Plugins",
      description: command.description ?? plugin.manifest.name,
      run: () => openWorkbenchPrompt(command.prompt),
      }),
    ),
  ])

  function renderViewPane(item: Accessor<ViewItem>) {
    const paneID = createMemo(() => viewItemID(item()))
    const session = createMemo(() => viewItemSession(item()))
    const projectName = createMemo(() => {
      const current = item()
      if (current.kind === "pending")
        return current.slot.projectLabel ?? projectNameForProjectID(current.slot.projectID)
      return projectNameForSession(session())
    })
    const paneState = createMemo(() => viewPaneState(paneID()))
    return (
      <ViewPaneHost
        item={item()}
        projectName={projectName()}
        data={item().kind === "session" ? (viewSessionData()[paneID()] ?? EMPTY_SESSION_DATA) : EMPTY_SESSION_DATA}
        loading={paneState().loading}
        status={item().kind === "session" ? (snapshot()?.sessionStatus[paneID()]?.type ?? "idle") : "idle"}
        permissions={
          item().kind === "session"
            ? (snapshot()?.permissions.filter((request) => request.sessionID === paneID()) ?? [])
            : []
        }
        questions={
          item().kind === "session"
            ? (snapshot()?.questions.filter((request) => request.sessionID === paneID()) ?? [])
            : []
        }
        composerState={paneState()}
        updateComposerState={(update) => updateViewPaneState(paneID(), update)}
        focusedSessionID={activeViewFocusedSessionID()}
        composerFocusRequest={viewComposerFocusRequest()}
        providers={snapshot()?.providers ?? []}
        connectedProviderIDs={snapshot()?.connectedProviderIDs ?? []}
        mcp={snapshot()?.mcp ?? {}}
        mcpResources={snapshot()?.mcpResources ?? {}}
        lsp={snapshot()?.lsp ?? []}
        config={snapshot()?.config}
        agents={snapshot()?.agents ?? []}
        findFiles={(input) => (client() ? findFiles(client()!, input) : Promise.resolve([]))}
        recentModels={recentModels()}
        selectedAgent={viewAgentValue(paneID(), session())}
        setSelectedAgent={(sessionID, value) =>
          updateViewPaneState(sessionID, (state) =>
            state.selectedAgent === value ? state : { ...state, selectedAgent: value },
          )
        }
        selectedModel={viewModelValue(paneID(), session())}
        setSelectedModel={(sessionID, value) => {
          updateViewPaneState(sessionID, (state) =>
            state.selectedModel === value && state.selectedVariant === ""
              ? state
              : { ...state, selectedModel: value, selectedVariant: "" },
          )
          if (value) rememberModel(value)
        }}
        selectedVariant={viewVariantValue(paneID(), session())}
        setSelectedVariant={(sessionID, value) =>
          updateViewPaneState(sessionID, (state) =>
            state.selectedVariant === value ? state : { ...state, selectedVariant: value },
          )
        }
        focus={(sessionID, focusComposer) => focusViewSession(sessionID, { focusComposer })}
        openSidePanelTarget={(sessionID, target) => openViewSidePanel(sessionID, target)}
        submit={(event, item, text) => void runAction(() => submitViewPrompt(event, item, text))}
        replyPermission={(request, reply) => void runAction(() => handlePermission(request, reply))}
        replyQuestion={(request, answers) => void runAction(() => handleQuestionReply(request, answers))}
        rejectQuestion={(request) => void runAction(() => handleQuestionReject(request))}
        renameSession={(session) => void runAction(() => handleRenameSession(session))}
        moveSession={(session) => void runAction(() => handleMoveSession(session))}
        deleteSession={(session) => void runAction(() => handleDeleteSession(session))}
        slashCommands={sessionSlashCommands(session(), {
          data: viewSessionData()[paneID()] ?? EMPTY_SESSION_DATA,
          selectedAgent: viewAgentValue(paneID(), session()),
          selectedModel: viewModelValue(paneID(), session()),
          selectedVariant: viewVariantValue(paneID(), session()),
          switchModel: () =>
            switchModelFor({
              setSelectedModel: (value) =>
                updateViewPaneState(paneID(), (state) =>
                  state.selectedModel === value ? state : { ...state, selectedModel: value },
                ),
              setSelectedVariant: (value) =>
                updateViewPaneState(paneID(), (state) =>
                  state.selectedVariant === value ? state : { ...state, selectedVariant: value },
                ),
          }),
          switchAgent: () =>
            switchAgentFor((value) =>
              updateViewPaneState(paneID(), (state) =>
                state.selectedAgent === value ? state : { ...state, selectedAgent: value },
              ),
            ),
          switchVariant: () =>
            switchVariantFor({
            selectedModel: viewModelValue(paneID(), session()),
              setSelectedVariant: (value) =>
                updateViewPaneState(paneID(), (state) =>
                  state.selectedVariant === value ? state : { ...state, selectedVariant: value },
                ),
          }),
        })}
        showTimestamps={showTranscriptTimestamps()}
        concealCodeBlocks={concealTranscriptCodeBlocks()}
        showThinking={showTranscriptThinking()}
        showToolDetails={showTranscriptToolDetails()}
        showScrollbar={showTranscriptScrollbar()}
        showGenericToolOutput={showTranscriptGenericToolOutput()}
        toggleCodeConceal={handleToggleCodeConcealSlash}
        toggleTimestamps={handleToggleTimestampsSlash}
        toggleThinking={handleToggleThinkingSlash}
        toggleToolDetails={handleToggleToolDetailsSlash}
        toggleScrollbar={handleToggleScrollbarSlash}
        toggleGenericToolOutput={handleToggleGenericToolOutputSlash}
        loadOlderMessages={(sessionID, cursor) => runAction(() => loadOlderViewSessionMessages(sessionID, cursor))}
      />
    )
  }

  return (
    <div class="app-shell" classList={{ "rail-collapsed": railCollapsed() }}>
      <style>{guiPluginThemeCss(guiPlugins())}</style>
      <Titlebar
        canGoBack={routeHistoryIndex() > 0}
        canGoForward={routeHistoryIndex() < routeHistory.length - 1}
        goBack={() => goRouteHistory(-1)}
        goForward={() => goRouteHistory(1)}
        newSession={() => void runAction(() => handleCreateSession())}
        newProject={() => void runAction(handleCreateProject)}
        newView={() => void runAction(handleCreateView)}
        newSwarm={() => void runAction(handleCreateSwarm)}
        openDashboard={() => setRoute({ name: "dashboard" })}
        openProjects={() => setRoute({ name: "projects" })}
        openSessions={() => setRoute({ name: "sessions" })}
        openSwarms={() => setRoute({ name: "swarms" })}
        openViews={() => setRoute({ name: "views" })}
        openWorkbench={() => setRoute({ name: "workbench" })}
        toggleLeftSidebar={() => setRailCollapsed((value) => !value)}
        toggleViewSidePanel={activeViewSessions().length > 0 ? toggleViewSidePanel : undefined}
        openCommandPalette={() => setCommandPaletteOpen(true)}
        openKeyboardHelp={() => setKeyboardHelpOpen(true)}
      />
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
        projectSessions={(project) => projectSessions(project, snapshot(), sessionOrderState())}
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
        createPinnedSession={() => void runAction(handleCreatePinnedSession)}
        createView={() => void runAction(handleCreateView)}
        toggleSessionPinned={toggleSessionPinned}
        toggleViewPinned={toggleViewPinned}
        renameSession={(session) => void runAction(() => handleRenameSession(session))}
        deleteSession={(session) => void runAction(() => handleDeleteSession(session))}
        editView={(viewID) => setRoute({ name: "view-edit", viewID })}
        deleteView={(viewID, name) => void runAction(() => handleDeleteViewByID(viewID, name))}
        startDrag={startDrag}
        dragOver={dragOver}
        clearDragTarget={clearDragTarget}
        sectionPointerDrag={sectionPointerDrag}
        reorderRailSection={handleReorderRailSection}
        projectPointerDrag={projectPointerDrag}
        reorderProject={(sourceID, targetID, placement) =>
          void runAction(() => handleReorderProject(sourceID, targetID, placement))
        }
        dropRailSection={handleDropRailSection}
        dropProject={(targetID, placement) => void runAction(() => handleDropProject(targetID, placement))}
        dropView={(targetID, placement) => void runAction(() => handleDropView(targetID, placement))}
        moveRailSection={handleMoveRailSection}
        moveProject={(projectID, offset) => void runAction(() => handleMoveProject(projectID, offset))}
        moveView={(viewID, offset) => void runAction(() => handleMoveView(viewID, offset))}
      />
      <main class="stage">
        <div class="stage-content">
        <Show when={loading()}>
            <AppLoadingSkeleton />
        </Show>
        <Show when={error()}>
          <div class="error-card">{error()}</div>
        </Show>
        <Show when={!loading() && !error()}>
          <Switch>
            <Match when={route().name === "dashboard"}>
              <Dashboard
                snapshot={snapshot()}
                  sessionOrderState={sessionOrderState()}
                logo={<OpencodeXLogo />}
                  openProject={(projectID) => setRoute({ name: "projects", projectID })}
                openSession={(sessionID) => setRoute({ name: "session", sessionID })}
                openView={(viewID) => setRoute({ name: "views", viewID })}
                sessionPinned={(sessionID) => pinnedSessionIDSet().has(sessionID)}
                viewPinned={(viewID) => pinnedViewIDSet().has(viewID)}
                createProject={() => void runAction(handleCreateProject)}
                  createSession={(projectID, directory) =>
                    void runAction(() => handleCreateSession(projectID, directory))
                  }
                createSwarm={() => void runAction(handleCreateSwarm)}
                createView={() => void runAction(handleCreateView)}
                toggleSessionPinned={toggleSessionPinned}
                toggleViewPinned={toggleViewPinned}
                  renameSession={(session) => void runAction(() => handleRenameSession(session))}
                  deleteSession={(session) => void runAction(() => handleDeleteSession(session))}
                  editView={(viewID) => setRoute({ name: "view-edit", viewID })}
                  deleteView={(viewID, name) => void runAction(() => handleDeleteViewByID(viewID, name))}
                  editProject={(projectID, current, folders) =>
                    void runAction(() => handleEditProject(projectID, current, folders))
                  }
                deleteProject={(projectID, name) => void runAction(() => handleDeleteProject(projectID, name))}
              />
            </Match>
            <Match when={route().name === "session" || route().name === "new-session"}>
                  <SessionPage
                    session={selectedSession()}
                  projectName={activeSessionProjectName()}
                    data={activeSessionData()}
                    loading={activeSessionLoading()}
                    prompt={prompt()}
                    setPrompt={setPrompt}
                    providers={snapshot()?.providers ?? []}
                  connectedProviderIDs={snapshot()?.connectedProviderIDs ?? []}
                    mcp={snapshot()?.mcp ?? {}}
                    mcpResources={snapshot()?.mcpResources ?? {}}
                    lsp={snapshot()?.lsp ?? []}
                    config={snapshot()?.config}
                    agents={snapshot()?.agents ?? []}
                  findFiles={(input) => (client() ? findFiles(client()!, input) : Promise.resolve([]))}
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
                    renameSession={(session) => void runAction(() => handleRenameSession(session))}
                    moveSession={(session) => void runAction(() => handleMoveSession(session))}
                    deleteSession={(session) => void runAction(() => handleDeleteSession(session))}
                    slashCommands={sessionSlashCommands(selectedSession(), {
                      data: activeSessionData(),
                      restorePrompt: setPrompt,
                    })}
                    concealCodeBlocks={concealTranscriptCodeBlocks()}
                    showTimestamps={showTranscriptTimestamps()}
                    showThinking={showTranscriptThinking()}
                    showToolDetails={showTranscriptToolDetails()}
                    showScrollbar={showTranscriptScrollbar()}
                    showGenericToolOutput={showTranscriptGenericToolOutput()}
                    toggleCodeConceal={handleToggleCodeConcealSlash}
                    toggleTimestamps={handleToggleTimestampsSlash}
                    toggleThinking={handleToggleThinkingSlash}
                    toggleToolDetails={handleToggleToolDetailsSlash}
                    toggleScrollbar={handleToggleScrollbarSlash}
                    toggleGenericToolOutput={handleToggleGenericToolOutputSlash}
                  status={
                    route().name === "session" && selectedSession()
                      ? snapshot()?.sessionStatus[selectedSession()!.id]?.type
                      : undefined
                  }
                  readyForReview={
                    selectedSession()
                      ? snapshot()?.sessionUiState[selectedSession()!.id]?.displayStatus === "needs_review"
                      : false
                  }
                  markSessionReviewed={markSessionReviewed}
                    pending={route().name === "new-session"}
                  loadOlderMessages={(cursor) =>
                    selectedSession()
                      ? runAction(() => loadOlderSessionMessages(selectedSession()!.id, cursor))
                      : Promise.resolve()
                  }
                    gui={client()}
                    sidePanelDirectory={sidePanelDirectoryForSession(selectedSession())}
                  />
            </Match>
            <Match when={route().name === "sessions"}>
              <SessionCollectionPage
                  sessions={visibleSessions()}
                projects={snapshot()?.projects ?? []}
                sessionStatus={snapshot()?.sessionStatus ?? {}}
                openSession={(sessionID) => setRoute({ name: "session", sessionID })}
                renameSession={(session) => void runAction(() => handleRenameSession(session))}
                moveSession={(session) => void runAction(() => handleMoveSession(session))}
                deleteSession={(session) => void runAction(() => handleDeleteSession(session))}
                sessionPinned={(sessionID) => pinnedSessionIDSet().has(sessionID)}
                toggleSessionPinned={toggleSessionPinned}
              />
            </Match>
            <Match when={route().name === "projects"}>
              <ProjectCollectionPage
                  snapshot={snapshot()}
                  sessionOrderState={sessionOrderState()}
                  projectID={activeProject()?.id}
                  openProject={(projectID) =>
                    setRoute(projectID ? { name: "projects", projectID } : { name: "projects" })
                  }
                  openSession={(sessionID) => setRoute({ name: "session", sessionID })}
                  openView={(viewID) => setRoute({ name: "views", viewID })}
                  openSwarm={(swarmID) => setRoute({ name: "swarms", swarmID })}
                  openWorkbenchProject={(projectID) => setRoute({ name: "workbench", projectID })}
                  createSession={(projectID, directory) =>
                    void runAction(() => handleCreateSession(projectID, directory))
                  }
                  createSwarm={(projectID) => void runAction(() => handleCreateSwarm(projectID))}
                  createProjectView={(projectID, sessionIDs) =>
                    void runAction(() => handleCreateProjectView(projectID, sessionIDs))
                  }
                createProject={() => void runAction(handleCreateProject)}
                  editProject={(projectID, currentName, folders) =>
                    void runAction(() => handleEditProject(projectID, currentName, folders))
                  }
                deleteProject={(projectID, name) => void runAction(() => handleDeleteProject(projectID, name))}
                moveProject={(projectID, offset) => void runAction(() => handleMoveProject(projectID, offset))}
                  reorderProject={(sourceID, targetID, placement) =>
                    void runAction(() => handleReorderProject(sourceID, targetID, placement))
                  }
                  sessionPinned={(sessionID) => pinnedSessionIDSet().has(sessionID)}
                  toggleSessionPinned={toggleSessionPinned}
              />
            </Match>
            <Match when={route().name === "swarms"}>
              {(() => {
                const current = route()
                return (
                  <SwarmsPage
                    snapshot={snapshot()}
                    swarmID={current.name === "swarms" ? current.swarmID : undefined}
                    openSwarm={(swarmID) => setRoute({ name: "swarms", swarmID })}
                    createSwarm={() => void runAction(handleCreateSwarm)}
                    editSwarm={(swarmID) => setRoute({ name: "swarm-create", swarmID })}
                    openSession={(sessionID) => setRoute({ name: "session", sessionID })}
                      assignTask={(swarmID, promptText) =>
                        void runAction(() => handleAssignSwarmTask(swarmID, promptText))
                      }
                    cancelSwarm={(swarmID) => void runAction(() => handleCancelSwarm(swarmID))}
                    deleteSwarm={(swarmID, name) => void runAction(() => handleDeleteSwarm(swarmID, name))}
                    refresh={() => void runAction(refresh)}
                  />
                )
              })()}
            </Match>
            <Match when={route().name === "swarm-create"}>
              {(() => {
                const current = route()
                  const swarm =
                    current.name === "swarm-create" && current.swarmID
                  ? snapshot()?.swarms.find((item) => item.id === current.swarmID)
                  : undefined
                return (
                  <SwarmEditorPage
                    projects={snapshot()?.projects ?? []}
                    providers={snapshot()?.providers ?? []}
                    agents={snapshot()?.agents ?? []}
                    swarm={swarm}
                      initialProjectID={current.name === "swarm-create" ? current.projectID : undefined}
                    selectedModel={selectedModel()}
                    save={(input) => void runAction(() => handleSaveSwarm(input))}
                    cancel={() => setRoute(swarm ? { name: "swarms", swarmID: swarm.id } : { name: "swarms" })}
                  />
                )
              })()}
            </Match>
            <Match when={route().name === "views"}>
              <ViewsManagerPage
                view={activeView()}
                views={snapshot()?.views ?? []}
                  snapshot={snapshot()}
                  sessions={visibleSessions()}
                projects={snapshot()?.projects ?? []}
                items={activeViewItems()}
                renderItem={renderViewPane}
                sidePanelOpen={viewSidePanelOpen()}
                toggleSidePanel={activeViewSessions().length > 0 ? toggleViewSidePanel : undefined}
                  sidePanel={
                  <Show when={viewSidePanelSession()}>
                    {(session) => (
                      <SessionSidePanel
                        open={viewSidePanelOpen()}
                        widthRatio={viewSidePanelWidthRatio()}
                        session={session()}
                        data={viewSessionData()[session().id] ?? EMPTY_SESSION_DATA}
                        providers={snapshot()?.providers ?? []}
                        mcp={snapshot()?.mcp ?? {}}
                        lsp={snapshot()?.lsp ?? []}
                        config={snapshot()?.config}
                        gui={client()}
                        directory={sidePanelDirectoryForSession(session())}
                        request={viewSidePanelRequest()}
                        contextOptions={viewSidePanelContextOptions()}
                        selectedContextID={session().id}
                        selectContext={setViewSidePanelSessionID}
                        startResize={startViewSidePanelResize}
                          close={() => setActiveViewSidePanelOpen(false)}
                      />
                    )}
                  </Show>
                  }
                openView={(viewID) => setRoute({ name: "views", viewID })}
                createView={() => void runAction(handleCreateView)}
                editView={(viewID) => setRoute({ name: "view-edit", viewID })}
                deleteView={(viewID, name) => void runAction(() => handleDeleteViewByID(viewID, name))}
                moveView={(viewID, offset) => void runAction(() => handleMoveView(viewID, offset))}
                  reorderViews={(viewIDs) => void runAction(() => handleReorderViews(viewIDs))}
                  viewPinned={(viewID) => pinnedViewIDSet().has(viewID)}
                  toggleViewPinned={toggleViewPinned}
              />
            </Match>
            <Match when={route().name === "view-edit"}>
              <ViewEditorPage
                view={editingView()}
                  sessions={visibleSessions()}
                projects={snapshot()?.projects ?? []}
                  save={handleSaveView}
                cancel={() => {
                  const view = editingView()
                  setRoute(view ? { name: "views", viewID: view.id } : { name: "views" })
                }}
              />
            </Match>
            <Match when={route().name === "plugins"}>
              <PluginsPage
                plugins={snapshot()?.plugins ?? []}
                guiPlugins={guiPlugins()}
                refresh={() => runAction(refreshPlugins)}
                install={(input) => runAction(() => handleInstallPlugin(input))}
                toggle={(plugin) => runAction(() => handleTogglePlugin(plugin))}
                installGuiPlugin={handleInstallGuiPlugin}
                toggleGuiPlugin={handleToggleGuiPlugin}
                removeGuiPlugin={handleRemoveGuiPlugin}
              />
            </Match>
            <Match when={route().name === "workbench"}>
                {(() => {
                  const current = route()
                  return (
                    current.name === "workbench" && (
              <WorkbenchPage
                gui={client()}
                snapshot={snapshot()}
                projects={snapshot()?.projects ?? []}
                        projectID={current.projectID}
                recentModels={recentModels()}
                selectedAgent={selectedAgent()}
                setSelectedAgent={setSelectedAgent}
                selectedModel={selectedModel()}
                setSelectedModel={(value) => {
                  setSelectedModel(value)
                  setSelectedVariant("")
                  if (value) rememberModel(value)
                }}
                selectedVariant={selectedVariant()}
                setSelectedVariant={setSelectedVariant}
                rememberModel={rememberModel}
                refresh={refresh}
                replyPermission={(request, reply) => void runAction(() => handlePermission(request, reply))}
                        replyQuestion={(request, answers) =>
                          void runAction(() => handleQuestionReply(request, answers))
                        }
                rejectQuestion={(request) => void runAction(() => handleQuestionReject(request))}
                abortSession={(sessionID) => void runAction(() => handleAbortSession(sessionID))}
                renameSession={(session) => void runAction(() => handleRenameSession(session))}
                moveSession={(session) => void runAction(() => handleMoveSession(session))}
                deleteSession={(session) => void runAction(() => handleDeleteSession(session))}
                        slashCommands={(session, data, restorePrompt) =>
                          sessionSlashCommands(session, { data, restorePrompt })
                        }
                concealCodeBlocks={concealTranscriptCodeBlocks()}
                showTimestamps={showTranscriptTimestamps()}
                showThinking={showTranscriptThinking()}
                showToolDetails={showTranscriptToolDetails()}
                showScrollbar={showTranscriptScrollbar()}
                showGenericToolOutput={showTranscriptGenericToolOutput()}
                toggleCodeConceal={handleToggleCodeConcealSlash}
                toggleTimestamps={handleToggleTimestampsSlash}
                toggleThinking={handleToggleThinkingSlash}
                toggleToolDetails={handleToggleToolDetailsSlash}
                toggleScrollbar={handleToggleScrollbarSlash}
                toggleGenericToolOutput={handleToggleGenericToolOutputSlash}
                sendToComposer={openWorkbenchPrompt}
                openDiff={() => setRoute({ name: "diff", mode: "git", sessionID: selectedSession()?.id })}
                openExternal={(url) => void globalThis.open(url, "_blank", "noopener")}
                askText={askText}
                confirm={confirm}
              />
                    )
                  )
                })()}
            </Match>
            <Match when={route().name === "diff"}>
              {(() => {
                const current = route()
                  const session =
                    current.name === "diff"
                      ? (snapshot()?.sessions.find((item) => item.id === current.sessionID) ?? selectedSession())
                  : selectedSession()
                  const mode = current.name === "diff" ? (current.mode ?? "git") : "git"
                return (
                  <DiffPage
                    mode={mode}
                    session={session}
                    sessions={visibleSessions()}
                    sessionUiState={snapshot()?.sessionUiState ?? {}}
                    setMode={(mode) => setRoute({ name: "diff", mode, sessionID: session?.id })}
                      selectSession={(sessionID) =>
                        setRoute({ name: "diff", mode: sessionID ? "last-turn" : "git", sessionID })
                      }
                      close={() =>
                        session ? setRoute({ name: "session", sessionID: session.id }) : setRoute({ name: "dashboard" })
                      }
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
                <CollectionPage
                  title="Settings"
                  count={snapshot()?.agents.length ?? 0}
                  description="Theme, provider, status, docs, debug, and safe GUI preferences are reserved here while settings parity is built out."
                />
            </Match>
          </Switch>
        </Show>
        </div>
      </main>
      <CommandPaletteModal
        open={commandPaletteOpen()}
        commands={paletteCommands()}
        close={() => setCommandPaletteOpen(false)}
        run={(command) => {
          setCommandPaletteOpen(false)
          void runAction(async () => {
            await command.run()
          })
        }}
      />
      <KeyboardHelpModal
        open={keyboardHelpOpen()}
        commands={paletteCommands()}
        close={() => setKeyboardHelpOpen(false)}
      />
      <DialogModal dialog={dialog()} close={() => setDialog(undefined)} />
    </div>
  )
}

function AppLoadingSkeleton() {
  return (
    <div class="page dashboard-page app-loading-skeleton" aria-label="Loading OpencodeX workspace" aria-busy="true">
      <OpencodeXLogo />
      <section class="dashboard-sections app-loading-sections">
        <AppLoadingSessionsPanel />
        <AppLoadingCardPanel title="Projects" kind="projects" />
        <AppLoadingCardPanel title="Swarms" kind="swarms" />
        <AppLoadingCardPanel title="Views" kind="views" />
      </section>
    </div>
  )
}

function AppLoadingSessionsPanel() {
  return (
    <DashboardSection title="Sessions" count={0} action="New" onAction={() => undefined}>
      <div class="dashboard-session-groups app-loading-panel" aria-hidden="true">
        {["Needs Feedback", "Ready For Review", "In Progress", "Inactive Sessions"].map((title, index) => (
          <section class="dashboard-session-bucket">
            <header>
              <button class="dashboard-bucket-toggle" aria-expanded={index !== 3} tabindex={-1}>
                <span class="app-loading-bucket-chevron" />
                <strong>{title}</strong>
              </button>
              <small>0</small>
            </header>
            <div class="dashboard-bucket-content" classList={{ collapsed: index === 3 }}>
              <div class="dashboard-card-grid compact">
                <AppLoadingStatusCard short={index === 1} />
              </div>
            </div>
          </section>
        ))}
      </div>
    </DashboardSection>
  )
}

function AppLoadingCardPanel(props: { title: string; kind: "projects" | "swarms" | "views" }) {
  return (
    <DashboardSection title={props.title} count={0} action="New" onAction={() => undefined}>
      <div class="dashboard-card-grid app-loading-panel" aria-hidden="true">
        {[0, 1, 2, 3].map((item) =>
          props.kind === "projects" ? (
            <AppLoadingProjectCard short={item === 2} />
          ) : props.kind === "views" ? (
            <AppLoadingStatusCard short={item === 1 || item === 3} />
          ) : (
            <AppLoadingPlainCard short={item === 1 || item === 3} />
          ),
        )}
      </div>
    </DashboardSection>
  )
}

function AppLoadingProjectCard(props: { short?: boolean }) {
  return (
    <article class="dashboard-item-card project-card app-loading-card">
      <div class="dashboard-project-open">
        <strong class="app-loading-line app-loading-title" data-short={props.short ? "true" : undefined} />
        <span class="app-loading-line app-loading-detail" />
        <small class="project-folder-label app-loading-line app-loading-meta" />
      </div>
      <div class="row-actions">
        <span class="app-loading-control" />
        <span class="app-loading-icon-control" />
        <span class="app-loading-icon-control" />
      </div>
    </article>
  )
}

function AppLoadingPlainCard(props: { short?: boolean }) {
  return (
    <article class="dashboard-item-card app-loading-card">
      <div>
        <strong class="app-loading-line app-loading-title" data-short={props.short ? "true" : undefined} />
        <span class="app-loading-line app-loading-detail" />
      </div>
      <footer>
        <small class="app-loading-line app-loading-meta" />
      </footer>
    </article>
  )
}

function AppLoadingStatusCard(props: { short?: boolean }) {
  return (
    <article class="dashboard-item-card dashboard-status-card interactive status-dormant app-loading-card">
      <div class="dashboard-card-open">
        <div>
          <strong class="app-loading-line app-loading-title" data-short={props.short ? "true" : undefined} />
        </div>
        <footer>
          <small class="app-loading-line app-loading-meta" />
        </footer>
      </div>
      <span class="pin-toggle app-loading-pin" />
    </article>
  )
}

function clampViewSidePanelWidthRatio(value: number) {
  return Math.max(0.28, Math.min(0.7, value))
}

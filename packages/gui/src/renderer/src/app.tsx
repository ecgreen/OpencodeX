import type { JSX } from "solid-js"
import type { Agent, AssistantMessage, GlobalEvent, Message, OpencodeXSessionState, OpencodeXView, Part, PermissionRequest, Provider, QuestionAnswer, QuestionRequest, Session, SnapshotFileDiff, Todo } from "@opencode-ai/sdk/v2/client"
import { CLIENT_SESSION_SYNC_INTERVAL_MS } from "@opencode-ai/sdk/v2/client-sync"
import type { GuiClient } from "./lib/client"
import type { GuiSnapshot, MessageBundle, SessionCardSnapshot, SessionData } from "./lib/store"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
import { Mark } from "@opencode-ai/ui/logo"
import { Markdown } from "@opencode-ai/ui/markdown"
import { CodeBlock } from "@opencode-ai/ui/code-block"
import { File as FileDiffView } from "@opencode-ai/ui/file"
import { connectGuiClient } from "./lib/client"
import { compactPath, formatRelative, title } from "./lib/format"
import { markMessageTailDetached, prependOlderMessages, trimToLiveTail, type MessageWindow } from "./lib/message-window"
import { displayMessageText } from "./lib/message-text"
import { deriveSessionStatus, deriveViewStatus, reconcileSessionUiState, sessionStatusLabel, type DerivedSessionStatus } from "./lib/session-status"
import { syncViewSessionsInParallel, viewSessionsInOrder } from "./lib/view-sync"
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

type DialogState =
  | { type: "text"; title: string; message?: string; value?: string; multiline?: boolean; resolve: (value: string | undefined) => void }
  | { type: "confirm"; title: string; message: string; confirm?: string; resolve: (value: boolean) => void }
  | { type: "choice"; title: string; message?: string; options: ChoiceOption[]; resolve: (value: string | undefined) => void }

type ChoiceOption = { value: string; title: string; description?: string; meta?: string }
type PaletteCommand = {
  name: string
  title: string
  category: string
  description?: string
  shortcut?: string
  suggested?: boolean
  disabled?: string
  run: () => void | Promise<void>
}
type PaletteCommandGroup = { title: string; start: number; commands: PaletteCommand[] }

const NAV_ITEMS = [
  { name: "dashboard", label: "Dashboard", icon: "dashboard", shortcut: "Ctrl+D", description: "Workspace command center" },
  { name: "sessions", label: "Sessions", icon: "session", shortcut: "Ctrl+1", description: "Resume and monitor agent sessions" },
  { name: "projects", label: "Projects", icon: "folder", shortcut: "Ctrl+2", description: "Project groups and folders" },
  { name: "views", label: "Views", icon: "views", shortcut: "Ctrl+4", description: "Multi-session views" },
  { name: "swarms", label: "Swarms", icon: "swarm", shortcut: "Ctrl+3", description: "Coordinate AI team runs" },
  { name: "status", label: "Status", icon: "activity", shortcut: "Ctrl+5", description: "Provider and runtime health" },
  { name: "settings", label: "Settings", icon: "settings", shortcut: "Ctrl+6", description: "Preferences and provider setup" },
] as const

const GLOBAL_SHORTCUT_KEYS = new Set(["b", "/", "n", "p", "r", "d", "1", "2", "3", "4", "5", "6"])
const EMPTY_SESSION_DATA: SessionData = { messages: [], todos: [], diffs: [] }
const SESSION_MESSAGE_PAGE_LIMIT = 128
const VIEW_MESSAGE_PAGE_LIMIT = 48
const SESSION_MESSAGE_WINDOW: MessageWindow = { count: 128, budget: 100_000 }
const VIEW_MESSAGE_WINDOW: MessageWindow = { count: 48, budget: 28_000 }
const LIVE_SYNC_INTERVAL_MS = CLIENT_SESSION_SYNC_INTERVAL_MS
const SNAPSHOT_SYNC_INTERVAL_MS = 5_000
const SIDEBAR_ACTIVE_WINDOW_MS = 15 * 60 * 1000
const RECENT_SESSION_WINDOW_MS = 4 * 60 * 60 * 1000
const SEEN_EVENT_ID_LIMIT = 2_000
const PROJECT_RECENT_SESSION_LIMIT = 4
const PENDING_SESSION_ID = "pending:new-session"
const TUI_COMMAND_SHORTCUTS: Record<string, string> = {
  "session.list": "Ctrl+X L",
  "session.new": "Ctrl+X N",
  "opencodex.dashboard.open": "Ctrl+L",
  "opencodex.project.create": "Ctrl+X P",
  "opencodex.session.manage": "Ctrl+O",
  "opencodex.project.manage": "Ctrl+U",
  "opencodex.session.new_project": "Ctrl+N",
  "opencodex.sidebar.toggle": "Ctrl+S",
  "opencodex.sidebar.focus": "Ctrl+X F",
  "opencodex.swarm.list": "Super+Shift+D / Ctrl+X W",
  "opencodex.swarm.open": "Super+Shift+O",
  "opencodex.swarm.create": "Super+Shift+N",
  "opencodex.swarm.task": "Super+Shift+T",
  "opencodex.view.create": "Ctrl+X V",
  "model.list": "Ctrl+X M",
  "agent.list": "Ctrl+X A",
  "variant.cycle": "Ctrl+T",
  "opencode.status": "Ctrl+X S",
  "theme.switch": "Ctrl+X T",
  "app.exit": "Ctrl+C / Ctrl+D / Ctrl+X Q",
}
const COMMAND_PALETTE_PINNED_CATEGORIES = ["OpencodeX", "Swarms", "Views"]

type RailSectionName = "projects" | "recent" | "swarms" | "views"
type DragTarget = { type: "project"; id: string } | { type: "view"; id: string }
type LayoutNode = number | { direction: "row" | "column"; children: LayoutNode[] }
type PendingViewSession = {
  id: string
  projectID?: string
  projectLabel?: string
  directory?: string
}
type ViewItem = { kind: "session"; session: Session } | { kind: "pending"; slot: PendingViewSession }

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
  const [dragTarget, setDragTarget] = createSignal<DragTarget>()
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

  const selectedSession = createMemo(() => {
    const current = route()
    if (current.name === "new-session") {
      return pendingSession(current.directory ?? snapshot()?.projects[0]?.folders[0]?.path ?? client()?.directory ?? "")
    }
    if (current.name !== "session") return
    return snapshot()?.sessions.find((session) => session.id === current.sessionID)
  })
  const activeSessionID = createMemo(() => {
    const current = route()
    if (current.name !== "session") return ""
    return current.sessionID
  })
  const activeSessionRouteKey = createMemo(() => {
    const current = route()
    if (current.name === "session") return current.sessionID
    if (current.name === "new-session") return `new:${current.projectID ?? ""}:${current.directory ?? ""}`
    return ""
  })
  const activeSessionData = createMemo(() => sessionDataSessionID() === activeSessionID() ? sessionData() : EMPTY_SESSION_DATA)
  const activeSessionLoading = createMemo(() => Boolean(activeSessionID()) && sessionDataSessionID() !== activeSessionID())
  const activeView = createMemo(() => {
    const current = route()
    if (current.name !== "views") return
    return (snapshot()?.views ?? []).find((view) => view.id === current.viewID) ?? snapshot()?.views[0]
  })
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
  const activeViewFocusedSessionID = createMemo(() => {
    const local = focusedViewSessionID()
    if (local && activeViewItems().some((item) => viewItemID(item) === local)) return local
    const persisted = activeView()?.focusedSessionID
    if (persisted && activeViewItems().some((item) => viewItemID(item) === persisted)) return persisted
    const first = activeViewItems()[0]
    return first ? viewItemID(first) : ""
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
  const visibleSessions = createMemo(() => tuiSidebarSessions(snapshot()))
  const recentSessions = createMemo(() => visibleSessions().filter((session) => isRecentSessionUpdate(session.time.updated)))

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
    if (!options.force && sessionDataSessionID() === sessionID && session && sessionDataLoadedTime >= session.time.updated) return
    const requestID = ++sessionSyncRequestID
    setLoadingSessionID(sessionID)
    try {
      const data = trimToLiveTail(await loadSession(gui, sessionID, session?.directory, { messageLimit: SESSION_MESSAGE_PAGE_LIMIT, messageRenderBudget: SESSION_MESSAGE_WINDOW.budget }), SESSION_MESSAGE_WINDOW)
      if (requestID !== sessionSyncRequestID) return
      const current = route()
      if (current.name !== "session" || current.sessionID !== sessionID) return
      setSessionData(data)
      setSessionDataSessionID(sessionID)
      sessionDataLoadedTime = session?.time.updated ?? Date.now()
    } catch (cause) {
      if (requestID === sessionSyncRequestID) {
        setNotice(cause instanceof Error ? cause.message : String(cause))
        setSessionData(EMPTY_SESSION_DATA)
        setSessionDataSessionID(sessionID)
      }
    } finally {
      if (requestID === sessionSyncRequestID && loadingSessionID() === sessionID) setLoadingSessionID("")
    }
  }

  async function syncViewSession(session: Session, options: { force?: boolean } = {}) {
    const gui = client()
    if (!gui) return
    if (!options.force && viewSessionData()[session.id] && (viewSessionLoadedTimes()[session.id] ?? 0) >= session.time.updated) return
    const loadKey = `${session.id}\n${session.directory ?? ""}\n${session.time.updated}`
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
    setSnapshot((current) => {
      if (!current) return current
      const next = status.type === "idle"
        ? {
          ...current,
          sessionStatus: Object.fromEntries(Object.entries(current.sessionStatus).filter(([id]) => id !== sessionID)),
        }
        : { ...current, sessionStatus: { ...current.sessionStatus, [sessionID]: status } }
      return reconcileSessionUiState(next, sessionID)
    })
  }

  function applySessionStateEvent(sessionID: string, state: OpencodeXSessionState) {
    setSnapshot((current) => {
      if (!current) return current
      const existing = current.sessionUiState[sessionID]
      return reconcileSessionUiState({
        ...current,
        sessionUiState: {
          ...current.sessionUiState,
          [sessionID]: {
            sessionID,
            ...(state.seenAt === undefined ? {} : { seenAt: state.seenAt }),
            ...(state.reviewedAt === undefined ? {} : { reviewedAt: state.reviewedAt }),
            reviewedFiles: state.reviewedFiles,
            displayStatus: existing?.displayStatus ?? "idle",
            updated: existing?.updated ?? false,
          },
        },
      }, sessionID)
    })
  }

  async function syncLiveServerState() {
    const gui = client()
    if (!gui || liveSyncRunning) return
    liveSyncRunning = true
    try {
      const now = Date.now()
      const current = route()
      if (current.name === "session") {
        const session = snapshot()?.sessions.find((item) => item.id === current.sessionID)
        const data = sessionDataSessionID() === current.sessionID ? sessionData() : undefined
        if (sessionFollowingBottom(current.sessionID) && (!session || shouldPollVisibleSession(session, data))) await syncSession(current.sessionID, { force: true })
      }
      if (current.name === "views") {
        await Promise.all(
          activeViewSessions()
            .filter((session) => sessionFollowingBottom(session.id))
            .filter((session) => shouldPollVisibleSession(session, viewSessionData()[session.id]))
            .map((session) => syncViewSession(session, { force: true })),
        )
      }
      if (now - lastSnapshotSync >= SNAPSHOT_SYNC_INTERVAL_MS) {
        lastSnapshotSync = now
        await refreshSessionCards()
      }
    } finally {
      liveSyncRunning = false
    }
  }

  function shouldPollVisibleSession(session: Session, data?: SessionData) {
    const status = snapshot()?.sessionStatus[session.id]?.type
    if (status === "busy" || status === "retry") return true
    return data ? isLikelyActiveSession(session, data) : false
  }

  function applySessionDataEvent(event: GlobalEvent) {
    if (!isSessionDataEvent(event)) return false
    const sessionIDs = sessionDataEventSessionIDs(event)

    const current = route()
    if (current.name === "session" && sessionIDs.has(current.sessionID)) {
      const sessionID = current.sessionID
      setSessionData((data) =>
        patchBoundedSessionData(
          sessionDataSessionID() === sessionID ? data : EMPTY_SESSION_DATA,
          event,
          SESSION_MESSAGE_WINDOW,
          sessionFollowingBottom(sessionID),
        )
      )
      setSessionDataSessionID(sessionID)
      sessionDataLoadedTime = Date.now()
    }

    if (current.name === "views") {
      const visible = activeViewSessions().filter((session) => sessionIDs.has(session.id))
      if (visible.length > 0) {
        setViewSessionData((data) => {
          const next = { ...data }
          for (const session of visible) {
            next[session.id] = patchBoundedSessionData(
              next[session.id] ?? EMPTY_SESSION_DATA,
              event,
              VIEW_MESSAGE_WINDOW,
              sessionFollowingBottom(session.id),
            )
          }
          return next
        })
        setViewSessionLoadedTimes((data) => {
          const next = { ...data }
          const now = Date.now()
          for (const session of visible) next[session.id] = now
          return next
        })
      }
    }

    return true
  }

  function sessionDataEventSessionIDs(event: GlobalEvent) {
    const sessionID = eventSessionID(event)
    if (sessionID) return new Set([sessionID])

    const aggregateID = eventAggregateID(event)
    if (aggregateID) {
      const current = route()
      if (current.name === "session" && current.sessionID === aggregateID) return new Set([aggregateID])
      if (current.name === "views" && activeViewSessions().some((session) => session.id === aggregateID)) return new Set([aggregateID])
    }

    const messageID = eventMessageID(event)
    if (!messageID) return new Set<string>()

    const result = new Set<string>()
    const loadedSessionID = sessionDataSessionID()
    if (loadedSessionID && sessionData().messages.some((bundle) => bundle.info.id === messageID)) result.add(loadedSessionID)

    for (const [viewSessionID, data] of Object.entries(viewSessionData())) {
      if (data.messages.some((bundle) => bundle.info.id === messageID)) result.add(viewSessionID)
    }

    return result
  }

  function applySnapshotEvent(event: GlobalEvent) {
    if (!isSnapshotPatchEvent(event)) return false
    setSnapshot((current) => current ? patchSnapshot(current, event) : current)
    return true
  }

  function handleGlobalEvent(event: GlobalEvent) {
    if (!rememberGlobalEvent(event)) return
    const kind = eventKind(event)
    const properties = eventData(event)
    const sessionID = eventSessionID(event)

    if (kind === "session.status" && properties) {
      const statusEvent = properties as { sessionID: string; status: NonNullable<GuiSnapshot["sessionStatus"][string]> }
      applySessionStatusEvent(statusEvent.sessionID, statusEvent.status)
      if (statusEvent.status.type === "idle") syncVisibleSession(statusEvent.sessionID)
      return
    }

    if (kind === "session.idle" && sessionID) {
      applySessionStatusEvent(sessionID, { type: "idle" })
      syncVisibleSession(sessionID)
      return
    }

    if (kind === "opencodex.session_state.updated" && properties) {
      applySessionStateEvent((properties as { sessionID: string; state: OpencodeXSessionState }).sessionID, (properties as { sessionID: string; state: OpencodeXSessionState }).state)
      return
    }

    if (applySessionDataEvent(event) || applySnapshotEvent(event) || isHighFrequencySessionEvent(event)) return

    void refresh()
    if (sessionID) syncVisibleSession(sessionID)
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
    const current = route()
    if (current.name === "session" && sessionID === current.sessionID && sessionFollowingBottom(sessionID)) void syncSession(current.sessionID, { force: true })
    if (current.name === "views" && activeViewSessions().some((session) => session.id === sessionID)) {
      const session = activeViewSessions().find((item) => item.id === sessionID)
      if (session && sessionFollowingBottom(sessionID)) void syncViewSession(session, { force: true })
    }
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

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement
      const key = event.key.toLowerCase()
      if (event.key === "Escape" && !dialog()) {
        const session = selectedSession()
        const status = session ? snapshot()?.sessionStatus[session.id]?.type : undefined
        if (session && (status === "busy" || status === "retry")) {
          event.preventDefault()
          void runAction(() => handleAbortSession(session.id))
          return
        }
      }
      if (event.key === "Escape" && notice()) {
        event.preventDefault()
        setNotice("")
        return
      }
      if (!(event.ctrlKey || event.metaKey)) return
      if (key === "p") {
        event.preventDefault()
        if (!dialog()) setCommandPaletteOpen(true)
        return
      }
      if (dialog() || editing) {
        if (GLOBAL_SHORTCUT_KEYS.has(key)) event.preventDefault()
        return
      }
      if (key === "b") {
        event.preventDefault()
        setRailCollapsed((value) => !value)
        return
      }
      if (key === "/") {
        event.preventDefault()
        document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus()
        return
      }
      if (key === "n") {
        event.preventDefault()
        void runAction(() => handleCreateSession())
        return
      }
      if (key === "r") {
        event.preventDefault()
        void runAction(refresh)
        return
      }
      const targetRoute = key === "d" ? "dashboard" : key === "1" ? "sessions" : key === "2" ? "projects" : key === "3" ? "swarms" : key === "4" ? "views" : key === "5" ? "status" : key === "6" ? "settings" : undefined
      if (!targetRoute) return
      event.preventDefault()
      setRoute({ name: targetRoute })
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
    setSelectionSessionID(session.id)
    setSelectedAgent(session.agent ?? "")
    setSelectedModel(session.model ? modelValue(session.model.providerID, session.model.id) : recentModels()[0] ?? firstAvailableModel(snapshot()?.providers ?? []) ?? "")
    setSelectedVariant(session.model?.variant ?? "")
  })

  createEffect(() => {
    if (selectedModel()) return
    const model = recentModels()[0] ?? firstAvailableModel(snapshot()?.providers ?? [])
    if (model) setSelectedModel(model)
  })

  async function submitPrompt(event: SubmitEvent, value?: string) {
    event.preventDefault()
    const gui = client()
    const current = route()
    const session = selectedSession()
    const text = (value ?? prompt()).trim()
    if (!gui || !session || !text) return
    if (selectedPermissions().length > 0 || selectedQuestions().length > 0) return
    const model = parseModelValue(selectedModel())
    setPrompt("")
    setLoadingSessionID(session.id)
    const created = current.name === "new-session"
      ? await createSession(gui, {
          projectID: current.projectID,
          directory: session.directory,
        })
      : undefined
    const target = created?.data ?? session
    await sendPrompt(gui, target.id, text, {
      directory: target.directory,
      agent: selectedAgent() || undefined,
      model,
      variant: selectedVariant() || undefined,
    })
    if (selectedModel()) rememberModel(selectedModel())
    await syncSession(target.id, { force: true })
    await refresh()
    if (created?.data?.id) setRoute({ name: "session", sessionID: created.data.id })
  }

  async function submitViewPrompt(event: SubmitEvent, item: ViewItem, value: string) {
    event.preventDefault()
    const gui = client()
    const draftID = viewItemID(item)
    const text = value.trim()
    if (!gui || !text) return
    const draftSession = viewItemSession(item, gui.directory)
    const model = parseModelValue(viewModelValue(draftSession))
    setViewLoadingSessions((current) => ({ ...current, [draftID]: true }))
    const pendingDirectory = item.kind === "pending" ? item.slot.directory ?? gui.directory : undefined
    if (item.kind === "pending" && !pendingDirectory) return alert("No directory available for this pending view session.")
    const created = item.kind === "pending"
      ? await createSession(gui, {
          projectID: item.slot.projectID,
          directory: pendingDirectory!,
        })
      : undefined
    const target = created?.data ?? draftSession
    if (item.kind === "pending") {
      const view = activeView()
      if (!created?.data || !view) return
      const pending = pendingViewSessions(view).filter((slot) => slot.id !== item.slot.id)
      await updateView(gui, view.id, {
        sessionIDs: [...view.sessionIDs.filter((sessionID) => sessionID !== created.data!.id), created.data.id],
        focusedSessionID: created.data.id,
        metadata: metadataWithPendingSessions(view.metadata, pending),
      }).catch(async (error: Error) => {
        await deleteSession(gui, created.data!.id).catch(() => undefined)
        throw error
      })
      setFocusedViewSessionID(created.data.id)
    }
    await sendPrompt(gui, target.id, text, {
      directory: target.directory,
      agent: viewAgentValue(draftSession) || undefined,
      model,
      variant: viewVariantValue(draftSession) || undefined,
    })
    if (viewModelValue(draftSession)) rememberModel(viewModelValue(draftSession))
    await syncViewSession(target, { force: true })
    await refresh()
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
    setSnapshot((current) => {
      if (!current) return current
      const state = current.sessionUiState[sessionID]
      if ((state?.seenAt ?? 0) >= time && (state?.reviewedAt ?? 0) >= time) return current
      return reconcileSessionUiState({
        ...current,
        sessionUiState: {
          ...current.sessionUiState,
          [sessionID]: {
            sessionID,
            seenAt: Math.max(time, state?.seenAt ?? 0),
            reviewedAt: Math.max(time, state?.reviewedAt ?? 0),
            reviewedFiles: state?.reviewedFiles ?? [],
            displayStatus: state?.displayStatus ?? "idle",
            updated: state?.updated ?? false,
          },
        },
      }, sessionID)
    })
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

  function sidebarSessionActive(sessionID: string) {
    return activeSessionID() === sessionID
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
    if (!gui || projects.length === 0) return alert("Create or load a project before moving a session.")
    const projectID = await chooseProjectID(projects)
    if (!projectID) return
    if (!(await confirm({ title: "Move Session", message: `Move "${session.title}" to this project?\n\n${projectID}`, confirm: "Move" }))) return
    await moveSession(gui, session.id, projectID)
    await refresh()
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
    const providers = snapshot()?.providers ?? []
    const options = modelPickerOptions(providers)
    if (options.length === 0) return alert("No models available.")
    const value = await askChoice({
      title: "Switch Model",
      message: "Choose the model used for the active composer.",
      options: options.map((option) => ({
        value: modelValue(option.provider.id, option.model.id),
        title: option.model.name ?? option.model.id,
        description: option.provider.name,
        meta: isFreeOpencodeModel(option.provider, option.model) ? "Free" : undefined,
      })),
    })
    if (!value) return
    setSelectedModel(value)
    setSelectedVariant("")
    rememberModel(value)
  }

  async function handleSwitchAgent() {
    const agents = (snapshot()?.agents ?? []).filter((agent) => !agent.hidden && agent.mode !== "subagent")
    if (agents.length === 0) return alert("No agents available.")
    const agent = await askChoice({
      title: "Switch Agent",
      message: "Choose the agent used for the active composer.",
      options: agents.map((item) => ({
        value: item.name,
        title: item.name,
        description: item.description,
        meta: item.mode,
      })),
    })
    if (agent) setSelectedAgent(agent)
  }

  async function handleSwitchVariant() {
    const variants = selectedModelVariants(snapshot()?.providers ?? [], selectedModel())
    if (variants.length === 0) return alert("The selected model does not expose variants.")
    const variant = await askChoice({
      title: "Switch Model Variant",
      message: "Choose the model variant used for the active composer.",
      options: [
        { value: "", title: "Default", description: "Use the provider default variant" },
        ...variants.map((item) => ({ value: item, title: item })),
      ],
    })
    if (variant !== undefined) setSelectedVariant(variant)
  }

  function cycleVariant() {
    const variants = selectedModelVariants(snapshot()?.providers ?? [], selectedModel())
    if (variants.length === 0) return alert("The selected model does not expose variants.")
    const options = ["", ...variants]
    const index = options.indexOf(selectedVariant())
    setSelectedVariant(options[index >= 0 ? (index + 1) % options.length : 1])
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
    const message = reply === "reject" ? await askText({ title: "Reject Permission", message: "Optional feedback for the agent" }) : undefined
    if (reply === "always" && !(await confirm({ title: "Always Allow", message: request.always.join("\n") || request.permission, confirm: "Always Allow" }))) return
    await replyPermission(gui, request.id, reply, message, snapshot()?.sessions.find((session) => session.id === request.sessionID)?.directory)
    await refresh()
  }

  async function handleQuestionReply(request: QuestionRequest, answers: QuestionAnswer[]) {
    const gui = client()
    if (!gui) return
    await replyQuestion(gui, request.id, answers, snapshot()?.sessions.find((session) => session.id === request.sessionID)?.directory)
    await refresh()
  }

  async function handleQuestionReject(request: QuestionRequest) {
    const gui = client()
    if (!gui) return
    await rejectQuestion(gui, request.id, snapshot()?.sessions.find((session) => session.id === request.sessionID)?.directory)
    await refresh()
  }

  async function chooseFolder(fallback: string) {
    const selected = await window.opencodex?.folder()
    if (selected) return selected
    return fallback || undefined
  }

  async function handleCreateProject() {
    const gui = client()
    if (!gui) return
    const directory = await chooseFolder(gui.directory || ".")
    if (!directory) return
    const name = directory.split(/[\\/]/).filter(Boolean).at(-1) ?? "New Project"
    const validation = await validateProjectFolders(gui, { folders: [directory] })
    if (validation.data && !validation.data.valid) {
      alert(validation.data.folders.map((folder) => folder.message ?? `${folder.input} is invalid`).join("\n"))
      return
    }
    await createProject(gui, { name, directory })
    await refresh()
  }

  async function handleRenameProject(projectID: string, current?: string) {
    const gui = client()
    if (!gui) return
    const name = (await askText({ title: "Rename Project", value: current ?? "" }))?.trim()
    if (!name) return
    await renameProject(gui, projectID, name)
    await refresh()
  }

  async function handleEditProjectFolders(projectID: string, folders: string[]) {
    const gui = client()
    if (!gui) return
    const input = await askText({ title: "Project Folders", message: "One folder per line", value: folders.join("\n"), multiline: true })
    if (!input) return
    const next = input.split(/\r?\n/).map((folder) => folder.trim()).filter(Boolean)
    if (next.length === 0) return
    const validation = await validateProjectFolders(gui, { projectID, folders: next })
    if (validation.data && !validation.data.valid) {
      alert(validation.data.folders.map((folder) => folder.message ?? `${folder.input} is invalid`).join("\n"))
      return
    }
    await updateProjectFolders(gui, projectID, next)
    await refresh()
  }

  async function handleDeleteProject(projectID: string, name: string) {
    const gui = client()
    if (!gui) return
    if (!(await confirm({ title: "Delete Project", message: `Delete OpencodeX project grouping "${name}"?\n\nThis removes the GUI/TUI project grouping.`, confirm: "Delete" }))) return
    await deleteProject(gui, projectID)
    await refresh()
  }

  async function handleCreateSession(projectID?: string, directory?: string) {
    const gui = client()
    if (!gui) return
    const target = directory ?? snapshot()?.projects[0]?.folders[0]?.path ?? gui.directory
    if (!target) return
    setPrompt("")
    setRoute({ name: "new-session", projectID, directory: target })
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus())
  }

  async function handleCreateSwarm() {
    const gui = client()
    const projects = snapshot()?.projects ?? []
    if (!gui || projects.length === 0) return alert("Create or load a project before creating a swarm.")
    const projectID = await chooseProjectID(projects)
    if (!projectID) return
    await createSwarm(gui, {
      projectID,
      title: "New swarm",
      prompt: "",
    })
    await refresh()
    setRoute({ name: "swarms" })
  }

  async function handleCreateView() {
    const gui = client()
    const sessions = snapshot()?.sessions ?? []
    if (!gui || sessions.length === 0) return alert("Create or load at least one session before creating a view.")
    const sessionIDs = await chooseSessionIDs(sessions)
    if (sessionIDs.length === 0) return
    await createView(gui, {
      title: "New view",
      sessionIDs,
    })
    await refresh()
    setRoute({ name: "views" })
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
    if (!source || source.type !== "project" || source.id === targetID) return
    const projectIDs = moveRelative((snapshot()?.projects ?? []).map((project) => project.id), source.id, targetID, placement)
    const gui = client()
    if (!gui || projectIDs.length === 0) return
    await reorderProjects(gui, projectIDs)
    await refresh()
  }

  async function handleDropView(targetID: string, placement: "before" | "after") {
    const source = dragTarget()
    setDragTarget(undefined)
    if (!source || source.type !== "view" || source.id === targetID) return
    const viewIDs = moveRelative((snapshot()?.views ?? []).map((view) => view.id), source.id, targetID, placement)
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

  function startDrag(event: DragEvent, target: DragTarget) {
    setDragTarget(target)
    event.dataTransfer?.setData("text/plain", target.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
  }

  function allowDrop(event: DragEvent) {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
  }

  const paletteCommands = createMemo<PaletteCommand[]>(() => [
    {
      name: "session.list",
      title: "Switch session",
      category: "Session",
      description: `${visibleSessions().length} available sessions`,
      suggested: visibleSessions().length > 0,
      run: handleSwitchSession,
    },
    {
      name: "session.new",
      title: "New session",
      category: "Session",
      suggested: route().name === "session",
      run: () => handleCreateSession(),
    },
    {
      name: "opencodex.dashboard.open",
      title: "Open operations dashboard",
      category: "OpencodeX",
      suggested: true,
      run: () => { setRoute({ name: "dashboard" }) },
    },
    {
      name: "opencodex.project.create",
      title: "Create project",
      category: "OpencodeX",
      suggested: true,
      run: handleCreateProject,
    },
    {
      name: "opencodex.session.new_project",
      title: "New session in project",
      category: "OpencodeX",
      suggested: true,
      run: async () => {
        const projects = snapshot()?.projects ?? []
        if (projects.length === 0) return alert("Create or load a project before creating a project session.")
        const projectID = await chooseProjectID(projects)
        const project = projects.find((item) => item.id === projectID)
        if (project) await handleCreateSession(project.id, project.folders[0]?.path)
      },
    },
    {
      name: "opencodex.session.manage",
      title: "Manage sessions",
      category: "OpencodeX",
      run: () => { setRoute({ name: "sessions" }) },
    },
    {
      name: "opencodex.project.manage",
      title: "Manage projects",
      category: "OpencodeX",
      run: () => { setRoute({ name: "projects" }) },
    },
    {
      name: "opencodex.sidebar.toggle",
      title: "Toggle sidebar",
      category: "OpencodeX",
      suggested: true,
      run: () => { setRailCollapsed((prev) => !prev) },
    },
    {
      name: "opencodex.sidebar.focus",
      title: "Focus sidebar",
      category: "OpencodeX",
      suggested: true,
      run: () => {
        setRailCollapsed(false)
        requestAnimationFrame(() => document.querySelector<HTMLElement>(".rail button")?.focus())
      },
    },
    {
      name: "opencodex.swarm.list",
      title: "Show swarms on dashboard",
      category: "Swarms",
      suggested: true,
      run: () => { setRoute({ name: "swarms" }) },
    },
    {
      name: "opencodex.swarm.open",
      title: "Open swarm",
      category: "Swarms",
      suggested: true,
      run: () => { setRoute({ name: "swarms" }) },
    },
    {
      name: "opencodex.swarm.create",
      title: "Create swarm",
      category: "Swarms",
      suggested: true,
      run: handleCreateSwarm,
    },
    {
      name: "opencodex.swarm.task",
      title: "New swarm task",
      category: "Swarms",
      suggested: true,
      disabled: "GUI swarm task picker is not implemented yet.",
      run: () => {},
    },
    {
      name: "opencodex.view.open",
      title: "Open view",
      category: "Views",
      suggested: true,
      run: () => { setRoute({ name: "views" }) },
    },
    {
      name: "opencodex.view.create",
      title: "Create view",
      category: "Views",
      suggested: true,
      run: handleCreateView,
    },
    {
      name: "opencodex.view.edit",
      title: "Edit view",
      category: "Views",
      suggested: true,
      disabled: "GUI view editing is not implemented yet.",
      run: () => {},
    },
    {
      name: "opencodex.view.delete",
      title: "Delete view",
      category: "Views",
      suggested: true,
      disabled: "GUI view deletion is not implemented yet.",
      run: () => {},
    },
    {
      name: "workspace.copy_path",
      title: "Copy worktree path",
      category: "Workspace",
      description: selectedSession()?.directory || client()?.directory,
      run: copyWorkspacePath,
    },
    {
      name: "workspace.list",
      title: "Manage workspaces",
      category: "Workspace",
      disabled: "GUI workspace management is not implemented yet.",
      run: () => {},
    },
    {
      name: "model.list",
      title: "Switch model",
      category: "Agent",
      suggested: true,
      run: handleSwitchModel,
    },
    {
      name: "agent.list",
      title: "Switch agent",
      category: "Agent",
      run: handleSwitchAgent,
    },
    {
      name: "mcp.list",
      title: "Toggle MCPs",
      category: "Agent",
      disabled: "GUI MCP toggles are not implemented yet.",
      run: () => {},
    },
    {
      name: "variant.cycle",
      title: "Variant cycle",
      category: "Agent",
      run: cycleVariant,
    },
    {
      name: "variant.list",
      title: "Switch model variant",
      category: "Agent",
      disabled: selectedModelVariants(snapshot()?.providers ?? [], selectedModel()).length === 0 ? "The selected model does not expose variants." : undefined,
      run: handleSwitchVariant,
    },
    {
      name: "provider.connect",
      title: "Connect provider",
      category: "Provider",
      disabled: "GUI provider connection flow is not implemented yet.",
      run: () => {},
    },
    {
      name: "console.org.switch",
      title: "Switch org",
      category: "Provider",
      disabled: "GUI console org switching is not implemented yet.",
      run: () => {},
    },
    {
      name: "opencode.status",
      title: "View status",
      category: "System",
      run: () => { setRoute({ name: "status" }) },
    },
    {
      name: "theme.switch",
      title: "Switch theme",
      category: "System",
      disabled: "GUI theme picker is not implemented yet.",
      run: () => {},
    },
    {
      name: "theme.switch_mode",
      title: "Switch theme mode",
      category: "System",
      disabled: "GUI theme mode switching is not implemented yet.",
      run: () => {},
    },
    {
      name: "theme.mode.lock",
      title: "Lock theme mode",
      category: "System",
      disabled: "GUI theme mode locking is not implemented yet.",
      run: () => {},
    },
    {
      name: "help.show",
      title: "Help",
      category: "System",
      run: showHelp,
    },
    {
      name: "docs.open",
      title: "Open docs",
      category: "System",
      run: () => { window.open("https://opencode.ai/docs", "_blank", "noopener,noreferrer") },
    },
    {
      name: "app.exit",
      title: "Exit the app",
      category: "System",
      run: () => void window.opencodex?.window("close"),
    },
    {
      name: "app.debug",
      title: "Toggle debug panel",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.console",
      title: "Toggle console",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.heap_snapshot",
      title: "Write heap snapshot",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "terminal.title.toggle",
      title: "Toggle terminal title",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.animations",
      title: "Toggle animations",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.file_context",
      title: "Toggle file context",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.diffwrap",
      title: "Toggle diff wrapping",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.paste_summary",
      title: "Toggle paste summary",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "app.toggle.session_directory_filter",
      title: "Toggle session directory filtering",
      category: "System",
      disabled: "TUI-only command.",
      run: () => {},
    },
    {
      name: "gui.composer.focus",
      title: "Focus composer",
      category: "System",
      shortcut: "Ctrl+/",
      run: focusComposer,
    },
    {
      name: "gui.refresh",
      title: "Refresh GUI snapshot",
      category: "System",
      shortcut: "Ctrl+R",
      run: refresh,
    },
  ])

  return (
    <div class="app-shell" classList={{ "rail-collapsed": railCollapsed() }}>
      <Titlebar />
      <aside class="rail" aria-label="OpencodeX navigation">
        <div class="brand" onClick={() => setRoute({ name: "dashboard" })}>
          <span class="brand-mark"><Mark /></span>
          <div class="brand-copy">
            <strong>OpencodeX</strong>
            <span>{snapshot()?.projects[0] ? title(snapshot()!.projects[0].name ?? snapshot()!.projects[0].project.name) : "Command center"}</span>
          </div>
          <div class="brand-actions">
            <button class="rail-toggle" title={`${railCollapsed() ? "Expand" : "Collapse"} sidebar (Ctrl+B)`} aria-label="Toggle sidebar" aria-expanded={!railCollapsed()} onClick={(event) => {
              event.stopPropagation()
              setRailCollapsed((value) => !value)
            }}><Icon name="panel" /></button>
            <Show when={railCollapsed()}>
              <button class="new-button" title="New session (Ctrl+N)" aria-label="New session" onClick={(event) => {
                event.stopPropagation()
                void runAction(() => handleCreateSession())
              }}><Icon name="plus" /></button>
            </Show>
          </div>
        </div>
        <Show when={!railCollapsed()}>
          <nav class="nav">
            <For each={NAV_ITEMS}>
              {(item) => (
                <button aria-label={`${item.label}: ${item.description}`} title={`${item.label}: ${item.description} (${item.shortcut})`} classList={{ active: route().name === item.name }} onClick={() => setRoute({ name: item.name })}>
                  <Icon name={item.icon} />
                  <span class="nav-label">{item.label}</span>
                  <small>{item.shortcut}</small>
                </button>
              )}
            </For>
          </nav>
        </Show>
        <div class="rail-scroll">
          <RailSection title="Projects" count={snapshot()?.projects.length ?? 0} collapsed={railSections().projects} toggle={() => toggleRailSection("projects")} action={() => void runAction(handleCreateProject)}>
            <For each={snapshot()?.projects ?? []}>
              {(project) => (
                <div
                  class="project-group"
                  classList={{ dropping: dragTarget()?.type === "project" && dragTarget()?.id !== project.id }}
                  onDragOver={allowDrop}
                  onDrop={(event) => void runAction(() => handleDropProject(project.id, dropPlacement(event)))}
                >
                  <div class="project-heading">
                    <button class="project-toggle" title={`${projectExpanded(project.id) ? "Collapse" : "Expand"} project`} aria-expanded={projectExpanded(project.id)} onClick={() => toggleProject(project.id)}><Icon name={projectExpanded(project.id) ? "folder-open" : "folder"} /></button>
                    <button class="project-title" title={`${projectExpanded(project.id) ? "Collapse" : "Expand"} project`} aria-expanded={projectExpanded(project.id)} onClick={() => toggleProject(project.id)}>{title(project.name ?? project.project.name)}</button>
                    <button class="project-new" title="New session in project" onClick={() => void runAction(() => handleCreateSession(project.id, project.folders[0]?.path))}>+ New</button>
                  </div>
                  <div class="project-sessions" classList={{ collapsed: !projectExpanded(project.id) }}>
                    <div>
                      <For each={recentProjectSessions(projectSessions(project, snapshot()))} fallback={(
                        <div class="project-empty">
                          <span>No sessions in this project yet.</span>
                          <button onClick={() => void runAction(() => handleCreateSession(project.id, project.folders[0]?.path))}>Create session</button>
                        </div>
                      )}>
                        {(session) => (
                          <SidebarSessionLink session={session} snapshot={snapshot} active={sidebarSessionActive(session.id)} nested onClick={() => openSession(session.id)} />
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </RailSection>
          <RailSection title="Recent Sessions" count={recentSessions().length} collapsed={railSections().recent} toggle={() => toggleRailSection("recent")} action={() => void runAction(() => handleCreateSession())}>
            <For each={recentSessions()}>
              {(session) => (
                <SidebarSessionLink session={session} snapshot={snapshot} active={sidebarSessionActive(session.id)} onClick={() => openSession(session.id)} />
              )}
            </For>
          </RailSection>
          <RailSection title="Views" count={(snapshot()?.views ?? []).length} collapsed={railSections().views} toggle={() => toggleRailSection("views")} action={() => void runAction(handleCreateView)}>
            <For each={(snapshot()?.views ?? []).slice(0, 8)}>
              {(view) => (
                <div class="draggable-row" classList={{ dropping: dragTarget()?.type === "view" && dragTarget()?.id !== view.id }} onDragOver={allowDrop} onDrop={(event) => void runAction(() => handleDropView(view.id, dropPlacement(event)))}>
                  <button
                    class="drag-handle"
                    draggable
                    title="Drag to reorder view. Alt+Up/Down also moves it."
                    aria-label="Reorder view with drag or Alt+ArrowUp and Alt+ArrowDown"
                    onDragStart={(event) => startDrag(event, { type: "view", id: view.id })}
                    onDragEnd={() => setDragTarget(undefined)}
                    onKeyDown={(event) => {
                      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
                      event.preventDefault()
                      void runAction(() => handleMoveView(view.id, event.key === "ArrowUp" ? -1 : 1))
                    }}
                  ><Icon name="grip" /></button>
                  <SidebarViewLink view={view} snapshot={snapshot} active={route().name === "views" && activeView()?.id === view.id} onClick={() => setRoute({ name: "views", viewID: view.id })} />
                </div>
              )}
            </For>
          </RailSection>
        </div>
      </aside>
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
                setRoute={setRoute}
                refresh={refresh}
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
              <SessionCollectionPage snapshot={snapshot()} setRoute={setRoute} />
            </Match>
            <Match when={route().name === "projects"}>
              <ProjectCollectionPage snapshot={snapshot()} createSession={(projectID, directory) => void runAction(() => handleCreateSession(projectID, directory))} />
            </Match>
            <Match when={route().name === "swarms"}>
              <CollectionPage title="Swarms" count={snapshot()?.swarms.length ?? 0} description="Create, run, cancel, and inspect orchestrated swarm work through existing OpencodeX endpoints." />
            </Match>
            <Match when={route().name === "views"}>
              <ViewsPage
                snapshot={snapshot()}
                view={activeView()}
                items={activeViewItems()}
                focusedSessionID={activeViewFocusedSessionID}
                composerFocusRequest={viewComposerFocusRequest}
                data={viewSessionData()}
                loading={viewLoadingSessions()}
                providers={snapshot()?.providers ?? []}
                agents={snapshot()?.agents ?? []}
                recentModels={recentModels()}
                selectedAgent={(session) => viewAgentValue(session)}
                setSelectedAgent={(sessionID, value) => setViewAgents((current) => ({ ...current, [sessionID]: value }))}
                selectedModel={(session) => viewModelValue(session)}
                setSelectedModel={(sessionID, value) => {
                  setViewModels((current) => ({ ...current, [sessionID]: value }))
                  if (value) rememberModel(value)
                }}
                selectedVariant={(session) => viewVariantValue(session)}
                setSelectedVariant={(sessionID, value) => setViewVariants((current) => ({ ...current, [sessionID]: value }))}
                permissions={(sessionID) => snapshot()?.permissions.filter((request) => request.sessionID === sessionID) ?? []}
                questions={(sessionID) => snapshot()?.questions.filter((request) => request.sessionID === sessionID) ?? []}
                focus={(sessionID, focusComposer) => focusViewSession(sessionID, { focusComposer })}
                submit={(event, item, text) => void runAction(() => submitViewPrompt(event, item, text))}
                replyPermission={(request, reply) => void runAction(() => handlePermission(request, reply))}
                replyQuestion={(request, answers) => void runAction(() => handleQuestionReply(request, answers))}
                rejectQuestion={(request) => void runAction(() => handleQuestionReject(request))}
                abortSession={(sessionID) => void runAction(() => handleAbortSession(sessionID))}
                renameSession={(session) => void runAction(() => handleRenameSession(session))}
                moveSession={(session) => void runAction(() => handleMoveSession(session))}
                deleteSession={(session) => void runAction(() => handleDeleteSession(session))}
                loadOlderMessages={(sessionID, cursor) => runAction(() => loadOlderViewSessionMessages(sessionID, cursor))}
                reloadLatestMessages={(sessionID) => runAction(() => reloadLatestViewSessionMessages(sessionID))}
                onFollowBottomChange={(sessionID, value) => setSessionFollowingBottom(sessionID, value)}
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

function CommandPaletteModal(props: { open: boolean; commands: PaletteCommand[]; close: () => void; run: (command: PaletteCommand) => void }) {
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal(0)
  let input: HTMLInputElement | undefined
  const visible = createMemo(() => {
    const needle = query().trim().toLowerCase()
    const commands = props.commands.filter((command) => {
      if (!needle) return true
      return [command.title, command.category, command.description, command.name].filter(Boolean).join(" ").toLowerCase().includes(needle)
    })
    if (needle) return commands
    return [
      ...COMMAND_PALETTE_PINNED_CATEGORIES.flatMap((category) => commands.filter((command) => command.category === category)),
      ...commands.filter((command) => !COMMAND_PALETTE_PINNED_CATEGORIES.includes(command.category)),
    ]
  })
  const commandGroups = createMemo(() =>
    visible().reduce<PaletteCommandGroup[]>((result, command, index) => {
      const group = result.at(-1)
      if (group?.title === command.category) {
        group.commands.push(command)
        return result
      }
      return result.concat({ title: command.category, start: index, commands: [command] })
    }, []),
  )
  createEffect(() => {
    if (!props.open) return
    setQuery("")
    setSelected(0)
    requestAnimationFrame(() => input?.focus())
  })
  createEffect(() => {
    const count = visible().length
    if (selected() >= count) setSelected(Math.max(0, count - 1))
  })
  function select(offset: number) {
    const count = visible().length
    if (count === 0) return
    setSelected((current) => (current + offset + count) % count)
  }
  function submit() {
    const command = visible()[selected()]
    if (!command) return
    if (command.disabled) {
      setQuery(command.disabled)
      return
    }
    props.run(command)
  }
  return (
    <Show when={props.open}>
      <div
        class="dialog-backdrop command-palette-backdrop"
        onMouseDown={props.close}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return
          event.preventDefault()
          event.stopPropagation()
          props.close()
        }}
      >
        <section class="command-palette-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div>
              <h2>Commands</h2>
              <p>Search actions, then press Enter.</p>
            </div>
            <button type="button" aria-label="Close command palette" onClick={props.close}>×</button>
          </header>
          <input
            ref={input}
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value)
              setSelected(0)
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                event.stopPropagation()
                props.close()
                return
              }
              if (event.key === "ArrowDown") {
                event.preventDefault()
                select(1)
                return
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                select(-1)
                return
              }
              if (event.key === "Enter") {
                event.preventDefault()
                submit()
              }
            }}
            placeholder="Search commands"
          />
          <div class="command-palette-list" role="listbox" aria-label="Commands">
            <For each={commandGroups()} fallback={<p class="command-palette-empty">No matching commands.</p>}>
              {(group) => (
                <section class="command-palette-group" role="group" aria-label={group.title}>
                  <h3>{group.title}</h3>
                  <For each={group.commands}>
                    {(command, index) => {
                      const shortcut = () => command.shortcut ?? TUI_COMMAND_SHORTCUTS[command.name]
                      const detail = () => command.disabled ?? command.description
                      const commandIndex = () => group.start + index()
                      return (
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected() === commandIndex()}
                          disabled={!!command.disabled}
                          classList={{ selected: selected() === commandIndex(), suggested: !!command.suggested }}
                          title={command.disabled}
                          onMouseEnter={() => setSelected(commandIndex())}
                          onClick={() => props.run(command)}
                        >
                          <strong>{command.title}</strong>
                          <Show when={detail()}>{(value) => <small>{value()}</small>}</Show>
                          <Show when={shortcut()}>{(value) => <kbd>{value()}</kbd>}</Show>
                        </button>
                      )
                    }}
                  </For>
                </section>
              )}
            </For>
          </div>
        </section>
      </div>
    </Show>
  )
}

function DialogModal(props: { dialog?: DialogState; close: () => void }) {
  const [value, setValue] = createSignal("")
  const choiceOptions = createMemo(() => {
    const current = props.dialog
    if (current?.type !== "choice") return []
    const needle = value().trim().toLowerCase()
    if (!needle) return current.options
    return current.options.filter((option) => [option.title, option.description, option.meta, option.value].filter(Boolean).join(" ").toLowerCase().includes(needle))
  })
  createEffect(() => setValue(props.dialog?.type === "text" ? props.dialog.value ?? "" : ""))
  function cancel() {
    const current = props.dialog
    props.close()
    if (!current) return
    if (current.type === "confirm") current.resolve(false)
    else current.resolve(undefined)
  }
  function choose(value: string) {
    const current = props.dialog
    props.close()
    if (current?.type === "choice") current.resolve(value)
  }
  function submit(event: SubmitEvent) {
    event.preventDefault()
    const current = props.dialog
    const choice = current?.type === "choice" ? choiceOptions()[0]?.value : undefined
    props.close()
    if (!current) return
    if (current.type === "text") current.resolve(value())
    else if (current.type === "confirm") current.resolve(true)
    else current.resolve(choice)
  }
  return (
    <Show when={props.dialog}>
      {(current) => (
        <div
          class="dialog-backdrop"
          onMouseDown={cancel}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            event.preventDefault()
            event.stopPropagation()
            cancel()
          }}
        >
          <form class="dialog-card" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
            <h2>{current().title}</h2>
            <Show when={current().message}>
              <p>{current().message}</p>
            </Show>
            <Show when={current().type === "text"}>
              <Show when={(current() as Extract<DialogState, { type: "text" }>).multiline} fallback={<input value={value()} onInput={(event) => setValue(event.currentTarget.value)} autofocus />}>
                <textarea value={value()} onInput={(event) => setValue(event.currentTarget.value)} autofocus />
              </Show>
            </Show>
            <Show when={current().type === "choice"}>
              <input value={value()} onInput={(event) => setValue(event.currentTarget.value)} placeholder="Search options" autofocus />
              <div class="choice-list">
                <For each={choiceOptions()} fallback={<p>No matching options.</p>}>
                  {(option) => (
                    <button type="button" onClick={() => choose(option.value)}>
                      <strong>{option.title}</strong>
                      <Show when={option.meta}><small>{option.meta}</small></Show>
                      <Show when={option.description}><span>{option.description}</span></Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <div class="dialog-actions">
              <button type="button" class="secondary" onClick={cancel}>Cancel</button>
              <button type="submit" class="primary">{current().type === "confirm" ? (current() as Extract<DialogState, { type: "confirm" }>).confirm ?? "Confirm" : current().type === "choice" ? "Select" : "Save"}</button>
            </div>
          </form>
        </div>
      )}
    </Show>
  )
}

function Titlebar() {
  return (
    <header class="titlebar">
      <div class="titlebar-drag">
        <Mark />
        <span>OpencodeX</span>
        <small>Premium AI development environment</small>
      </div>
      <div class="window-controls">
        <button aria-label="Minimize" onClick={() => void window.opencodex?.window("minimize")}>-</button>
        <button aria-label="Maximize" onClick={() => void window.opencodex?.window("maximize")}>□</button>
        <button aria-label="Close" class="close" onClick={() => void window.opencodex?.window("close")}>×</button>
      </div>
    </header>
  )
}

function Icon(props: { name: string }) {
  const paths: Record<string, JSX.Element> = {
    activity: <path d="M3 12h4l2-7 4 14 2-7h5" />,
    check: <path d="M20 6 9 17l-5-5" />,
    dashboard: <path d="M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z" />,
    chevronDown: <path d="M6 9l6 6 6-6" />,
    chevronRight: <path d="M9 6l6 6-6 6" />,
    circle: <circle cx="12" cy="12" r="8" />,
    folder: <path d="M3 7h7l2 2h9v10H3z" />,
    "folder-open": <path d="M3 8h6.5l2 2H21M3 8v11h16l2-9H8l-2 3H3" />,
    grip: <path d="M8 5h.01M8 12h.01M8 19h.01M16 5h.01M16 12h.01M16 19h.01" />,
    more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
    panel: <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 5v14M6 9h.01M6 12h.01M6 15h.01" />,
    play: <path d="M8 5l11 7-11 7z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    send: <path d="M5 19 20 5M20 5l-5 14-3-7-7-3 15-4z" />,
    session: <path d="M4 5h16v11H8l-4 4z" />,
    settings: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />,
    stop: <path d="M8 8h8v8H8z" />,
    swarm: <path d="M12 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM10 10l-3 6M14 10l3 6M9 19h6" />,
    views: <path d="M4 5h8v8H4zM12 11h8v8h-8z" />,
    x: <path d="M6 6l12 12M18 6 6 18" />,
  }
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      {paths[props.name] ?? paths.dashboard}
    </svg>
  )
}

function DisclosureChevron() {
  return <span class="output-chevron"><Icon name="chevronRight" /></span>
}

function RailSection(props: { title: string; count: number; collapsed: boolean; toggle: () => void; action: () => void; children: JSX.Element }) {
  return (
    <section class="rail-section">
      <header>
        <button class="section-toggle" aria-expanded={!props.collapsed} onClick={props.toggle}>
          <span class="section-chevron"><Icon name={props.collapsed ? "chevronRight" : "chevronDown"} /></span>
          <strong>{props.title} <span class="section-count">({props.count})</span></strong>
        </button>
        <button class="section-new" title={`Create ${props.title}`} aria-label={`Create ${props.title}`} onClick={props.action}>+ New</button>
      </header>
      <div class="rail-section-content" classList={{ collapsed: props.collapsed }}>
        <div>{props.children}</div>
      </div>
    </section>
  )
}

function Dashboard(props: {
  snapshot?: GuiSnapshot
  setRoute: (route: Route) => void
  refresh: () => void
  createProject: () => void
  createSession: (projectID?: string, directory?: string) => void
  createSwarm: () => void
  createView: () => void
  renameProject: (projectID: string, current?: string) => void
  editProjectFolders: (projectID: string, folders: string[]) => void
  deleteProject: (projectID: string, name: string) => void
}) {
  const sessions = createMemo(() => tuiSidebarSessions(props.snapshot))
  const recentSessions = createMemo(() => sessions().filter((session) => isRecentSessionUpdate(session.time.updated)))
  const priorSessions = createMemo(() => sessions().filter((session) => !isRecentSessionUpdate(session.time.updated)))
  const attentionJobs = createMemo(() => (props.snapshot?.jobs ?? []).filter((job) => ["input_needed", "approval_needed", "blocked", "failed"].includes(job.status)).slice(0, 8))
  const attentionCount = createMemo(() => (props.snapshot?.permissions.length ?? 0) + (props.snapshot?.questions.length ?? 0) + attentionJobs().length)
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({ swarms: true, prior: true })
  const toggleSection = (section: string) => setCollapsed((value) => ({ ...value, [section]: !value[section] }))
  return (
    <div class="page dashboard-page">
      <OpencodeXLogo />
      <section class="dashboard-actions" aria-label="Create new OpencodeX items">
        <DashboardActionCard title="Project" description="Group work" meta={`${props.snapshot?.projects.length ?? 0} projects`} tone="primary" onClick={props.createProject} />
        <DashboardActionCard title="Session" description="New chat" meta={`${sessions().length} sessions`} tone="blue" onClick={() => props.createSession()} />
        <DashboardActionCard title="Swarm" description="Agent team" meta={`${props.snapshot?.swarms.length ?? 0} swarms`} tone="warning" onClick={props.createSwarm} />
        <DashboardActionCard title="View" description="Multi-session" meta={`${props.snapshot?.views.length ?? 0} views`} tone="info" onClick={props.createView} />
      </section>
      <section class="dashboard-sections">
        <DashboardSection title="Projects" count={props.snapshot?.projects.length ?? 0} collapsed={!!collapsed().projects} onToggle={() => toggleSection("projects")}>
          <div class="dashboard-card-grid">
          <For each={(props.snapshot?.projects ?? []).slice(0, 8)} fallback={<EmptyCreateDashboardCard title="Create project" description="Group sessions, swarms, and views around a workspace." onClick={props.createProject} />}>
            {(project) => (
              <article class="dashboard-item-card project-card">
                <div>
                  <strong>{title(project.name ?? project.project.name)}</strong>
                  <span>{projectSessions(project, props.snapshot).length} sessions - {projectSwarms(project, props.snapshot).length} swarms</span>
                </div>
                <div class="row-actions">
                  <small>{compactPath(project.folders[0]?.path)}</small>
                  <button onClick={() => props.createSession(project.id, project.folders[0]?.path)}>Session</button>
                  <button onClick={() => props.renameProject(project.id, project.name ?? project.project.name)}>Rename</button>
                  <button onClick={() => props.editProjectFolders(project.id, project.folders.map((folder) => folder.path))}>Folders</button>
                  <button class="danger" onClick={() => props.deleteProject(project.id, title(project.name ?? project.project.name))}>Delete</button>
                </div>
              </article>
            )}
          </For>
          </div>
        </DashboardSection>
        <DashboardSection title="Swarms" count={props.snapshot?.swarms.length ?? 0} collapsed={!!collapsed().swarms} onToggle={() => toggleSection("swarms")}>
          <div class="dashboard-card-grid">
          <For each={(props.snapshot?.swarms ?? []).slice(0, 8)} fallback={<EmptyCreateDashboardCard title="Create swarm" description="Build an Agent team." onClick={props.createSwarm} />}>
            {(swarm) => (
              <article class="dashboard-item-card">
                <div>
                  <strong>{title(swarm.title)}</strong>
                  <span>{swarm.roles.length} roles · {swarm.runs.length} runs</span>
                </div>
                <footer>
                  <small>{formatRelative(swarm.timeUpdated)}</small>
                </footer>
              </article>
            )}
          </For>
          </div>
        </DashboardSection>
        <DashboardSection title="Attention Needed" count={attentionCount()} collapsed={!!collapsed().attention} onToggle={() => toggleSection("attention")}>
          <div class="dashboard-card-grid">
          <For each={props.snapshot?.permissions ?? []}>
            {(request) => (
              <button class="dashboard-item-card warning interactive" onClick={() => props.setRoute({ name: "session", sessionID: request.sessionID })}>
                <div>
                  <strong>Permission required</strong>
                  <span>{request.permission}</span>
                </div>
                <small>{request.patterns.slice(0, 2).join(", ") || "Review request"}</small>
              </button>
            )}
          </For>
          <For each={props.snapshot?.questions ?? []}>
            {(request) => (
              <button class="dashboard-item-card warning interactive" onClick={() => props.setRoute({ name: "session", sessionID: request.sessionID })}>
                <div>
                  <strong>Question pending</strong>
                  <span>{request.questions[0]?.question ?? "Agent needs input"}</span>
                </div>
                <small>{request.questions.length} questions</small>
              </button>
            )}
          </For>
          <For each={attentionJobs()}>
            {(job) => (
              <article class="dashboard-item-card warning">
                <div>
                  <strong>{title(job.title ?? job.kind)}</strong>
                  <span>{job.status}</span>
                </div>
                <small>{formatRelative(job.timeUpdated)}</small>
              </article>
            )}
          </For>
          <Show when={attentionCount() === 0}><Empty text="Nothing needs attention right now." /></Show>
          </div>
        </DashboardSection>
        <DashboardSection title="Recent Sessions" count={recentSessions().length} collapsed={!!collapsed().sessions} onToggle={() => toggleSection("sessions")}>
          <div class="dashboard-card-grid">
          <For each={recentSessions()} fallback={<EmptyCreateDashboardCard title="Create session" description="Start a new chat from the dashboard." onClick={() => props.createSession()} />}>
            {(session) => (
              <button class="dashboard-item-card dashboard-status-card interactive" classList={{ [`status-${sidebarStatus(props.snapshot, session).replaceAll("_", "-")}`]: true }} onClick={() => props.setRoute({ name: "session", sessionID: session.id })}>
                <div>
                  <strong>{title(session.title)}</strong>
                </div>
                <footer>
                  <small>{dashboardSessionMeta(session, props.snapshot)}</small>
                </footer>
                <Show when={sidebarStatus(props.snapshot, session) === "in_progress"}><span class="mini-spinner" aria-label="running" /></Show>
                <Show when={sidebarStatus(props.snapshot, session) === "input_needed" || sidebarStatus(props.snapshot, session) === "ready_for_review"}><span class="status-glyph" aria-label={sidebarStatusLabel(sidebarStatus(props.snapshot, session))} /></Show>
              </button>
            )}
          </For>
          </div>
        </DashboardSection>
        <DashboardSection title="Views" count={props.snapshot?.views.length ?? 0} collapsed={!!collapsed().views} onToggle={() => toggleSection("views")}>
          <div class="dashboard-card-grid">
          <For each={(props.snapshot?.views ?? []).slice(0, 8)} fallback={<EmptyCreateDashboardCard title="Create view" description="Build a focused multi-session view." onClick={props.createView} />}>
            {(view) => (
              <article class="dashboard-item-card dashboard-status-card" classList={{ [`status-${viewDashboardStatus(view, props.snapshot).replaceAll("_", "-")}`]: true }}>
                <div>
                  <strong>{title(view.title)}</strong>
                  <span>{viewSessionCount(view)} sessions</span>
                </div>
                <footer>
                  <small>{formatRelative(view.timeUpdated)}</small>
                </footer>
                <Show when={viewDashboardStatus(view, props.snapshot) === "in_progress"}><span class="mini-spinner" aria-label="running" /></Show>
                <Show when={viewDashboardStatus(view, props.snapshot) === "input_needed" || viewDashboardStatus(view, props.snapshot) === "ready_for_review"}><span class="status-glyph" aria-label={sidebarStatusLabel(viewDashboardStatus(view, props.snapshot))} /></Show>
              </article>
            )}
          </For>
          </div>
        </DashboardSection>
        <DashboardSection title="Prior Sessions" count={priorSessions().length} collapsed={!!collapsed().prior} onToggle={() => toggleSection("prior")}>
          <div class="dashboard-card-grid compact">
          <For each={priorSessions()} fallback={<Empty text="No prior sessions." />}>
            {(session) => (
              <button class="dashboard-item-card dashboard-status-card interactive compact" classList={{ [`status-${sidebarStatus(props.snapshot, session).replaceAll("_", "-")}`]: true }} onClick={() => props.setRoute({ name: "session", sessionID: session.id })}>
                <div>
                  <strong>{title(session.title)}</strong>
                </div>
                <footer>
                  <small>{dashboardSessionMeta(session, props.snapshot)}</small>
                </footer>
                <Show when={sidebarStatus(props.snapshot, session) === "in_progress"}><span class="mini-spinner" aria-label="running" /></Show>
                <Show when={sidebarStatus(props.snapshot, session) === "input_needed" || sidebarStatus(props.snapshot, session) === "ready_for_review"}><span class="status-glyph" aria-label={sidebarStatusLabel(sidebarStatus(props.snapshot, session))} /></Show>
              </button>
            )}
          </For>
          </div>
        </DashboardSection>
      </section>
    </div>
  )
}

function DashboardActionCard(props: { title: string; description: string; meta: string; tone: "primary" | "blue" | "warning" | "info"; onClick: () => void }) {
  return (
    <button class={`dashboard-action-card ${props.tone}`} onClick={props.onClick}>
      <span class="action-plus">+</span>
      <strong>{props.title}</strong>
      <span>{props.description}</span>
      <small>{props.meta}</small>
    </button>
  )
}

function DashboardSection(props: { title: string; count: number; collapsed: boolean; onToggle: () => void; action?: string; onAction?: () => void; children: JSX.Element }) {
  return (
    <section class="dashboard-section">
      <header>
        <div>
          <button class="section-collapse" aria-label={`${props.collapsed ? "Expand" : "Collapse"} ${props.title}`} aria-expanded={!props.collapsed} onClick={props.onToggle}>
            <span class="section-chevron"><Icon name={props.collapsed ? "chevronRight" : "chevronDown"} /></span>
            <strong>{props.title} <span class="section-count">({props.count})</span></strong>
          </button>
        </div>
        <Show when={props.action && props.onAction}>
          <button class="secondary" onClick={props.onAction}>{props.action}</button>
        </Show>
      </header>
      <div class="dashboard-section-content" classList={{ collapsed: props.collapsed }}>
        <div>{props.children}</div>
      </div>
    </section>
  )
}

function EmptyCreateDashboardCard(props: { title: string; description: string; onClick: () => void }) {
  return (
    <button class="dashboard-item-card empty-create interactive" onClick={props.onClick}>
      <strong>+ {props.title}</strong>
      <span>{props.description}</span>
      <small>create</small>
    </button>
  )
}

function OpencodeXLogo() {
  const [now, setNow] = createSignal(0)
  const ctx = logoContext()

  onMount(() => {
    setNow(performance.now())
    const timer = setInterval(() => setNow(performance.now()), 16)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <div class="opencodex-logo" aria-label="OpencodeX">
      {LOGO.left.map((line, y) => (
        <div class="opencodex-logo-line" aria-hidden="true">
          <div class="opencodex-logo-run">{renderTuiLogoLine(line, y, "#808080", 0, now(), ctx)}</div>
          <div class="opencodex-logo-gap" />
          <div class="opencodex-logo-run">{renderTuiLogoLine(LOGO.right[y] ?? "", y, "#eeeeee", ctx.left + 1, now(), ctx)}</div>
        </div>
      ))}
    </div>
  )
}

const LOGO = {
  left: ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"],
  right: ["             ▄            ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█ ▀▄▀", "█___ █__█ █__█ █^^^ ▀ ▀ ", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀    "],
}

type Rgb = { r: number; g: number; b: number }

const LOGO_THEME = {
  background: hexToRgb("#0a0a0a"),
  primary: hexToRgb("#fab283"),
  warning: hexToRgb("#f5a742"),
  peak: hexToRgb("#ffffff"),
}

const LOGO_SHIMMER = {
  period: 4600,
  rings: 2,
  sweepFraction: 1,
  coreWidth: 1.2,
  coreAmp: 1.9,
  softWidth: 10,
  softAmp: 1.6,
  tail: 5,
  tailAmp: 0.64,
  haloWidth: 4.3,
  haloOffset: 0.6,
  haloAmp: 0.16,
  breathBase: 0.04,
  noise: 0.1,
  ambientAmp: 0.36,
  ambientCenter: 0.5,
  ambientWidth: 0.34,
  shadowMix: 0.1,
  primaryMix: 0.3,
  originX: 4.5,
  originY: 13.5,
}

function renderTuiLogoLine(line: string, y: number, inkHex: string, off: number, t: number, ctx: ReturnType<typeof logoContext>) {
  return Array.from(line).map((char, i) => {
    const x = off + i
    const charInk = x >= 40 ? LOGO_THEME.warning : hexToRgb(inkHex)
    const shadow = tint(LOGO_THEME.background, charInk, 0.25)
    const top = logoIdle(x, y * 2, t, ctx)
    const bot = logoIdle(x, y * 2 + 1, t, ctx)
    const inkTop = logoPeakTint(charInk, top)
    const inkBot = logoPeakTint(charInk, bot)
    const pulse = { peak: (top.peak + bot.peak) / 2, primary: (top.primary + bot.primary) / 2 }
    const inkTinted = logoPeakTint(charInk, pulse)
    const shadowTop = tint(shadow, LOGO_THEME.peak, Math.min(1, top.peak * LOGO_SHIMMER.shadowMix))
    const shadowBot = tint(shadow, LOGO_THEME.peak, Math.min(1, bot.peak * LOGO_SHIMMER.shadowMix))
    const shadowTinted = tint(shadow, LOGO_THEME.peak, Math.min(1, pulse.peak * LOGO_SHIMMER.shadowMix))
    const shimmer = logoShimmer(x, y, t, ctx)

    if (char === " ") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(charInk) }}>{char}</span>
    if (char === "_") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTinted), "background-color": rgbToCss(shade(shadowTinted, ghost(shimmer, 0.06))) }}> </span>
    if (char === "^") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTop), "background-color": rgbToCss(shade(shadowBot, ghost(shimmer, 0.05))) }}>▀</span>
    if (char === "~") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(shade(shadowTop, ghost(shimmer, 0.05))) }}>▀</span>
    if (char === ",") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(shade(shadowBot, ghost(shimmer, 0.05))) }}>▄</span>
    if (char === "█") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTop), "background-color": rgbToCss(inkBot) }}>▀</span>
    if (char === "▀") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTop) }}>▀</span>
    if (char === "▄") return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkBot) }}>▄</span>
    return <span class="opencodex-logo-cell" style={{ color: rgbToCss(inkTinted) }}>{char}</span>
  })
}

function logoContext() {
  const full = LOGO.left.map((line, i) => line + " " + LOGO.right[i])
  return {
    left: LOGO.left[0]?.length ?? 0,
    full,
    span: Math.hypot(full[0]?.length ?? 0, full.length * 2) * 0.94,
  }
}

function logoIdle(x: number, pixelY: number, t: number, ctx: ReturnType<typeof logoContext>) {
  const corners = [[0, 0], [ctx.full[0]?.length ?? 1, 0], [0, ctx.full.length * 2], [ctx.full[0]?.length ?? 1, ctx.full.length * 2]]
  const reach = Math.max(...corners.map(([cx, cy]) => Math.hypot(cx - LOGO_SHIMMER.originX, cy - LOGO_SHIMMER.originY))) + LOGO_SHIMMER.tail * 2
  const dx = x + 0.5 - LOGO_SHIMMER.originX
  const dy = pixelY - LOGO_SHIMMER.originY
  const dist = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx)
  const wob1 = logoNoise(x * 0.32, pixelY * 0.25, t * 0.0005) - 0.5
  const wob2 = logoNoise(x * 0.12, pixelY * 0.08, t * 0.00022) - 0.5
  const ripple = Math.sin(angle * 3 + t * 0.0012) * 0.3
  const traveled = dist + (wob1 * 0.55 + wob2 * 0.32 + ripple * 0.18) * LOGO_SHIMMER.noise
  const rings = Math.max(1, Math.floor(LOGO_SHIMMER.rings))
  const values = Array.from({ length: rings }).map((_, i) => {
    const cyclePhase = (t / LOGO_SHIMMER.period + i / rings) % 1
    if (cyclePhase >= LOGO_SHIMMER.sweepFraction) return { glow: 0, peak: 0, primary: 0, ambient: 0 }
    const phase = cyclePhase / LOGO_SHIMMER.sweepFraction
    const envelope = Math.sin(phase * Math.PI)
    const eased = envelope * envelope * (3 - 2 * envelope)
    const delta = traveled - phase * reach
    const core = Math.exp(-(Math.abs(delta / LOGO_SHIMMER.coreWidth) ** 1.8))
    const soft = Math.exp(-(Math.abs(delta / LOGO_SHIMMER.softWidth) ** 1.6))
    const tailRange = LOGO_SHIMMER.tail * 2.6
    const tail = delta < 0 && delta > -tailRange ? (1 + delta / tailRange) ** 2.6 : 0
    const haloBand = Math.exp(-(Math.abs((delta + LOGO_SHIMMER.haloOffset) / LOGO_SHIMMER.haloWidth) ** 1.6))
    const d = (phase - LOGO_SHIMMER.ambientCenter) / LOGO_SHIMMER.ambientWidth
    return {
      glow: (soft * LOGO_SHIMMER.softAmp + tail * LOGO_SHIMMER.tailAmp) * eased,
      peak: (core * LOGO_SHIMMER.coreAmp + haloBand * LOGO_SHIMMER.haloAmp) * eased,
      primary: (haloBand + tail * 0.6) * eased,
      ambient: Math.abs(d) < 1 ? (1 - d * d) ** 2 * LOGO_SHIMMER.ambientAmp : 0,
    }
  })
  return {
    glow: values.reduce((sum, item) => sum + item.glow, 0) / rings,
    peak: LOGO_SHIMMER.breathBase + values.reduce((sum, item) => sum + item.ambient + item.peak, 0) / rings,
    primary: (values.reduce((sum, item) => sum + item.primary, 0) / rings) * LOGO_SHIMMER.primaryMix,
  }
}

function logoShimmer(x: number, y: number, t: number, ctx: ReturnType<typeof logoContext>) {
  const phase = (t / LOGO_SHIMMER.period) % 1
  const head = phase * (ctx.span + LOGO_SHIMMER.tail * 2)
  const delta = Math.hypot(x + 0.5 - LOGO_SHIMMER.originX, y * 2 + 1 - LOGO_SHIMMER.originY) - head
  if (delta < -LOGO_SHIMMER.tail || delta > LOGO_SHIMMER.coreWidth) return 0
  return Math.exp(-(Math.abs(delta / LOGO_SHIMMER.haloWidth) ** 1.6)) * 0.25
}

function logoPeakTint(base: Rgb, pulse: { peak: number; primary: number }) {
  const primary = pulse.primary > 0 ? tint(base, LOGO_THEME.primary, Math.min(1, pulse.primary)) : base
  return pulse.peak > 0 ? tint(primary, LOGO_THEME.peak, Math.min(1, pulse.peak)) : primary
}

function shade(base: Rgb, n: number) {
  if (n >= 0) {
    const mid = tint(base, LOGO_THEME.primary, 0.84)
    const top = tint(LOGO_THEME.primary, LOGO_THEME.peak, 0.96)
    if (n <= 1) return tint(base, mid, Math.min(1, Math.sqrt(Math.max(0, n)) * 1.14))
    return tint(mid, top, Math.min(1, 1 - Math.exp(-2.4 * (n - 1))))
  }
  return tint(base, LOGO_THEME.background, Math.min(0.82, -n * 0.64))
}

function ghost(n: number, scale: number) {
  if (n < 0) return n
  return n * scale
}

function tint(a: Rgb, b: Rgb, amount: number) {
  const t = Math.max(0, Math.min(1, amount))
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

function logoNoise(x: number, y: number, t: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + t * 0.043) * 43758.5453
  return n - Math.floor(n)
}

function hexToRgb(hex: string) {
  return { r: Number.parseInt(hex.slice(1, 3), 16), g: Number.parseInt(hex.slice(3, 5), 16), b: Number.parseInt(hex.slice(5, 7), 16) }
}

function rgbToCss(rgb: Rgb) {
  return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`
}

function isAssistantMessage(message: MessageBundle["info"]): message is AssistantMessage {
  return message.role === "assistant"
}

function formatTokenCount(tokens: number) {
  if (tokens >= 1_000_000) return `${trimCompactNumber(tokens / 1_000_000)}m`
  if (tokens >= 1_000) return `${trimCompactNumber(tokens / 1_000)}k`
  return tokens.toLocaleString()
}

function trimCompactNumber(value: number) {
  return value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, "")
}

function SessionPage(props: {
  session?: Session
  data: SessionData
  loading: boolean
  prompt: string
  setPrompt: (value: string) => void
  providers: Provider[]
  agents: Agent[]
  selectedAgent: string
  setSelectedAgent: (value: string) => void
  selectedModel: string
  recentModels: string[]
  setSelectedModel: (value: string) => void
  selectedVariant: string
  setSelectedVariant: (value: string) => void
  submit: (event: SubmitEvent, text: string) => void
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  replyPermission: (request: PermissionRequest, reply: "once" | "always" | "reject") => void
  replyQuestion: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  rejectQuestion: (request: QuestionRequest) => void
  abortSession: (sessionID: string) => void
  renameSession: (session: Session) => void
  moveSession: (session: Session) => void
  deleteSession: (session: Session) => void
  status?: string
  pending?: boolean
  composerFocusToken?: () => number
  messageWindow: MessageWindow
  loadOlderMessages?: (cursor: string) => Promise<void>
  reloadLatestMessages?: () => Promise<void>
  onFollowBottomChange?: (sessionID: string, value: boolean) => void
}) {
  const session = () => props.session
  const blocked = () => props.permissions.length > 0 || props.questions.length > 0
  let transcriptExpandedSessionID = ""
  let composerTextarea: HTMLTextAreaElement | undefined
  const [modelPickerOpen, setModelPickerOpen] = createSignal(false)
  const [variantPickerOpen, setVariantPickerOpen] = createSignal(false)
  const [modelQuery, setModelQuery] = createSignal("")
  const [draftPrompt, setDraftPrompt] = createSignal(props.prompt)
  const modelOptions = createMemo(() =>
    props.providers.flatMap((provider) =>
      Object.values(provider.models)
        .filter((model) => model.status !== "deprecated")
        .map((model) => ({ provider, model })),
    ),
  )
  const recentModelOptions = createMemo(() =>
    props.recentModels.flatMap((value) => {
      const option = modelOptions().find((item) => modelValue(item.provider.id, item.model.id) === value)
      return option ? [option] : []
    }),
  )
  const providerModelOptions = createMemo(() => {
    const recents = new Set(recentModelOptions().map((item) => modelValue(item.provider.id, item.model.id)))
    return props.providers
      .toSorted((a, b) => Number(a.id !== "opencode") - Number(b.id !== "opencode") || a.name.localeCompare(b.name))
      .map((provider) => ({
        provider,
        models: Object.values(provider.models)
          .filter((model) => model.status !== "deprecated")
          .filter((model) => !recents.has(modelValue(provider.id, model.id)))
          .toSorted((a, b) => Number(!isFreeOpencodeModel(provider, a)) - Number(!isFreeOpencodeModel(provider, b)) || (a.name ?? a.id).localeCompare(b.name ?? b.id)),
      }))
      .filter((item) => item.models.length > 0)
  })
  const filteredRecentModelOptions = createMemo(() => filterModelOptions(recentModelOptions(), modelQuery()))
  const filteredProviderModelOptions = createMemo(() =>
    providerModelOptions()
      .map((group) => ({ ...group, models: filterModelOptions(group.models.map((model) => ({ provider: group.provider, model })), modelQuery()).map((item) => item.model) }))
      .filter((group) => group.models.length > 0),
  )
  const activeProvider = createMemo(() => {
    const selection = parseModelValue(props.selectedModel)
    if (!selection) return
    return props.providers.find((provider) => provider.id === selection.providerID)
  })
  const activeModel = createMemo(() => {
    const selection = parseModelValue(props.selectedModel)
    if (!selection) return
    return props.providers.find((provider) => provider.id === selection.providerID)?.models[selection.modelID]
  })
  const variants = createMemo(() => Object.keys(activeModel()?.variants ?? {}))
  const mode = createMemo(() => props.selectedAgent === "plan" ? "plan" : "build")
  const running = createMemo(() => props.status === "busy" || props.status === "retry")
  const sessionStarted = createMemo(() => props.loading || props.data.messages.length > 0 || props.status === "busy" || props.status === "retry" || blocked())
  const draftText = createMemo(() => draftPrompt().trim())
  const usageLabel = createMemo(() => {
    const last = props.data.messages.findLast((bundle) => isAssistantMessage(bundle.info) && bundle.info.tokens.output > 0)?.info
    if (!last || !isAssistantMessage(last)) return
    const tokens = last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return
    const limit = props.providers.find((provider) => provider.id === last.providerID)?.models[last.modelID]?.limit.context
    const pct = limit ? ` (${Math.round((tokens / limit) * 100)}%)` : ""
    return `${formatTokenCount(tokens)}${pct}`
  })
  const modelLabel = () => props.selectedModel && activeProvider() && activeModel() ? `${activeModel()!.name ?? activeModel()!.id} ${activeProvider()!.name}` : "Select model"
  const variantLabel = () => props.selectedVariant || "Default"
  const toggleMode = () => props.setSelectedAgent(mode() === "plan" ? "build" : "plan")
  const selectVariant = (variant: string) => {
    props.setSelectedVariant(variant)
    setVariantPickerOpen(false)
  }
  const cycleVariant = () => {
    const list = variants()
    if (list.length === 0) return
    const options = ["", ...list]
    const index = options.indexOf(props.selectedVariant)
    props.setSelectedVariant(options[index >= 0 ? (index + 1) % options.length : 1])
    setVariantPickerOpen(false)
  }
  const selectModel = (providerID: string, modelID: string) => {
    props.setSelectedModel(modelValue(providerID, modelID))
    setModelPickerOpen(false)
    setVariantPickerOpen(false)
    setModelQuery("")
  }
  const resizeComposer = () => {
    if (!composerTextarea) return
    composerTextarea.style.height = "auto"
    composerTextarea.style.height = `${composerTextarea.scrollHeight}px`
  }
  const submitComposer = (event: SubmitEvent) => {
    event.preventDefault()
    const text = draftText()
    if (blocked() || !text) return
    setDraftPrompt("")
    requestAnimationFrame(resizeComposer)
    props.submit(event, text)
  }
  createEffect(() => {
    draftPrompt()
    resizeComposer()
  })
  createEffect(() => {
    const token = props.composerFocusToken?.() ?? 0
    if (!token) return
    requestAnimationFrame(() => {
      if (props.composerFocusToken?.() !== token || !composerTextarea || composerTextarea.disabled) return
      composerTextarea.focus({ preventScroll: true })
    })
  })
  createEffect(() => {
    const id = props.session?.id ?? ""
    if (id === transcriptExpandedSessionID) return
    transcriptExpandedSessionID = id
    setDraftPrompt(props.prompt)
  })
  return (
    <div class="page session-page" classList={{ "session-empty": !sessionStarted() }}>
      <Show when={session()} fallback={<Empty text="Session not found" />}>
        {(selected) => (
          <>
            <div class="session-page-top">
              <header class="session-toolbar">
                <div class="session-titleline">
                  <div>
                    <h1>{title(selected().title)}</h1>
                    <p>{compactPath(selected().directory)}</p>
                  </div>
                </div>
                <div class="session-actions compact">
                  <Show when={props.status === "busy" || props.status === "retry" || blocked()}>
                    <button class="icon-button" title="Interrupt session" aria-label="Interrupt session" onClick={() => props.abortSession(selected().id)}><Icon name="stop" /></button>
                  </Show>
                  <StatusPill status={blocked() ? "input_needed" : props.status ?? "idle"} />
                  <Show when={!props.pending}>
                    <details class="overflow-menu">
                      <summary title="Session actions" aria-label="Session actions"><Icon name="more" /></summary>
                      <div>
                        <button type="button" onClick={() => props.renameSession(selected())}>Rename</button>
                        <button type="button" onClick={() => props.moveSession(selected())}>Move to project</button>
                        <button type="button" class="danger" onClick={() => props.deleteSession(selected())}>Delete</button>
                      </div>
                    </details>
                  </Show>
                </div>
              </header>
              <For each={props.permissions}>
                {(request) => <PermissionPanel request={request} tool={permissionToolPart(request, props.data.messages)} reply={props.replyPermission} />}
              </For>
              <For each={props.questions}>
                {(request) => <QuestionPanel request={request} reply={props.replyQuestion} reject={props.rejectQuestion} />}
              </For>
            </div>
            <TranscriptPanel
              sessionID={selected().id}
              data={props.data}
              loading={props.loading}
              running={running()}
              providers={props.providers}
              messageWindow={props.messageWindow}
              loadOlderMessages={props.loadOlderMessages}
              reloadLatestMessages={props.reloadLatestMessages}
              onFollowBottomChange={props.onFollowBottomChange}
            />
            <form class="composer" onSubmit={submitComposer}>
              <div class={`composer-input ${mode()}`}>
                <textarea
                  ref={composerTextarea}
                  disabled={blocked()}
                  value={draftPrompt()}
                  onInput={(event) => {
                    setDraftPrompt(event.currentTarget.value)
                  }}
                  onKeyDown={(event) => {
                    if (event.ctrlKey && event.key.toLowerCase() === "t") {
                      event.preventDefault()
                      if (!blocked()) cycleVariant()
                      return
                    }
                    if (event.key === "Tab") {
                      event.preventDefault()
                      if (!blocked()) toggleMode()
                      return
                    }
                    if (event.key !== "Enter" || event.shiftKey) return
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }}
                  placeholder={blocked() ? "Reply to the pending permission/question before continuing..." : "Message OpencodeX..."}
                />
                <div class="composer-footer">
                  <div class="composer-meta" aria-live="polite">
                    <button class={`mode-chip ${mode()}`} type="button" disabled={blocked()} onClick={toggleMode} title="Toggle Build/Plan mode">
                      {mode() === "plan" ? "Plan" : "Build"}
                    </button>
                    <button class="model-menu" type="button" disabled={blocked()} onClick={() => setModelPickerOpen(true)} title="Choose model">{modelLabel()}</button>
                    <Show when={variants().length > 0}>
                      <div
                        class="variant-menu-wrap"
                        onFocusOut={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setVariantPickerOpen(false)
                        }}
                      >
                        <button
                          class="variant-trigger"
                          type="button"
                          disabled={blocked()}
                          aria-haspopup="listbox"
                          aria-expanded={variantPickerOpen()}
                          title="Change variant (Ctrl+T to cycle)"
                          onClick={() => setVariantPickerOpen((open) => !open)}
                        >
                          {variantLabel()}
                        </button>
                        <Show when={variantPickerOpen()}>
                          <div class="variant-menu" role="listbox" aria-label="Choose variant">
                            <button type="button" role="option" aria-selected={props.selectedVariant === ""} classList={{ selected: props.selectedVariant === "" }} onClick={() => selectVariant("")}>Default</button>
                            <For each={variants()}>
                              {(variant) => (
                                <button type="button" role="option" aria-selected={props.selectedVariant === variant} classList={{ selected: props.selectedVariant === variant }} onClick={() => selectVariant(variant)}>
                                  {variant}
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>
                  <button class="send-button" type="submit" title="Send message" aria-label="Send message" disabled={blocked() || draftText().length === 0}>
                    <Icon name="send" />
                  </button>
                </div>
              </div>
              <div class="composer-running" aria-live="polite">
                <span class="composer-running-left">
                  <Show when={running()} fallback={<span class="composer-running-placeholder" aria-hidden="true" />}>
                    <span class="composer-spinner" aria-label="running" />
                    <span class="composer-interrupt" aria-label="Press escape to interrupt the model">
                      <span class="composer-interrupt-key">esc</span>{" "}
                      <span class="composer-interrupt-action">interrupt</span>
                    </span>
                  </Show>
                </span>
                <span class="composer-running-right">
                  <Show when={usageLabel()}>
                    {(usage) => <span class="composer-token-usage">{usage()}</span>}
                  </Show>
                  <span class="composer-command-hint"><span>ctrl+p</span> commands</span>
                </span>
              </div>
            </form>
            <Show when={modelPickerOpen()}>
              <div
                class="dialog-backdrop"
                onMouseDown={() => setModelPickerOpen(false)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return
                  event.preventDefault()
                  event.stopPropagation()
                  setModelPickerOpen(false)
                }}
              >
                <section class="model-picker-modal" onMouseDown={(event) => event.stopPropagation()}>
                  <header>
                    <div>
                      <h2>Select model</h2>
                      <p>Recent routes are listed first, matching the TUI picker.</p>
                    </div>
                    <button type="button" aria-label="Close model picker" onClick={() => setModelPickerOpen(false)}>×</button>
                  </header>
                  <input value={modelQuery()} onInput={(event) => setModelQuery(event.currentTarget.value)} placeholder="Search models or providers" autofocus />
                  <div class="model-picker-list">
                    <Show when={filteredRecentModelOptions().length > 0}>
                      <ModelPickerSection title="Recently used" selectedModel={props.selectedModel} options={filteredRecentModelOptions()} select={selectModel} />
                    </Show>
                    <For each={filteredProviderModelOptions()}>
                      {(group) => (
                        <ModelPickerSection
                          title={group.provider.name}
                          selectedModel={props.selectedModel}
                          options={group.models.map((model) => ({ provider: group.provider, model }))}
                          select={selectModel}
                        />
                      )}
                    </For>
                    <Show when={filteredRecentModelOptions().length === 0 && filteredProviderModelOptions().length === 0}>
                      <p class="model-picker-empty">No matching models.</p>
                    </Show>
                  </div>
                </section>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

type ModelPickerOption = { provider: Provider; model: Provider["models"][string] }

function TranscriptPanel(props: {
  sessionID: string
  data: SessionData
  loading: boolean
  running: boolean
  providers: Provider[]
  messageWindow: MessageWindow
  loadOlderMessages?: (cursor: string) => Promise<void>
  reloadLatestMessages?: () => Promise<void>
  onFollowBottomChange?: (sessionID: string, value: boolean) => void
}) {
  const TRANSCRIPT_BOTTOM_THRESHOLD = 8
  let transcript: HTMLElement | undefined
  let followFrame: number | undefined
  let bottomFrame: number | undefined
  let activeSessionID = ""
  let observedRenderKey = ""
  let followingBottom = true
  let topFrame: number | undefined
  let bottomStableFrames = 0
  let bottomStableTarget = 0
  let bottomFrameBudget = 0
  let bottomLastHeight = -1
  const [olderMessagesLoading, setOlderMessagesLoading] = createSignal(false)
  const [latestMessagesLoading, setLatestMessagesLoading] = createSignal(false)
  const visibleMessages = createMemo(() => props.data.messages)
  const visiblePartCount = createMemo(() => visibleMessages().reduce((total, message) => total + message.parts.length, 0))
  const renderKey = createMemo(() => [
    props.sessionID,
    props.loading ? "loading" : "ready",
    visibleMessages()[0]?.info.id ?? "",
    visibleMessages().at(-1)?.info.id ?? "",
    visiblePartCount(),
    props.data.messageTailDetached ? "detached" : "latest",
  ].join("\0"))
  const nearBottom = () => transcript ? transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <= TRANSCRIPT_BOTTOM_THRESHOLD : true
  const setFollowingBottom = (value: boolean) => {
    followingBottom = value && props.data.messageTailDetached !== true
    props.onFollowBottomChange?.(props.sessionID, followingBottom)
  }
  const forceFollowingBottom = () => {
    followingBottom = true
    props.onFollowBottomChange?.(props.sessionID, true)
  }
  const cancelBottomScroll = () => {
    if (bottomFrame === undefined) return
    cancelAnimationFrame(bottomFrame)
    bottomFrame = undefined
    bottomStableFrames = 0
    bottomFrameBudget = 0
  }
  const cancelTopScroll = () => {
    if (topFrame === undefined) return
    cancelAnimationFrame(topFrame)
    topFrame = undefined
  }
  const updateFollowingFromScroll = () => {
    setFollowingBottom(nearBottom())
  }
  const scheduleFollowingUpdate = () => {
    if (followFrame !== undefined) return
    followFrame = requestAnimationFrame(() => {
      followFrame = undefined
      updateFollowingFromScroll()
    })
  }
  const scrollToBottom = () => {
    if (!transcript) return
    transcript.scrollTop = transcript.scrollHeight
    setFollowingBottom(nearBottom())
  }
  const continueBottomScroll = (key: string) => {
    bottomFrame = requestAnimationFrame(() => {
      bottomFrame = undefined
      if (renderKey() !== key || !followingBottom || props.data.messageTailDetached) return
      const height = transcript?.scrollHeight ?? 0
      scrollToBottom()
      bottomStableFrames = height === bottomLastHeight ? bottomStableFrames + 1 : 0
      bottomLastHeight = height
      bottomFrameBudget -= 1
      if (bottomFrameBudget > 0 && bottomStableFrames < bottomStableTarget) continueBottomScroll(key)
    })
  }
  const scheduleBottomScroll = (key: string, stableFrames: number, frameBudget: number) => {
    cancelBottomScroll()
    bottomStableFrames = 0
    bottomStableTarget = stableFrames
    bottomFrameBudget = frameBudget
    bottomLastHeight = -1
    continueBottomScroll(key)
  }
  const handleUserScrollIntent = () => {
    cancelBottomScroll()
    scheduleFollowingUpdate()
  }
  const loadOlderMessages = async () => {
    const cursor = props.data.messageCursor
    if (!cursor || !props.loadOlderMessages || olderMessagesLoading()) return
    const restoreTop = transcript?.scrollTop ?? 0
    const restoreHeight = transcript?.scrollHeight ?? 0
    cancelBottomScroll()
    setFollowingBottom(false)
    setOlderMessagesLoading(true)
    await props.loadOlderMessages(cursor).finally(() => {
      setOlderMessagesLoading(false)
      cancelTopScroll()
      topFrame = requestAnimationFrame(() => {
        topFrame = undefined
        if (transcript) transcript.scrollTop = restoreTop + Math.max(0, transcript.scrollHeight - restoreHeight)
        updateFollowingFromScroll()
      })
    })
  }
  const reloadLatestMessages = async () => {
    if (!props.reloadLatestMessages || latestMessagesLoading()) return
    cancelBottomScroll()
    forceFollowingBottom()
    setLatestMessagesLoading(true)
    await props.reloadLatestMessages().finally(() => {
      setLatestMessagesLoading(false)
      scheduleBottomScroll(renderKey(), 10, 90)
    })
  }
  const handleScroll = () => {
    if (!nearBottom()) {
      cancelBottomScroll()
      if (followingBottom) setFollowingBottom(false)
    }
    scheduleFollowingUpdate()
  }

  onCleanup(() => {
    cancelBottomScroll()
    cancelTopScroll()
    if (followFrame !== undefined) cancelAnimationFrame(followFrame)
  })
  createEffect(() => {
    const key = renderKey()
    const sessionChanged = activeSessionID !== props.sessionID
    activeSessionID = props.sessionID
    if (sessionChanged) {
      observedRenderKey = ""
      setFollowingBottom(props.data.messageTailDetached !== true)
    }
    if (props.data.messageTailDetached) {
      observedRenderKey = key
      setFollowingBottom(false)
      return
    }
    if (props.loading || visibleMessages().length === 0) return
    if (!observedRenderKey) {
      observedRenderKey = key
      setFollowingBottom(true)
      scheduleBottomScroll(key, 10, 90)
      return
    }
    if (observedRenderKey === key) return
    observedRenderKey = key
    if (followingBottom) scheduleBottomScroll(key, props.running ? 2 : 1, props.running ? 12 : 4)
  })

  return (
    <section class="transcript" ref={transcript} onScroll={handleScroll} onWheel={handleUserScrollIntent} onPointerDown={handleUserScrollIntent} onTouchStart={handleUserScrollIntent}>
      <div class="transcript-content">
        <Show when={!props.loading} fallback={<TranscriptLoadingState />}>
          <Show when={props.data.messageCursor}>
            <Show when={olderMessagesLoading()} fallback={
              <button type="button" class="transcript-window-button" onClick={() => void loadOlderMessages()}>
                Load more
              </button>
            }>
              <div class="transcript-page-loader" aria-live="polite" aria-busy="true">
                <span class="session-loading-spinner" />
                <span>Loading older messages...</span>
              </div>
            </Show>
          </Show>
          <For each={visibleMessages()} fallback={<SessionEmptyState />}>
            {(bundle, index) => (
              <article class={`message ${bundle.info.role}`}>
                <Show when={showTranscriptHeader(visibleMessages(), index())}>
                  <header>{transcriptHeaderLabel(bundle.info, props.providers)}</header>
                </Show>
                <For each={groupTranscriptParts(bundle.parts)}>
                  {(item) => <DisplayPartView item={item} />}
                </For>
              </article>
            )}
          </For>
          <Show when={props.data.messageTailDetached}>
            <button type="button" class="transcript-window-button transcript-latest-button" disabled={latestMessagesLoading()} onClick={() => void reloadLatestMessages()}>
              {latestMessagesLoading() ? "Loading latest messages..." : "Jump to latest messages"}
            </button>
          </Show>
        </Show>
      </div>
    </section>
  )
}

function showTranscriptHeader(messages: MessageBundle[], index: number) {
  const message = messages[index]
  if (!message) return false
  if (message.info.role === "user") return true
  return messages[index - 1]?.info.role === "user"
}

function transcriptHeaderLabel(message: MessageBundle["info"], providers: Provider[]) {
  if (message.role === "user") return "User"
  return assistantModelLabel(message, providers)
}

function assistantModelLabel(message: AssistantMessage, providers: Provider[]) {
  const model = providers.find((provider) => provider.id === message.providerID)?.models[message.modelID]
  return model?.name ?? prettifyModelID(message.modelID)
}

function prettifyModelID(modelID: string) {
  return modelID
    .split(/[/:_-]+/)
    .filter(Boolean)
    .map((part) => part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function ModelPickerSection(props: { title: string; selectedModel: string; options: ModelPickerOption[]; select: (providerID: string, modelID: string) => void }) {
  return (
    <section class="model-picker-section">
      <h3>{props.title}</h3>
      <div>
        <For each={props.options}>
          {(option) => {
            const value = modelValue(option.provider.id, option.model.id)
            return (
              <button type="button" classList={{ selected: props.selectedModel === value }} onClick={() => props.select(option.provider.id, option.model.id)}>
                <span>{option.model.name ?? option.model.id}</span>
                <small>{option.provider.name}</small>
                <Show when={isFreeOpencodeModel(option.provider, option.model)}><em>Free</em></Show>
              </button>
            )
          }}
        </For>
      </div>
    </section>
  )
}

function filterModelOptions(options: ModelPickerOption[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return options
  return options.filter((option) => `${option.model.name ?? option.model.id} ${option.provider.name}`.toLowerCase().includes(needle))
}

function modelPickerOptions(providers: Provider[]): ModelPickerOption[] {
  return providers
    .toSorted((a, b) => Number(a.id !== "opencode") - Number(b.id !== "opencode") || a.name.localeCompare(b.name))
    .flatMap((provider) =>
      Object.values(provider.models)
        .filter((model) => model.status !== "deprecated")
        .toSorted((a, b) => Number(!isFreeOpencodeModel(provider, a)) - Number(!isFreeOpencodeModel(provider, b)) || (a.name ?? a.id).localeCompare(b.name ?? b.id))
        .map((model) => ({ provider, model })),
    )
}

function selectedModelVariants(providers: Provider[], selectedModel: string) {
  const selection = parseModelValue(selectedModel)
  if (!selection) return []
  return Object.keys(providers.find((provider) => provider.id === selection.providerID)?.models[selection.modelID]?.variants ?? {})
}

function isFreeOpencodeModel(provider: Provider, model: Provider["models"][string]) {
  return provider.id === "opencode" && model.cost?.input === 0
}

function PermissionPanel(props: { request: PermissionRequest; tool?: Extract<Part, { type: "tool" }>; reply: (request: PermissionRequest, reply: "once" | "always" | "reject") => void }) {
  const input = () => toolInput(props.request, props.tool)
  return (
    <section class="safety-panel permission-panel">
      <div>
        <p class="eyebrow">Permission Required</p>
        <h2>{permissionTitle(props.request, input())}</h2>
        <Show when={props.request.patterns.length > 0}>
          <p>Patterns: {props.request.patterns.join(", ")}</p>
        </Show>
        <Show when={props.tool}>
          {(tool) => (
            <details class="permission-context" open>
              <summary>Tool Context: {tool().tool}</summary>
              <Show when={Object.keys(input()).length > 0}>
                <pre>{JSON.stringify(input(), null, 2)}</pre>
              </Show>
              <Show when={toolOutput(tool().state)}>
                {(output) => <pre>{collapseOutput(output()).output}</pre>}
              </Show>
              <Show when={toolError(tool().state)}>
                {(error) => <pre>{error()}</pre>}
              </Show>
            </details>
          )}
        </Show>
        <Show when={permissionDiff(props.request)}>
          {(diff) => (
            <details class="permission-context" open>
              <summary>Requested Diff</summary>
              <pre>{diff()}</pre>
            </details>
          )}
        </Show>
        <Show when={Object.keys(props.request.metadata).length > 0}>
          <details class="permission-context">
            <summary>Raw Metadata</summary>
            <pre>{JSON.stringify(props.request.metadata, null, 2)}</pre>
          </details>
        </Show>
      </div>
      <div class="safety-actions">
        <button class="secondary danger" onClick={() => props.reply(props.request, "reject")}>Reject</button>
        <button class="secondary" onClick={() => props.reply(props.request, "once")}>Allow Once</button>
        <button class="primary" onClick={() => props.reply(props.request, "always")}>Always Allow</button>
      </div>
    </section>
  )
}

function QuestionPanel(props: { request: QuestionRequest; reply: (request: QuestionRequest, answers: QuestionAnswer[]) => void; reject: (request: QuestionRequest) => void }) {
  const [answers, setAnswers] = createSignal<QuestionAnswer[]>(props.request.questions.map(() => []))
  const [custom, setCustom] = createSignal<string[]>(props.request.questions.map(() => ""))
  const finalAnswers = () =>
    answers().map((answer, index) => {
      const text = custom()[index]?.trim()
      if (!text) return answer
      return [...answer, text]
    })
  const valid = () => finalAnswers().every((answer) => answer.length > 0)
  function toggle(index: number, label: string, multiple?: boolean) {
    setAnswers((current) =>
      current.map((answer, i) => {
        if (i !== index) return answer
        if (!multiple) return [label]
        if (answer.includes(label)) return answer.filter((item) => item !== label)
        return [...answer, label]
      }),
    )
  }
  function updateCustom(index: number, value: string) {
    setCustom((current) => current.map((item, i) => (i === index ? value : item)))
  }
  return (
    <section class="safety-panel question-panel">
      <div>
        <p class="eyebrow">Question Pending</p>
        <For each={props.request.questions}>
          {(question, index) => (
            <div class="question-block">
              <h2>{question.header}</h2>
              <p>{question.question}</p>
              <div class="option-list">
                <For each={question.options}>
                  {(option) => (
                    <button
                      classList={{ selected: answers()[index()].includes(option.label) }}
                      onClick={() => toggle(index(), option.label, question.multiple)}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.description}</span>
                    </button>
                  )}
                </For>
              </div>
              <Show when={question.custom !== false}>
                <input
                  class="custom-answer"
                  value={custom()[index()] ?? ""}
                  onInput={(event) => updateCustom(index(), event.currentTarget.value)}
                  placeholder="Type a custom answer"
                />
              </Show>
            </div>
          )}
        </For>
      </div>
      <div class="safety-actions">
        <button class="secondary danger" onClick={() => props.reject(props.request)}>Reject</button>
        <button class="primary" disabled={!valid()} onClick={() => props.reply(props.request, finalAnswers())}>Reply</button>
      </div>
    </section>
  )
}

type ToolPart = Extract<Part, { type: "tool" }>
type DisplayPart = { type: "part"; part: Part } | { type: "tool-group"; tool: string; parts: ToolPart[] }

function groupTranscriptParts(parts: Part[]): DisplayPart[] {
  const result: DisplayPart[] = []
  let pending: ToolPart[] = []

  function flush() {
    if (pending.length === 0) return
    if (pending.length === 1) result.push({ type: "part", part: pending[0] })
    else result.push({ type: "tool-group", tool: pending[0].tool, parts: pending })
    pending = []
  }

  for (const part of parts) {
    if (part.type === "tool" && isGroupableTool(part.tool)) {
      if (pending.length === 0 || pending[0].tool === part.tool) {
        pending.push(part)
        continue
      }
    }
    flush()
    result.push({ type: "part", part })
  }
  flush()
  return result
}

function isGroupableTool(tool: string) {
  return tool === "read" || tool === "grep" || tool === "glob" || tool === "webfetch" || tool === "websearch" || tool === "skill"
}

function DisplayPartView(props: { item: DisplayPart }) {
  return (
    <Switch>
      <Match when={props.item.type === "tool-group"}>
        <ToolGroupView item={props.item as Extract<DisplayPart, { type: "tool-group" }>} />
      </Match>
      <Match when={props.item.type === "part"}>
        <PartView part={(props.item as Extract<DisplayPart, { type: "part" }>).part} />
      </Match>
    </Switch>
  )
}

function ToolGroupView(props: { item: Extract<DisplayPart, { type: "tool-group" }> }) {
  const status = createMemo(() => toolGroupStatus(props.item.parts))
  const startCollapsed = createMemo(() => props.item.tool === "read" && props.item.parts.length > 10)
  const [expanded, setExpanded] = createSignal(!startCollapsed())
  return (
    <details class={`part tool tool-group ${status()}`} open={expanded()} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        <DisclosureChevron />
        <strong>{toolGroupTitle(props.item.tool, props.item.parts)}</strong>
        <span class="tool-status">{startCollapsed() && !expanded() ? "Click to expand" : status()}</span>
      </summary>
      <Show when={expanded()}>
        <div class="tool-group-list">
          <For each={props.item.parts}>
            {(part) => {
              const input = toolStateInput(part.state)
              const metadata = toolMetadata(part.state) ?? {}
              return (
                <div class="tool-group-item">
                  <span>{toolDisplayTitle(part.tool, input, metadata)}</span>
                  <small>{part.state.status}</small>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </details>
  )
}

function toolGroupStatus(parts: ToolPart[]) {
  if (parts.some((part) => part.state.status === "error")) return "error"
  if (parts.some((part) => part.state.status === "running")) return "running"
  if (parts.every((part) => part.state.status === "completed")) return "completed"
  return parts.at(-1)?.state.status ?? "pending"
}

function toolGroupTitle(tool: string, parts: ToolPart[]) {
  if (tool === "read") return `Read ${parts.length} files`
  if (tool === "grep") return `Grep ${parts.length} searches`
  if (tool === "glob") return `Glob ${parts.length} searches`
  if (tool === "webfetch") return `WebFetch ${parts.length} URLs`
  if (tool === "websearch") return `WebSearch ${parts.length} queries`
  if (tool === "skill") return `Loaded ${parts.length} skills`
  return `${tool} x${parts.length}`
}

function PartView(props: { part: MessageBundle["parts"][number] }) {
  return (
    <Switch fallback={<pre class="part muted">{JSON.stringify(props.part, null, 2)}</pre>}>
      <Match when={isStructuralPart(props.part)}>
        <></>
      </Match>
      <Match when={props.part.type === "text" || props.part.type === "reasoning"}>
        <TextPartView part={props.part as Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }>} />
      </Match>
      <Match when={props.part.type === "tool"}>
        <ToolPartView part={props.part as Extract<Part, { type: "tool" }>} />
      </Match>
      <Match when={props.part.type === "file"}>
        <div class="part file">File: {props.part.type === "file" ? props.part.filename ?? props.part.url : ""}</div>
      </Match>
      <Match when={props.part.type === "agent"}>
        <div class="part badge">Agent: {props.part.type === "agent" ? props.part.name : ""}</div>
      </Match>
      <Match when={props.part.type === "patch"}>
        <div class="part badge">Patch: {props.part.type === "patch" ? props.part.files.join(", ") : ""}</div>
      </Match>
      <Match when={props.part.type === "compaction"}>
        <div class="part badge">Compaction {props.part.type === "compaction" && props.part.auto ? "auto" : "manual"}</div>
      </Match>
    </Switch>
  )
}

function isStructuralPart(part: MessageBundle["parts"][number]) {
  return part.type === "step-start" || part.type === "step-finish" || part.type === "snapshot" || part.type === "retry" || part.type === "subtask"
}

function TextPartView(props: { part: Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }> }) {
  const text = createMemo(() => {
    if ("synthetic" in props.part && props.part.synthetic) return ""
    if ("ignored" in props.part && props.part.ignored) return ""
    return props.part.text.trim()
  })
  return (
    <Show when={text()}>
      <div class={`part text ${props.part.type}`}>
        <Show when={props.part.type === "reasoning"} fallback={<Markdown text={text()} cacheKey={props.part.id} streaming={false} />}>
          <details class="thinking-block" open>
            <summary>
              <DisclosureChevron />
              <span>Thinking</span>
            </summary>
            <Markdown text={text()} cacheKey={props.part.id} streaming={false} />
          </details>
        </Show>
      </div>
    </Show>
  )
}

function ToolPartView(props: { part: Extract<Part, { type: "tool" }> }) {
  const state = () => props.part.state
  const toolClass = () => props.part.tool === "todowrite" ? "todo-update" : ""
  const input = createMemo(() => toolStateInput(state()))
  const metadata = createMemo(() => toolMetadata(state()) ?? {})
  const error = createMemo(() => toolError(state()))
  const output = createMemo(() => toolVisibleOutput(props.part.tool, state(), metadata()))
  const title = createMemo(() => toolDisplayTitle(props.part.tool, input(), metadata()))
  const hasDetails = createMemo(() => toolHasVisibleDetails(props.part.tool, input(), metadata(), output(), error()))
  const defaultOpen = createMemo(() => hasDetails() && (props.part.tool === "todowrite" || props.part.tool === "apply_patch" || state().status === "running" || state().status === "error"))
  const [expanded, setExpanded] = createSignal(defaultOpen())
  createEffect(() => {
    if (defaultOpen()) setExpanded(true)
  })
  return (
    <Show when={hasDetails()} fallback={
      <div class={`part tool ${state().status} ${toolClass()} no-details`}>
        <div class="tool-summary">
          <strong>{title()}</strong>
          <span class="tool-status">{state().status}</span>
        </div>
      </div>
    }>
      <details class={`part tool ${state().status} ${toolClass()}`} open={expanded()} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>
          <DisclosureChevron />
          <strong>{title()}</strong>
          <span class="tool-status">{state().status}</span>
        </summary>
        <Show when={expanded()}>
          <ToolDetails tool={props.part.tool} input={input()} metadata={metadata()} output={output()} error={error()} />
          <Show when={shouldShowRawToolData(props.part.tool, input(), metadata())}>
            <details class="tool-raw">
              <summary>
                <DisclosureChevron />
                <span>Raw tool data</span>
              </summary>
              <Show when={Object.keys(input()).length > 0}>
                <label>Input</label>
                <ToolCodeBlock language="json" code={JSON.stringify(input(), null, 2)} />
              </Show>
              <Show when={Object.keys(metadata()).length > 0}>
                <label>Metadata</label>
                <ToolCodeBlock language="json" code={JSON.stringify(metadata(), null, 2)} />
              </Show>
            </details>
          </Show>
        </Show>
      </details>
    </Show>
  )
}

function ToolDetails(props: { tool: string; input: Record<string, unknown>; metadata: Record<string, unknown>; output: string; error?: string }) {
  const diagnostics = createMemo(() => arrayValue(props.metadata.diagnostics))
  return (
    <div class="tool-details">
      <Switch fallback={<GenericToolDetails input={props.input} metadata={props.metadata} output={props.output} error={props.error} />}>
        <Match when={props.tool === "bash" || props.tool === "shell"}>
          <ToolShellBlock command={stringValue(props.input.command)} output={props.output} />
        </Match>
        <Match when={props.tool === "grep" || props.tool === "glob"}>
          <ToolOutput output={props.output} maxLines={15} compact />
        </Match>
        <Match when={props.tool === "read"}>
          <></>
        </Match>
        <Match when={props.tool === "write"}>
          <Show when={stringValue(props.input.content)}>
            {(content) => <ToolCodeBlock class="tool-code" language={languageFromPath(stringValue(props.input.filePath))} code={content()} />}
          </Show>
          <ToolDiagnostics diagnostics={diagnostics()} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "edit"}>
          <ToolDiffs input={props.input} metadata={props.metadata} />
          <ToolDiagnostics diagnostics={diagnostics()} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "apply_patch"}>
          <ToolDiffs input={props.input} metadata={props.metadata} />
          <ToolDiagnostics diagnostics={diagnostics()} />
        </Match>
        <Match when={props.tool === "todowrite"}>
          <ToolTodos input={props.input} metadata={props.metadata} />
        </Match>
        <Match when={props.tool === "question"}>
          <ToolQuestions input={props.input} metadata={props.metadata} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "task"}>
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "webfetch" || props.tool === "websearch"}>
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "skill"}>
          <ToolOutput output={props.output} />
        </Match>
      </Switch>
      <Show when={props.error}>
        {(error) => <pre class="tool-error">{error()}</pre>}
      </Show>
    </div>
  )
}

function ToolShellBlock(props: { command?: string; output: string }) {
  return (
    <>
      <Show when={props.command}>
        {(command) => <pre class="tool-command">$ {command()}</pre>}
      </Show>
      <ToolOutput output={props.output} />
    </>
  )
}

function GenericToolDetails(props: { input: Record<string, unknown>; metadata: Record<string, unknown>; output: string; error?: string }) {
  return (
    <>
      <ToolKeyValues values={Object.entries(props.input).slice(0, 8).map(([key, value]) => field(key, value))} />
      <ToolOutput output={props.output} />
    </>
  )
}

function ToolKeyValues(props: { values: Array<{ label: string; value: unknown }> }) {
  const values = createMemo(() => props.values.filter((item) => item.value !== undefined && item.value !== null && item.value !== ""))
  return (
    <Show when={values().length > 0}>
      <dl class="tool-kv">
        <For each={values()}>
          {(item) => (
            <div>
              <dt>{item.label}</dt>
              <dd>{formatToolValue(item.value)}</dd>
            </div>
          )}
        </For>
      </dl>
    </Show>
  )
}

function ToolOutput(props: { output: string; maxLines?: number; compact?: boolean }) {
  const [expanded, setExpanded] = createSignal(false)
  const trimmed = createMemo(() => props.output.trim())
  const collapsed = createMemo(() => props.maxLines ? collapseLineOutput(trimmed(), props.maxLines) : collapseDiffOutput(trimmed()))
  const visible = createMemo(() => expanded() || !collapsed().overflow ? trimmed() : collapsed().output)
  return (
    <Show when={trimmed()}>
      <div class="tool-output" classList={{ compact: props.compact === true }}>
        <pre>{visible()}</pre>
        <Show when={collapsed().overflow}>
          <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded() ? "Click to collapse" : "Click to expand"}</button>
        </Show>
      </div>
    </Show>
  )
}

function ToolCodeBlock(props: { code: string; language?: string; class?: string }) {
  return <CodeBlock class={props.class} language={props.language || "text"} code={props.code} />
}

function ToolDiffs(props: { input: Record<string, unknown>; metadata: Record<string, unknown> }) {
  const files = createMemo(() => arrayValue(props.metadata.files).filter(isRecordValue))
  return (
    <>
      <Show when={files().length === 0 ? stringValue(props.metadata.diff) : undefined}>
        {(diff) => <ToolDiff title={stringValue(props.input.filePath) ?? "patch"} diff={diff()} filePath={stringValue(props.input.filePath)} />}
      </Show>
      <For each={files()}>
        {(file) => {
          const patch = stringValue(file.patch)
          const name = stringValue(file.relativePath) ?? stringValue(file.filePath) ?? stringValue(file.movePath) ?? "file"
          const filePath = stringValue(file.filePath) ?? stringValue(file.movePath) ?? name
          const type = stringValue(file.type)
          return (
            <Show when={patch || type === "delete"}>
              <Show when={patch} fallback={<ToolDeletedLines title={toolPatchTitle(type, name, file)} filePath={filePath} deletions={numberValue(file.deletions) ?? 0} />}>
                {(diff) => <ToolDiff title={toolPatchTitle(type, name, file)} diff={diff()} filePath={filePath} />}
              </Show>
            </Show>
          )
        }}
      </For>
    </>
  )
}

function ToolDiff(props: { title: string; diff: string; filePath?: string }) {
  const contents = createMemo(() => patchContents(props.diff, props.filePath ?? props.title))
  return (
    <section class="tool-diff">
      <div class="tool-file-diff">
        <ToolDiffHeader title={props.title} filePath={props.filePath} />
        <Show when={contents()} fallback={<ToolCodeBlock language="diff" code={props.diff} />}>
          {(value) => (
            <FileDiffView mode="diff" before={value().before} after={value().after} diffStyle="split" virtualize={false} hunkSeparators="simple" />
          )}
        </Show>
      </div>
    </section>
  )
}

function ToolDeletedLines(props: { title: string; filePath?: string; deletions: number }) {
  return (
    <section class="tool-diff">
      <div class="tool-file-diff">
        <ToolDiffHeader title={props.title} filePath={props.filePath} />
        <p class="tool-deleted-lines">-{props.deletions} line{props.deletions === 1 ? "" : "s"}</p>
      </div>
    </section>
  )
}

function ToolDiffHeader(props: { title: string; filePath?: string }) {
  const path = createMemo(() => props.filePath ?? props.title)
  const filename = createMemo(() => path().split(/[\\/]/).filter(Boolean).at(-1) ?? path())
  return (
    <header class="tool-file-diff-header">
      <strong>{filename()}</strong>
      <Show when={path() !== filename()}>
        <span>{path()}</span>
      </Show>
    </header>
  )
}

function ToolDiagnostics(props: { diagnostics: unknown[] }) {
  return (
    <Show when={props.diagnostics.length > 0}>
      <div class="tool-diagnostics">
        <ToolCodeBlock language="json" code={JSON.stringify(props.diagnostics, null, 2)} />
      </div>
    </Show>
  )
}

function ToolTodos(props: { input: Record<string, unknown>; metadata: Record<string, unknown> }) {
  const todos = createMemo(() => arrayValue(props.metadata.todos).length > 0 ? arrayValue(props.metadata.todos) : arrayValue(props.input.todos))
  return (
    <Show when={todos().length > 0}>
      <div class="tool-todos">
        <For each={todos().filter(isRecordValue)}>
          {(todo) => {
            const status = stringValue(todo.status) ?? "pending"
            return (
              <div class={`tool-todo ${status}`}>
                <span class="tool-todo-status" title={formatTodoStatus(status)} aria-label={formatTodoStatus(status)}>
                  <Show when={todoStatusIcon(status)}>
                    {(icon) => <Icon name={icon()} />}
                  </Show>
                </span>
                <strong>{stringValue(todo.content) ?? "Todo"}</strong>
                <small>{stringValue(todo.priority) ?? ""}</small>
              </div>
            )
          }}
        </For>
      </div>
    </Show>
  )
}

function ToolQuestions(props: { input: Record<string, unknown>; metadata: Record<string, unknown> }) {
  const questions = createMemo(() => arrayValue(props.input.questions).filter(isRecordValue))
  const answers = createMemo(() => arrayValue(props.metadata.answers))
  return (
    <Show when={questions().length > 0}>
      <div class="tool-questions">
        <For each={questions()}>
          {(question, index) => <div><strong>{stringValue(question.question) ?? stringValue(question.header) ?? "Question"}</strong><p>{formatToolValue(answers()[index()] ?? "No answer")}</p></div>}
        </For>
      </div>
    </Show>
  )
}

function toolStateInput(state: Extract<Part, { type: "tool" }>["state"]) {
  if ("input" in state && isRecordValue(state.input)) return state.input
  return {}
}

function toolVisibleOutput(tool: string, state: Extract<Part, { type: "tool" }>["state"], metadata: Record<string, unknown>) {
  const output = toolOutput(state)
  if (output) return tool === "bash" || tool === "shell" ? stripAnsiBasic(output) : output
  if ((tool === "bash" || tool === "shell") && typeof metadata.output === "string") return stripAnsiBasic(metadata.output)
  return ""
}

function toolDisplayTitle(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown>) {
  if (tool === "bash" || tool === "shell") return stringValue(input.description) ?? stringValue(input.command) ?? "Shell"
  if (tool === "grep") return `Grep ${quoteValue(input.pattern)}${inPath(input.path)}${countSuffix(metadata.matches, "match")}`
  if (tool === "glob") return `Glob ${quoteValue(input.pattern)}${inPath(input.path)}${countSuffix(metadata.count, "match")}`
  if (tool === "read") return `Read ${stringValue(input.filePath) ?? "file"}`
  if (tool === "write") return `Write ${stringValue(input.filePath) ?? "file"}`
  if (tool === "edit") return `Edit ${stringValue(input.filePath) ?? "file"}`
  if (tool === "apply_patch") return "Patch"
  if (tool === "todowrite") return "Update todos"
  if (tool === "question") return `Ask ${arrayValue(input.questions).length || ""} question${arrayValue(input.questions).length === 1 ? "" : "s"}`.trim()
  if (tool === "task") return `${stringValue(input.subagent_type) ?? "General"} task: ${stringValue(input.description) ?? "subagent"}`
  if (tool === "webfetch") return `WebFetch ${stringValue(input.url) ?? ""}`.trim()
  if (tool === "websearch") return `WebSearch ${quoteValue(input.query)}`
  if (tool === "skill") return `Skill ${stringValue(input.name) ?? ""}`.trim()
  return tool
}

function toolHasRichDetails(tool: string, metadata: Record<string, unknown>, input: Record<string, unknown>) {
  return Boolean(
    stringValue(metadata.diff) ||
    arrayValue(metadata.files).length ||
    arrayValue(metadata.todos).length ||
    arrayValue(input.todos).length ||
    arrayValue(input.questions).length ||
    stringValue(input.content),
  )
}

function toolHasVisibleDetails(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown>, output: string, error?: string) {
  if (error) return true
  if (tool === "read") return false
  if (output.trim()) return true
  if (toolHasRichDetails(tool, metadata, input)) return true
  if (arrayValue(metadata.diagnostics).length > 0) return true
  return shouldShowRawToolData(tool, input, metadata)
}

function shouldShowRawToolData(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown>) {
  if (COMMON_TOOL_IDS.has(tool)) return false
  return Object.keys(input).length > 0 || Object.keys(metadata).length > 0
}

const COMMON_TOOL_IDS = new Set([
  "apply_patch",
  "bash",
  "edit",
  "glob",
  "grep",
  "question",
  "read",
  "shell",
  "skill",
  "task",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
])

function field(label: string, value: unknown) {
  return { label, value }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function formatToolValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map(formatToolValue).join(", ")
  if (value === null || value === undefined) return ""
  return JSON.stringify(value)
}

function quoteValue(value: unknown) {
  const text = stringValue(value)
  return text ? `"${text}"` : ""
}

function inPath(value: unknown) {
  const path = stringValue(value)
  return path ? ` in ${path}` : ""
}

function countSuffix(value: unknown, noun: string) {
  const count = numberValue(value)
  if (!count) return ""
  return ` (${count} ${noun}${count === 1 ? "" : "es"})`
}

function toolPatchTitle(type: string | undefined, name: string, file: Record<string, unknown>) {
  if (type === "delete") return `Deleted ${name}`
  if (type === "add") return `Created ${name}`
  if (type === "move") return `Moved ${stringValue(file.filePath) ?? name} -> ${name}`
  return `Patched ${name}`
}

function formatTodoStatus(status: string | undefined) {
  if (status === "completed") return "Completed"
  if (status === "in_progress") return "In progress"
  if (status === "cancelled") return "Cancelled"
  return "Pending"
}

function todoStatusIcon(status: string | undefined) {
  if (status === "completed") return "check"
  if (status === "in_progress") return "play"
  if (status === "cancelled") return "x"
  return
}

function languageFromPath(path: string | undefined) {
  if (!path) return "text"
  const extension = path.split(/[\\/.]/).at(-1)?.toLowerCase()
  if (!extension || extension === path.toLowerCase()) return "text"
  return LANGUAGE_BY_EXTENSION[extension] ?? extension
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  cjs: "js",
  mjs: "js",
  jsx: "jsx",
  tsx: "tsx",
  ts: "ts",
  jsonc: "jsonc",
  md: "markdown",
  markdown: "markdown",
  ps1: "powershell",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  cs: "csharp",
  cpp: "cpp",
  hpp: "cpp",
  c: "c",
  h: "c",
}

function collapseDiffOutput(output: string) {
  const lines = output.split("\n")
  if (!isDiffOutput(output) || lines.length <= 15) return { output, overflow: false }
  return { output: lines.slice(0, 10).join("\n"), overflow: true }
}

function collapseLineOutput(output: string, maxLines: number) {
  const lines = output.split("\n")
  if (lines.length <= maxLines) return { output, overflow: false }
  return { output: lines.slice(0, maxLines).join("\n"), overflow: true }
}

function patchContents(patch: string, filePath: string) {
  const before: string[] = []
  const after: string[] = []
  let inHunk = false

  for (const line of patch.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith("\\ No newline")) continue

    const first = line[0]
    const text = first === "+" || first === "-" || first === " " ? line.slice(1) : line
    if (first === "+") {
      after.push(text)
      continue
    }
    if (first === "-") {
      before.push(text)
      continue
    }
    before.push(text)
    after.push(text)
  }

  if (!inHunk) return
  return {
    before: { name: filePath, contents: before.join("\n") },
    after: { name: filePath, contents: after.join("\n") },
  }
}

function isDiffOutput(output: string) {
  const text = output.trimStart()
  return text.startsWith("diff --git ") || /^@@\s/m.test(text) || /^---\s.+\n\+\+\+\s/m.test(text)
}

function toolOutput(state: Extract<Part, { type: "tool" }>["state"]) {
  if (state.status === "completed") return state.output
}

function toolError(state: Extract<Part, { type: "tool" }>["state"]) {
  if (state.status === "error") return state.error
}

function toolMetadata(state: Extract<Part, { type: "tool" }>["state"]) {
  if ("metadata" in state && isRecordValue(state.metadata)) return state.metadata
}

function stripAnsiBasic(text: string) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
}

function permissionToolPart(request: PermissionRequest, messages: MessageBundle[]) {
  if (!request.tool) return
  return messages
    .flatMap((message) => message.parts)
    .find((part): part is Extract<Part, { type: "tool" }> => part.type === "tool" && part.callID === request.tool?.callID && part.messageID === request.tool.messageID)
}

function toolInput(request: PermissionRequest, part?: Extract<Part, { type: "tool" }>) {
  if (part && "input" in part.state && part.state.input && typeof part.state.input === "object") return part.state.input as Record<string, unknown>
  return request.metadata
}

function permissionTitle(request: PermissionRequest, input: Record<string, unknown>) {
  if (request.permission === "edit" && typeof request.metadata.filepath === "string") return `Edit ${request.metadata.filepath}`
  if (request.permission === "read" && typeof input.filePath === "string") return `Read ${input.filePath}`
  if (request.permission === "glob" && typeof input.pattern === "string") return `Glob ${input.pattern}`
  if (request.permission === "grep" && typeof input.pattern === "string") return `Grep ${input.pattern}`
  if (request.permission === "list" && typeof input.path === "string") return `List ${input.path}`
  if (request.permission === "bash" && typeof input.command === "string") return input.command
  if (request.permission === "task" && typeof input.description === "string") return `Task: ${input.description}`
  if (request.permission === "webfetch" && typeof input.url === "string") return `WebFetch ${input.url}`
  if (request.permission === "websearch" && typeof input.query === "string") return `WebSearch ${input.query}`
  if (request.permission === "external_directory") return "Access external directory"
  if (request.permission === "doom_loop") return "Continue after repeated failures"
  return request.permission
}

function permissionDiff(request: PermissionRequest) {
  if (typeof request.metadata.diff === "string") return request.metadata.diff
}

function collapseOutput(output: string, maxLines = 120, maxChars = 12_000) {
  const lines = output.split("\n")
  if (lines.length <= maxLines && Array.from(output).length <= maxChars) return { output, overflow: false }
  const preview = lines.slice(0, maxLines).join("\n")
  if (Array.from(preview).length > maxChars) return { output: `${Array.from(preview).slice(0, Math.max(0, maxChars - 3)).join("")}...`, overflow: true }
  return { output: [...lines.slice(0, maxLines), "..."].join("\n"), overflow: true }
}

function modelValue(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`
}

function parseModelValue(value: string) {
  const index = value.indexOf("/")
  if (index === -1) return
  return { providerID: value.slice(0, index), modelID: value.slice(index + 1) }
}

function pendingSession(directory: string): Session {
  const now = Date.now()
  return {
    id: PENDING_SESSION_ID,
    slug: PENDING_SESSION_ID,
    projectID: "",
    directory,
    title: "New session",
    version: "pending",
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: now, updated: now },
  }
}

function viewItemSession(item: ViewItem, fallbackDirectory?: string): Session {
  if (item.kind === "session") return item.session
  return pendingSession(item.slot.directory ?? fallbackDirectory ?? "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function pendingViewSessions(view?: Pick<OpencodeXView, "metadata">): PendingViewSession[] {
  const opencodex = view?.metadata?.opencodex
  if (!isRecord(opencodex) || !Array.isArray(opencodex.pendingSessions)) return []
  return opencodex.pendingSessions.flatMap((item): PendingViewSession[] => {
    if (!isRecord(item) || typeof item.id !== "string") return []
    return [{
      id: item.id,
      projectID: typeof item.projectID === "string" ? item.projectID : undefined,
      projectLabel: typeof item.projectLabel === "string" ? item.projectLabel : undefined,
      directory: typeof item.directory === "string" ? item.directory : undefined,
    }]
  })
}

function metadataWithPendingSessions(metadata: Record<string, unknown> | undefined, pending: PendingViewSession[]) {
  const next = { ...(metadata ?? {}) }
  const opencodex = isRecord(next.opencodex) ? { ...next.opencodex } : {}
  if (pending.length > 0) {
    opencodex.pendingSessions = pending
    next.opencodex = opencodex
    return next
  }
  delete opencodex.pendingSessions
  if (Object.keys(opencodex).length > 0) next.opencodex = opencodex
  else delete next.opencodex
  return next
}

function viewItemID(item: ViewItem) {
  return item.kind === "session" ? item.session.id : item.slot.id
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

function projectSwarms(project: GuiSnapshot["projects"][number], snapshot?: GuiSnapshot) {
  return (snapshot?.swarms ?? []).filter((swarm) => swarm.projectID === project.id)
}

function sessionProjectName(session: Session, snapshot?: GuiSnapshot) {
  const project = (snapshot?.projects ?? []).find((item) => item.sessions.some((projectSession) => projectSession.id === session.id))
  if (!project) return
  return title(project.name ?? project.project.name)
}

function dashboardSessionMeta(session: Session, snapshot?: GuiSnapshot) {
  const project = sessionProjectName(session, snapshot)
  return [formatRelative(session.time.updated), project].filter(Boolean).join(" - ")
}

function viewSessionCount(view: OpencodeXView) {
  return view.sessionIDs.length + pendingViewSessions(view).length
}

function viewDashboardStatus(view: GuiSnapshot["views"][number], snapshot?: GuiSnapshot): DerivedSessionStatus {
  return deriveViewStatus(view, snapshot)
}

function isRecentSessionUpdate(timeUpdated: number, now = Date.now()) {
  return timeUpdated >= now - RECENT_SESSION_WINDOW_MS
}

function recentProjectSessions(sessions: Session[]) {
  const sorted = sessions.filter(isTUISidebarSession).toSorted((a, b) => b.time.updated - a.time.updated)
  const recent = sorted.filter((session) => isRecentSessionUpdate(session.time.updated))
  return recent.length >= PROJECT_RECENT_SESSION_LIMIT ? recent : sorted.slice(0, PROJECT_RECENT_SESSION_LIMIT)
}

function sidebarStatus(snapshot: GuiSnapshot | undefined, session: Session): DerivedSessionStatus {
  return deriveSessionStatus(snapshot, session)
}

function isLikelyActiveSession(session: Session, data: SessionData) {
  const lastAssistant = data.messages.toReversed().find((bundle): bundle is MessageBundle & { info: AssistantMessage } => isAssistantMessage(bundle.info))
  const lastActivity = Math.max(session.time.updated, lastAssistant?.info.time.created ?? 0)
  if (lastActivity < Date.now() - SIDEBAR_ACTIVE_WINDOW_MS) return false
  if (!lastAssistant || lastAssistant.info.time.completed || "finish" in lastAssistant.info && lastAssistant.info.finish) return false
  if (lastAssistant.parts.some((part) => part.type === "tool" && part.state.status === "running")) return true
  if (lastAssistant.parts.some((part) => part.type === "step-start") && !lastAssistant.parts.some((part) => part.type === "step-finish")) return true
  return lastAssistant.parts.length > 0
}

const sidebarStatusLabel = sessionStatusLabel

function statusClass(status: DerivedSessionStatus) {
  return `status-${status.replaceAll("_", "-")}`
}

function mergeSnapshot(snapshot: GuiSnapshot, next: GuiSnapshot): GuiSnapshot {
  const cardSnapshot = mergeSessionCardSnapshot(snapshot, next)
  const merged = {
    ...snapshot,
    ...cardSnapshot,
    providers: stableValue(snapshot.providers, next.providers),
    agents: stableValue(snapshot.agents, next.agents),
    swarms: stableValue(snapshot.swarms, next.swarms),
    jobs: stableValue(snapshot.jobs, next.jobs),
  }
  return snapshot === merged
    || (
      snapshot.projects === merged.projects
      && snapshot.sessions === merged.sessions
      && snapshot.views === merged.views
      && snapshot.sessionStatus === merged.sessionStatus
      && snapshot.sessionUiState === merged.sessionUiState
      && snapshot.permissions === merged.permissions
      && snapshot.questions === merged.questions
      && snapshot.providers === merged.providers
      && snapshot.agents === merged.agents
      && snapshot.swarms === merged.swarms
      && snapshot.jobs === merged.jobs
      && snapshot.sessionSyncRevision === merged.sessionSyncRevision
    )
    ? snapshot
    : merged
}

function mergeSessionCardSnapshot(snapshot: GuiSnapshot, next: SessionCardSnapshot): GuiSnapshot {
  const merged = {
    ...snapshot,
    projects: stableValue(snapshot.projects, next.projects),
    sessions: stableValue(snapshot.sessions, next.sessions),
    views: stableValue(snapshot.views, next.views),
    sessionStatus: stableValue(snapshot.sessionStatus, next.sessionStatus),
    sessionUiState: stableValue(snapshot.sessionUiState, next.sessionUiState),
    permissions: stableValue(snapshot.permissions, next.permissions),
    questions: stableValue(snapshot.questions, next.questions),
    sessionSyncRevision: next.sessionSyncRevision,
  }
  return snapshot.projects === merged.projects
    && snapshot.sessions === merged.sessions
    && snapshot.views === merged.views
    && snapshot.sessionStatus === merged.sessionStatus
    && snapshot.sessionUiState === merged.sessionUiState
    && snapshot.permissions === merged.permissions
    && snapshot.questions === merged.questions
    && snapshot.sessionSyncRevision === merged.sessionSyncRevision
    ? snapshot
    : merged
}

function stableValue<T>(current: T, next: T): T {
  return JSON.stringify(current) === JSON.stringify(next) ? current : next
}

function SidebarSessionLink(props: { session: Session; snapshot: () => GuiSnapshot | undefined; active: boolean; nested?: boolean; onClick: () => void }) {
  const status = createMemo(() => sidebarStatus(props.snapshot(), props.session))
  const subtitle = createMemo(() => [props.session.model?.id?.slice((props.session.model?.id ?? "").lastIndexOf("/") + 1), formatRelative(props.session.time.updated)].filter(Boolean).join(" - "))
  return (
    <button
      title={`${title(props.session.title)} - ${sidebarStatusLabel(status())} - ${formatRelative(props.session.time.updated)}`}
      class={`session-link ${statusClass(status())}`}
      classList={{ active: props.active, nested: props.nested }}
      onClick={props.onClick}
    >
      <span>{title(props.session.title)}</span>
      <small>
        <span>{subtitle()}</span>
      </small>
      <Show when={status() === "in_progress"}><span class="mini-spinner" aria-label="running" /></Show>
      <Show when={status() === "input_needed" || status() === "ready_for_review"}><span class="status-glyph" aria-label={sidebarStatusLabel(status())} /></Show>
    </button>
  )
}

function SidebarViewLink(props: { view: OpencodeXView; snapshot: () => GuiSnapshot | undefined; active: boolean; onClick: () => void }) {
  const status = createMemo(() => viewDashboardStatus(props.view, props.snapshot()))
  return (
    <button
      title={`${title(props.view.title)} - ${sidebarStatusLabel(status())} - ${viewSessionCount(props.view)} sessions`}
      class={`session-link ${statusClass(status())}`}
      classList={{ active: props.active }}
      onClick={props.onClick}
    >
      <span>{title(props.view.title)}</span>
      <small>
        <span>{viewSessionCount(props.view)} sessions</span>
      </small>
      <Show when={status() === "in_progress"}><span class="mini-spinner" aria-label="running" /></Show>
      <Show when={status() === "input_needed" || status() === "ready_for_review"}><span class="status-glyph" aria-label={sidebarStatusLabel(status())} /></Show>
    </button>
  )
}

function moveByOffset(ids: string[], sourceID: string, offset: number) {
  const sourceIndex = ids.indexOf(sourceID)
  const targetIndex = sourceIndex + offset
  if (sourceIndex === -1 || targetIndex < 0 || targetIndex >= ids.length) return []
  return ids.map((id, index) => (index === sourceIndex ? ids[targetIndex] : index === targetIndex ? sourceID : id))
}

function moveRelative(ids: string[], sourceID: string, targetID: string, placement: "before" | "after") {
  const sourceIndex = ids.indexOf(sourceID)
  const targetIndex = ids.indexOf(targetID)
  if (sourceIndex === -1 || targetIndex === -1) return []
  const withoutSource = ids.filter((id) => id !== sourceID)
  const insertionIndex = withoutSource.indexOf(targetID) + (placement === "after" ? 1 : 0)
  return [...withoutSource.slice(0, insertionIndex), sourceID, ...withoutSource.slice(insertionIndex)]
}

function dropPlacement(event: DragEvent): "before" | "after" {
  event.preventDefault()
  const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : undefined
  if (!rect) return "before"
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before"
}

function StatusDot(props: { status: string }) {
  return <span class={`status-dot ${props.status.replaceAll("_", "-")}`} aria-label={props.status} />
}

const pendingLiveParts = new Map<string, Part[]>()
const pendingLivePartDeltas = new Map<string, Map<string, string>>()

type SessionDataPatchOptions = {
  appendMissingMessages?: boolean
}

function isSessionDataEvent(event: GlobalEvent) {
  const kind = eventKind(event)
  return kind === "message.updated"
    || kind === "message.removed"
    || kind === "message.part.updated"
    || kind === "message.part.removed"
    || kind === "message.part.delta"
    || kind === "todo.updated"
    || kind === "session.diff"
}

function isSnapshotPatchEvent(event: GlobalEvent) {
  const kind = eventKind(event)
  return kind === "session.updated"
    || kind === "session.deleted"
    || kind === "permission.asked"
    || kind === "permission.replied"
    || kind === "question.asked"
    || kind === "question.replied"
    || kind === "question.rejected"
}

function isHighFrequencySessionEvent(event: GlobalEvent) {
  return eventKind(event).startsWith("session.next.")
}

function patchBoundedSessionData(data: SessionData, event: GlobalEvent, limit: MessageWindow, followingBottom: boolean): SessionData {
  if (!followingBottom || data.messageTailDetached) {
    const next = patchSessionData(data, event, { appendMissingMessages: false })
    return eventWouldAppendMissingMessage(data, event) ? markMessageTailDetached(next) : next
  }
  return trimToLiveTail(patchSessionData(data, event), limit)
}

function patchSessionData(data: SessionData, event: GlobalEvent, options: SessionDataPatchOptions = {}): SessionData {
  const properties = eventData(event)
  if (!properties) return data
  switch (eventKind(event)) {
    case "message.updated":
      return { ...data, messages: upsertMessage(data.messages, (properties as { info: Message }).info, options) }
    case "message.removed": {
      forgetPendingMessageParts((properties as { messageID: string }).messageID)
      return { ...data, messages: data.messages.filter((bundle) => bundle.info.id !== (properties as { messageID: string }).messageID) }
    }
    case "message.part.updated":
      return { ...data, messages: upsertPart(data.messages, normalizeLivePart((properties as { part: Part }).part), options) }
    case "message.part.removed": {
      const removed = properties as { messageID: string; partID: string }
      forgetPendingPart(removed.messageID, removed.partID)
      return { ...data, messages: removePart(data.messages, (properties as { messageID: string; partID: string }).messageID, (properties as { messageID: string; partID: string }).partID) }
    }
    case "message.part.delta":
      return { ...data, messages: applyPartDelta(data.messages, (properties as { messageID: string; partID: string; field: string; delta: string }).messageID, (properties as { messageID: string; partID: string; field: string; delta: string }).partID, (properties as { messageID: string; partID: string; field: string; delta: string }).field, (properties as { messageID: string; partID: string; field: string; delta: string }).delta, options) }
    case "todo.updated":
      return { ...data, todos: (properties as { todos: Todo[] }).todos }
    case "session.diff":
      return { ...data, diffs: (properties as { diff: SnapshotFileDiff[] }).diff }
    default:
      return data
  }
}

function upsertMessage(messages: MessageBundle[], info: Message, options: SessionDataPatchOptions = {}) {
  const index = messages.findIndex((bundle) => bundle.info.id === info.id)
  if (index < 0 && options.appendMissingMessages === false) {
    forgetPendingMessageParts(info.id)
    return messages
  }
  const pendingParts = takePendingParts(info.id)
  const next = index >= 0
    ? messages.map((bundle, i) => i === index ? { ...bundle, info, parts: mergePartLists(bundle.parts, pendingParts) } : bundle)
    : [...messages, { info, parts: pendingParts }]
  return sortMessageBundles(next)
}

function upsertPart(messages: MessageBundle[], part: Part, options: SessionDataPatchOptions = {}) {
  const nextPart = applyPendingDeltasToPart(part)
  let found = false
  const next = messages.map((bundle) => {
    if (bundle.info.id !== nextPart.messageID) return bundle
    found = true
    forgetPendingPart(nextPart.messageID, nextPart.id)
    const parts = upsertPartList(bundle.parts, nextPart)
    return { ...bundle, parts }
  })
  if (found) return next
  if (options.appendMissingMessages === false) return messages
  rememberPendingPart(nextPart)
  return messages
}

function removePart(messages: MessageBundle[], messageID: string, partID: string) {
  return messages.map((bundle) => bundle.info.id === messageID
    ? { ...bundle, parts: bundle.parts.filter((part) => part.id !== partID) }
    : bundle)
}

function applyPartDelta(messages: MessageBundle[], messageID: string, partID: string, field: string, delta: string, options: SessionDataPatchOptions = {}) {
  if (field !== "text") {
    if (options.appendMissingMessages !== false) rememberPendingPartDelta(messageID, partID, field, delta)
    return messages
  }
  let found = false
  const next = messages.map((bundle) => {
    if (bundle.info.id !== messageID) return bundle
    return {
      ...bundle,
      parts: bundle.parts.map((part) => {
        if (part.id !== partID || (part.type !== "text" && part.type !== "reasoning")) return part
        found = true
        return { ...part, text: part.text + delta } as Part
      }),
    }
  })
  if (!found && options.appendMissingMessages !== false) rememberPendingPartDelta(messageID, partID, field, delta)
  return next
}

function normalizeLivePart(part: Part): Part {
  if (part.type !== "text" && part.type !== "reasoning") return part
  return { ...part, text: displayMessageText(part.text) } as Part
}

function mergePartLists(parts: Part[], incoming: Part[]) {
  if (incoming.length === 0) return parts
  let next = parts
  for (const part of incoming) next = upsertPartList(next, part)
  return next
}

function upsertPartList(parts: Part[], part: Part) {
  const index = parts.findIndex((item) => item.id === part.id)
  const next = index >= 0
    ? parts.map((item, i) => i === index ? part : item)
    : [...parts, part]
  return sortParts(next)
}

function sortParts(parts: Part[]) {
  return parts.toSorted((a, b) => a.id.localeCompare(b.id))
}

function rememberPendingPart(part: Part) {
  pendingLiveParts.set(part.messageID, upsertPartList(pendingLiveParts.get(part.messageID) ?? [], part))
}

function takePendingParts(messageID: string) {
  const parts = pendingLiveParts.get(messageID) ?? []
  pendingLiveParts.delete(messageID)
  return parts
}

function forgetPendingMessageParts(messageID: string) {
  pendingLiveParts.delete(messageID)
  pendingLivePartDeltas.delete(messageID)
}

function forgetPendingPart(messageID: string, partID: string) {
  const parts = pendingLiveParts.get(messageID)
  if (parts) {
    const next = parts.filter((part) => part.id !== partID)
    if (next.length > 0) pendingLiveParts.set(messageID, next)
    else pendingLiveParts.delete(messageID)
  }
  const deltas = pendingLivePartDeltas.get(messageID)
  if (!deltas) return
  for (const key of deltas.keys()) {
    if (key.startsWith(`${partID}\0`)) deltas.delete(key)
  }
  if (deltas.size === 0) pendingLivePartDeltas.delete(messageID)
}

function rememberPendingPartDelta(messageID: string, partID: string, field: string, delta: string) {
  const pending = pendingLiveParts.get(messageID)
  if (pending?.some((part) => part.id === partID)) {
    pendingLiveParts.set(messageID, pending.map((part) => part.id === partID ? applyDeltaToPart(part, field, delta) : part))
    return
  }
  const deltas = pendingLivePartDeltas.get(messageID) ?? new Map<string, string>()
  const key = pendingDeltaKey(partID, field)
  deltas.set(key, (deltas.get(key) ?? "") + delta)
  pendingLivePartDeltas.set(messageID, deltas)
}

function applyPendingDeltasToPart(part: Part): Part {
  const deltas = pendingLivePartDeltas.get(part.messageID)
  if (!deltas) return part
  let next = part
  for (const [key, delta] of deltas) {
    const [partID, field] = key.split("\0")
    if (partID !== part.id || !field) continue
    next = applyDeltaToPart(next, field, delta)
    deltas.delete(key)
  }
  if (deltas.size === 0) pendingLivePartDeltas.delete(part.messageID)
  return next
}

function applyDeltaToPart(part: Part, field: string, delta: string): Part {
  if (field !== "text" || (part.type !== "text" && part.type !== "reasoning")) return part
  return { ...part, text: part.text + delta } as Part
}

function pendingDeltaKey(partID: string, field: string) {
  return `${partID}\0${field}`
}

function sortMessageBundles(messages: MessageBundle[]) {
  return messages.toSorted((a, b) => (a.info.time.created ?? 0) - (b.info.time.created ?? 0))
}

function eventWouldAppendMissingMessage(data: SessionData, event: GlobalEvent) {
  const properties = eventData(event)
  if (!properties) return false
  const kind = eventKind(event)
  if (kind === "message.updated") return !data.messages.some((bundle) => bundle.info.id === (properties as { info: Message }).info.id)
  if (kind === "message.part.updated") return !data.messages.some((bundle) => bundle.info.id === (properties as { part: Part }).part.messageID)
  if (kind === "message.part.delta") return !data.messages.some((bundle) => bundle.info.id === (properties as { messageID: string }).messageID)
  return false
}

function patchSnapshot(snapshot: GuiSnapshot, event: GlobalEvent): GuiSnapshot {
  const properties = eventData(event)
  if (!properties) return snapshot
  switch (eventKind(event)) {
    case "session.updated":
      return patchSnapshotSession(snapshot, (properties as { info: Session }).info)
    case "session.deleted": {
      const deletedSessionID = (properties as { sessionID: string }).sessionID
      return {
        ...snapshot,
        sessions: snapshot.sessions.filter((session) => session.id !== deletedSessionID),
        projects: snapshot.projects.map((project) => ({
          ...project,
          sessions: project.sessions.filter((session) => session.id !== deletedSessionID),
        })),
        sessionStatus: Object.fromEntries(Object.entries(snapshot.sessionStatus).filter(([id]) => id !== deletedSessionID)),
        sessionUiState: Object.fromEntries(Object.entries(snapshot.sessionUiState).filter(([id]) => id !== deletedSessionID)),
        permissions: snapshot.permissions.filter((request) => request.sessionID !== deletedSessionID),
        questions: snapshot.questions.filter((request) => request.sessionID !== deletedSessionID),
      }
    }
    case "permission.asked": {
      const requestProperties = properties as PermissionRequest
      const request: PermissionRequest = {
        id: requestProperties.id,
        sessionID: requestProperties.sessionID,
        permission: requestProperties.permission,
        patterns: requestProperties.patterns,
        metadata: requestProperties.metadata,
        always: requestProperties.always,
        tool: requestProperties.tool,
      }
      return reconcileSessionUiState({ ...snapshot, permissions: upsertByID(snapshot.permissions, request) }, request.sessionID)
    }
    case "permission.replied": {
      const reply = properties as { requestID: string; sessionID?: string }
      const sessionID = reply.sessionID ?? snapshot.permissions.find((request) => request.id === reply.requestID)?.sessionID
      const next = { ...snapshot, permissions: snapshot.permissions.filter((request) => request.id !== reply.requestID) }
      return sessionID ? reconcileSessionUiState(next, sessionID) : next
    }
    case "question.asked": {
      const requestProperties = properties as QuestionRequest
      const request: QuestionRequest = {
        id: requestProperties.id,
        sessionID: requestProperties.sessionID,
        questions: requestProperties.questions,
        tool: requestProperties.tool,
      }
      return reconcileSessionUiState({ ...snapshot, questions: upsertByID(snapshot.questions, request) }, request.sessionID)
    }
    case "question.replied":
    case "question.rejected": {
      const reply = properties as { requestID: string; sessionID?: string }
      const sessionID = reply.sessionID ?? snapshot.questions.find((request) => request.id === reply.requestID)?.sessionID
      const next = { ...snapshot, questions: snapshot.questions.filter((request) => request.id !== reply.requestID) }
      return sessionID ? reconcileSessionUiState(next, sessionID) : next
    }
    default:
      return snapshot
  }
}

function patchSnapshotSession(snapshot: GuiSnapshot, info: Session): GuiSnapshot {
  return reconcileSessionUiState({
    ...snapshot,
    sessions: upsertSession(snapshot.sessions, info),
    projects: snapshot.projects.map((project) => project.sessions.some((session) => session.id === info.id)
      ? { ...project, sessions: upsertSession(project.sessions, info) }
      : project),
    views: snapshot.views.map((view) => view.sessions.some((session) => session.id === info.id)
      ? { ...view, sessions: upsertSession(view.sessions, info) }
      : view),
  }, info.id)
}

function upsertSession<T extends Session>(sessions: T[], session: Session): T[] {
  if (!isRenderableSession(session)) return sessions.filter((item) => item.id !== session.id)
  const index = sessions.findIndex((item) => item.id === session.id)
  const next = index >= 0 ? sessions.map((item, i) => i === index ? { ...item, ...session } : item) : [...sessions, session as T]
  return next.toSorted((a, b) => b.time.updated - a.time.updated)
}

function upsertByID<T extends { id: string }>(items: T[], item: T) {
  return items.some((current) => current.id === item.id)
    ? items.map((current) => current.id === item.id ? item : current)
    : [...items, item]
}

function eventKind(event: GlobalEvent) {
  const payload = event.payload as { type: string; name?: string }
  return payload.type === "sync" && payload.name ? payload.name.replace(/\.\d+$/, "") : payload.type
}

function eventData(event: GlobalEvent) {
  const payload = event.payload as { properties?: Record<string, unknown>; data?: Record<string, unknown> }
  return payload.properties ?? payload.data
}

function globalEventID(event: GlobalEvent) {
  const id = (event.payload as { id?: string }).id
  return typeof id === "string" ? id : undefined
}

function eventAggregateID(event: GlobalEvent) {
  const id = (event.payload as { aggregateID?: string }).aggregateID
  return typeof id === "string" ? id : undefined
}

function eventSessionID(event: GlobalEvent) {
  return sessionIDFrom(eventData(event))
}

function eventMessageID(event: GlobalEvent) {
  return messageIDFrom(eventData(event))
}

function sessionIDFrom(value: unknown) {
  if (!isRecordValue(value)) return
  if (typeof value.sessionID === "string") return value.sessionID
  if (isRecordValue(value.info) && typeof value.info.sessionID === "string") return value.info.sessionID
  if (isRecordValue(value.part) && typeof value.part.sessionID === "string") return value.part.sessionID
}

function messageIDFrom(value: unknown) {
  if (!isRecordValue(value)) return
  if (typeof value.messageID === "string") return value.messageID
  if (isRecordValue(value.info) && typeof value.info.id === "string") return value.info.id
  if (isRecordValue(value.part) && typeof value.part.messageID === "string") return value.part.messageID
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

function firstAvailableModel(providers: Provider[]) {
  const provider = providers
    .toSorted((a, b) => Number(a.id !== "opencode") - Number(b.id !== "opencode") || a.name.localeCompare(b.name))
    .find((item) => Object.values(item.models).some((model) => model.status !== "deprecated"))
  const model = provider ? Object.values(provider.models).filter((item) => item.status !== "deprecated").toSorted((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))[0] : undefined
  if (!provider || !model) return undefined
  return modelValue(provider.id, model.id)
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

function SessionCollectionPage(props: { snapshot?: GuiSnapshot; setRoute: (route: Route) => void }) {
  const sessions = createMemo(() => tuiSidebarSessions(props.snapshot))
  return (
    <div class="page placeholder-page list-page">
      <p class="eyebrow">Sessions</p>
      <h1>Session workspace</h1>
      <p>Open, monitor, and resume existing TUI-compatible sessions from the shared backend data model.</p>
      <For each={sessions()} fallback={<Empty text="No sessions" />}>
        {(session) => (
          <button class="card-row interactive" onClick={() => props.setRoute({ name: "session", sessionID: session.id })}>
            <div>
              <strong>{title(session.title)}</strong>
              <span>{compactPath(session.directory)}</span>
            </div>
            <StatusPill status={props.snapshot?.sessionStatus[session.id]?.type ?? "idle"} />
          </button>
        )}
      </For>
    </div>
  )
}

function ProjectCollectionPage(props: { snapshot?: GuiSnapshot; createSession: (projectID?: string, directory?: string) => void }) {
  return (
    <div class="page placeholder-page list-page">
      <p class="eyebrow">Projects</p>
      <h1>Project groups</h1>
      <p>Project groups, folders, and nested sessions are loaded from the same OpencodeX backend used by the TUI.</p>
      <For each={props.snapshot?.projects ?? []} fallback={<Empty text="No projects" />}>
        {(project) => (
          <article class="card-row">
            <div>
              <strong>{title(project.name ?? project.project.name)}</strong>
              <span>{project.folders.map((folder) => compactPath(folder.path)).join(", ")}</span>
            </div>
            <div class="row-actions">
              <small>{projectSessions(project, props.snapshot).length} sessions</small>
              <button onClick={() => props.createSession(project.id, project.folders[0]?.path)}>Session</button>
            </div>
          </article>
        )}
      </For>
    </div>
  )
}

function ViewsPage(props: {
  snapshot?: GuiSnapshot
  view?: OpencodeXView
  items: ViewItem[]
  focusedSessionID: () => string
  composerFocusRequest: () => { sessionID: string; token: number }
  data: Record<string, SessionData>
  loading: Record<string, boolean>
  providers: Provider[]
  agents: Agent[]
  recentModels: string[]
  selectedAgent: (session: Session) => string
  setSelectedAgent: (sessionID: string, value: string) => void
  selectedModel: (session: Session) => string
  setSelectedModel: (sessionID: string, value: string) => void
  selectedVariant: (session: Session) => string
  setSelectedVariant: (sessionID: string, value: string) => void
  permissions: (sessionID: string) => PermissionRequest[]
  questions: (sessionID: string) => QuestionRequest[]
  focus: (sessionID: string, focusComposer: boolean) => void
  submit: (event: SubmitEvent, item: ViewItem, text: string) => void
  replyPermission: (request: PermissionRequest, reply: "once" | "always" | "reject") => void
  replyQuestion: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  rejectQuestion: (request: QuestionRequest) => void
  abortSession: (sessionID: string) => void
  renameSession: (session: Session) => void
  moveSession: (session: Session) => void
  deleteSession: (session: Session) => void
  loadOlderMessages: (sessionID: string, cursor: string) => Promise<void>
  reloadLatestMessages: (sessionID: string) => Promise<void>
  onFollowBottomChange: (sessionID: string, value: boolean) => void
}) {
  const layout = createMemo(() => viewLayout(props.items.length))
  return (
    <div class="page views-page">
      <Show when={props.view} fallback={<Empty text="Create a view to work across multiple sessions." />}>
        <Show when={props.items.length > 0} fallback={<Empty text="This view has no available sessions." />}>
          {renderViewLayout({
            node: layout(),
            items: props.items,
            focusedSessionID: props.focusedSessionID,
            composerFocusRequest: props.composerFocusRequest,
            data: props.data,
            loading: props.loading,
            providers: props.providers,
            agents: props.agents,
            recentModels: props.recentModels,
            selectedAgent: props.selectedAgent,
            setSelectedAgent: props.setSelectedAgent,
            selectedModel: props.selectedModel,
            setSelectedModel: props.setSelectedModel,
            selectedVariant: props.selectedVariant,
            setSelectedVariant: props.setSelectedVariant,
            permissions: props.permissions,
            questions: props.questions,
            focus: props.focus,
            submit: props.submit,
            replyPermission: props.replyPermission,
            replyQuestion: props.replyQuestion,
            rejectQuestion: props.rejectQuestion,
            abortSession: props.abortSession,
            renameSession: props.renameSession,
            moveSession: props.moveSession,
            deleteSession: props.deleteSession,
            loadOlderMessages: props.loadOlderMessages,
            reloadLatestMessages: props.reloadLatestMessages,
            onFollowBottomChange: props.onFollowBottomChange,
            snapshot: props.snapshot,
          })}
        </Show>
      </Show>
    </div>
  )
}

function viewLayout(count: number): LayoutNode {
  if (count <= 1) return 0
  if (count === 2) return { direction: "row", children: [0, 1] }
  if (count === 3) return { direction: "row", children: [0, { direction: "column", children: [1, 2] }] }
  if (count === 4) return { direction: "column", children: [{ direction: "row", children: [0, 1] }, { direction: "row", children: [2, 3] }] }
  if (count === 5) return { direction: "row", children: [{ direction: "column", children: [0, 1, 2] }, { direction: "column", children: [3, 4] }] }
  if (count === 6) return { direction: "column", children: [{ direction: "row", children: [0, 1, 2] }, { direction: "row", children: [3, 4, 5] }] }
  if (count === 7) return { direction: "row", children: [{ direction: "column", children: [0, 1, 2, 3] }, { direction: "column", children: [4, 5, 6] }] }
  return { direction: "column", children: [{ direction: "row", children: [0, 1, 2, 3] }, { direction: "row", children: [4, 5, 6, 7] }] }
}

function renderViewLayout(input: {
  node: LayoutNode
  items: ViewItem[]
  focusedSessionID: () => string
  composerFocusRequest: () => { sessionID: string; token: number }
  data: Record<string, SessionData>
  loading: Record<string, boolean>
  providers: Provider[]
  agents: Agent[]
  recentModels: string[]
  selectedAgent: (session: Session) => string
  setSelectedAgent: (sessionID: string, value: string) => void
  selectedModel: (session: Session) => string
  setSelectedModel: (sessionID: string, value: string) => void
  selectedVariant: (session: Session) => string
  setSelectedVariant: (sessionID: string, value: string) => void
  permissions: (sessionID: string) => PermissionRequest[]
  questions: (sessionID: string) => QuestionRequest[]
  focus: (sessionID: string, focusComposer: boolean) => void
  submit: (event: SubmitEvent, item: ViewItem, text: string) => void
  replyPermission: (request: PermissionRequest, reply: "once" | "always" | "reject") => void
  replyQuestion: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  rejectQuestion: (request: QuestionRequest) => void
  abortSession: (sessionID: string) => void
  renameSession: (session: Session) => void
  moveSession: (session: Session) => void
  deleteSession: (session: Session) => void
  loadOlderMessages: (sessionID: string, cursor: string) => Promise<void>
  reloadLatestMessages: (sessionID: string) => Promise<void>
  onFollowBottomChange: (sessionID: string, value: boolean) => void
  snapshot?: GuiSnapshot
}): JSX.Element {
  if (typeof input.node === "number") {
    const item = input.items[input.node]
    if (!item) return <></>
    const session = viewItemSession(item)
    const id = viewItemID(item)
    return (
      <ViewPane
        session={session}
        pending={item.kind === "pending"}
        focused={() => input.focusedSessionID() === id}
        composerFocusToken={() => {
          const request = input.composerFocusRequest()
          return request.sessionID === id ? request.token : 0
        }}
        data={item.kind === "session" ? input.data[id] ?? EMPTY_SESSION_DATA : EMPTY_SESSION_DATA}
        loading={input.loading[id] === true}
        status={item.kind === "session" ? input.snapshot?.sessionStatus[id]?.type ?? "idle" : "idle"}
        providers={input.providers}
        agents={input.agents}
        recentModels={input.recentModels}
        selectedAgent={input.selectedAgent(session)}
        setSelectedAgent={(value) => input.setSelectedAgent(id, value)}
        selectedModel={input.selectedModel(session)}
        setSelectedModel={(value) => input.setSelectedModel(id, value)}
        selectedVariant={input.selectedVariant(session)}
        setSelectedVariant={(value) => input.setSelectedVariant(id, value)}
        permissions={item.kind === "session" ? input.permissions(id) : []}
        questions={item.kind === "session" ? input.questions(id) : []}
        focus={(focusComposer) => input.focus(id, focusComposer)}
        submit={(event, text) => input.submit(event, item, text)}
        replyPermission={input.replyPermission}
        replyQuestion={input.replyQuestion}
        rejectQuestion={input.rejectQuestion}
        abortSession={input.abortSession}
        renameSession={input.renameSession}
        moveSession={input.moveSession}
        deleteSession={input.deleteSession}
        loadOlderMessages={(cursor) => input.loadOlderMessages(id, cursor)}
        reloadLatestMessages={() => input.reloadLatestMessages(id)}
        onFollowBottomChange={input.onFollowBottomChange}
      />
    )
  }
  return (
    <div class={`view-layout-group ${input.node.direction}`}>
      <For each={input.node.children}>{(node) => renderViewLayout({ ...input, node })}</For>
    </div>
  )
}

function ViewPane(props: {
  session: Session
  pending?: boolean
  focused: () => boolean
  composerFocusToken: () => number
  data: SessionData
  loading: boolean
  status: string
  providers: Provider[]
  agents: Agent[]
  recentModels: string[]
  selectedAgent: string
  setSelectedAgent: (value: string) => void
  selectedModel: string
  setSelectedModel: (value: string) => void
  selectedVariant: string
  setSelectedVariant: (value: string) => void
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  focus: (focusComposer: boolean) => void
  submit: (event: SubmitEvent, text: string) => void
  replyPermission: (request: PermissionRequest, reply: "once" | "always" | "reject") => void
  replyQuestion: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  rejectQuestion: (request: QuestionRequest) => void
  abortSession: (sessionID: string) => void
  renameSession: (session: Session) => void
  moveSession: (session: Session) => void
  deleteSession: (session: Session) => void
  loadOlderMessages: (cursor: string) => Promise<void>
  reloadLatestMessages: () => Promise<void>
  onFollowBottomChange: (sessionID: string, value: boolean) => void
}) {
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || props.focused()) return
    props.focus(shouldAutoFocusViewComposer(event))
  }
  return (
    <article class="view-pane" classList={{ focused: props.focused() }} onPointerDown={handlePointerDown}>
      <SessionPage
        session={props.session}
        data={props.data}
        loading={props.loading}
        prompt=""
        setPrompt={() => undefined}
        providers={props.providers}
        agents={props.agents}
        selectedAgent={props.selectedAgent}
        setSelectedAgent={props.setSelectedAgent}
        selectedModel={props.selectedModel}
        recentModels={props.recentModels}
        setSelectedModel={props.setSelectedModel}
        selectedVariant={props.selectedVariant}
        setSelectedVariant={props.setSelectedVariant}
        submit={props.submit}
        permissions={props.permissions}
        questions={props.questions}
        replyPermission={props.replyPermission}
        replyQuestion={props.replyQuestion}
        rejectQuestion={props.rejectQuestion}
        abortSession={props.abortSession}
        renameSession={props.renameSession}
        moveSession={props.moveSession}
        deleteSession={props.deleteSession}
        status={props.status}
        pending={props.pending}
        composerFocusToken={props.composerFocusToken}
        messageWindow={VIEW_MESSAGE_WINDOW}
        loadOlderMessages={props.loadOlderMessages}
        reloadLatestMessages={props.reloadLatestMessages}
        onFollowBottomChange={props.onFollowBottomChange}
      />
    </article>
  )
}

function shouldAutoFocusViewComposer(event: PointerEvent) {
  const target = event.target
  if (!(target instanceof Element)) return true
  return !target.closest("button, input, textarea, select, a, summary, [contenteditable='true'], [role='button'], [role='option']")
}

function StatusPage(props: { snapshot?: GuiSnapshot }) {
  const activeProviders = createMemo(() => props.snapshot?.providers.filter((provider) => Object.values(provider.models).some((model) => model.status !== "deprecated")).length ?? 0)
  return (
    <div class="page placeholder-page list-page">
      <p class="eyebrow">Status</p>
      <h1>Runtime status</h1>
      <p>Provider, model, agent, session, and safety status surfaces are loaded through existing OpencodeX endpoints.</p>
      <section class="metric-grid">
        <Metric label="Providers" value={activeProviders()} />
        <Metric label="Models" value={props.snapshot?.providers.flatMap((provider) => Object.values(provider.models)).filter((model) => model.status !== "deprecated").length ?? 0} />
        <Metric label="Agents" value={props.snapshot?.agents.length ?? 0} />
        <Metric label="Active Sessions" value={Object.values(props.snapshot?.sessionStatus ?? {}).filter((status) => status.type !== "idle").length} />
        <Metric label="Input Needed" value={(props.snapshot?.permissions.length ?? 0) + (props.snapshot?.questions.length ?? 0)} />
      </section>
    </div>
  )
}

function CollectionPage(props: { title: string; count: number; description: string }) {
  return (
    <div class="page placeholder-page">
      <p class="eyebrow">Parity area</p>
      <h1>{props.title}</h1>
      <p>{props.description}</p>
      <div class="metric-card large"><strong>{props.count}</strong><span>records available through existing backend APIs</span></div>
    </div>
  )
}

function Panel(props: { title: string; children: JSX.Element }) {
  return <section class="panel"><h2>{props.title}</h2>{props.children}</section>
}

function Metric(props: { label: string; value: number }) {
  return <div class="metric-card"><span>{props.label}</span><strong>{props.value}</strong></div>
}

function StatusPill(props: { status: string }) {
  return <span class={`status ${props.status.replaceAll("_", "-").replaceAll(" ", "-")}`}>{props.status}</span>
}

function TranscriptLoadingState() {
  return (
    <div class="session-loading-state" aria-live="polite" aria-busy="true">
      <span class="session-loading-spinner" />
      <p>Loading...</p>
    </div>
  )
}

function SessionEmptyState() {
  return (
    <div class="session-empty-state">
      <OpencodeXLogo />
      <p>What should OpencodeX work on?</p>
    </div>
  )
}

function Empty(props: { text: string }) {
  return <div class="empty">{props.text}</div>
}

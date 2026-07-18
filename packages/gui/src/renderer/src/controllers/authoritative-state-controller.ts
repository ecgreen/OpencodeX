import type { GlobalEvent, Session } from "@opencode-ai/sdk/v2/client"
import { createClientStateSync, type ClientStateSyncState } from "@opencode-ai/sdk/v2/client-sync"
import { clientAttentionItems, createClientWorkItemSelector } from "@opencode-ai/sdk/v2/work-item"
import { createMemo, createSignal, onCleanup, onMount, type Accessor, type Setter } from "solid-js"
import { connectGuiClient, type GuiClient } from "../lib/client"
import { mergeRecentModels, recentModelsFromSessions } from "../lib/app-session-lists"
import { writeRecentModels } from "../lib/app-preferences"
import { emptyGuiSnapshot, reconcileGuiAuthoritativeState } from "../lib/gui-state"
import { globalEventAction, globalEventID, globalEventPayload, mergeLiveSessionData } from "../lib/live-session-patch"
import { trimToLiveTail, type MessageWindow } from "../lib/message-window"
import type { Route } from "../lib/routes"
import {
  runSelectedSessionSync,
  shouldShowViewSessionLoading,
  shouldSkipViewSessionSync,
  viewSessionLoadKey,
} from "../lib/session-hydration"
import { createSessionPresentationController } from "../lib/session-presentation"
import {
  loadClientStateSession,
  sessionDataFromClientState,
  subscribeEvents,
  type GuiSnapshot,
  type SessionData,
  type SessionLoadOptions,
} from "../lib/store"
import { syncViewSessionsInParallel } from "../lib/view-sync"
import {
  EMPTY_VIEW_PANE_RUNTIME_STATE,
  setRecordEntry,
  updateViewPaneRuntimeState,
  type ViewPaneRuntimeState,
} from "../lib/view-pane-state"

export const EMPTY_SESSION_DATA: SessionData = { messages: [], todos: [], diffs: [] }
export const SESSION_MESSAGE_PAGE_LIMIT = 128
export const VIEW_MESSAGE_PAGE_LIMIT = 48
export const LOAD_MORE_MESSAGE_MULTIPLIER = 3
const SESSION_MESSAGE_WINDOW: MessageWindow = { count: 128, budget: 100_000 }
const VIEW_MESSAGE_WINDOW: MessageWindow = { count: 48, budget: 28_000 }
const SEEN_EVENT_ID_LIMIT = 2_000

export function createAuthoritativeStateController(input: {
  route: Accessor<Route>
  setRoute: (route: Route) => void
  materializingSession: Accessor<Session | undefined>
  materializingSessionID: Accessor<string>
  recentModels: Accessor<string[]>
  setRecentModels: Setter<string[]>
}) {
  const [client, setClient] = createSignal<GuiClient>()
  const [snapshot, setSnapshot] = createSignal<GuiSnapshot>()
  const [sessionData, setSessionData] = createSignal(EMPTY_SESSION_DATA)
  const [selectedSessionDataCache, setSelectedSessionDataCache] = createSignal<
    Record<string, { data: SessionData; loadedTime: number }>
  >({})
  const [viewSessionData, setViewSessionData] = createSignal<Record<string, SessionData>>({})
  const [viewPaneStates, setViewPaneStates] = createSignal<Record<string, ViewPaneRuntimeState>>({})
  const [sessionDataSessionID, setSessionDataSessionID] = createSignal("")
  const [loading, setLoading] = createSignal("Starting sidecar")
  const [error, setError] = createSignal<string>()
  const [state, setState] = createSignal<ClientStateSyncState>()
  const [loadingSessionID, setLoadingSessionID] = createSignal("")
  const sessionPresentation = createSessionPresentationController({ inactiveLimit: 16 })
  const sessionLoadPromises = new Map<string, { key: string; promise: Promise<void> }>()
  const appliedSessionVersions = new Map<string, string>()
  const seenEventIDs = new Set<string>()
  const seenEventIDOrder: string[] = []
  let sessionSyncRequestID = 0
  let sessionDataLoadedTime = 0
  let stateSync: ReturnType<typeof createClientStateSync> | undefined
  const selectWorkItems = createClientWorkItemSelector()
  const workItems = createMemo(() => state() ? selectWorkItems(state()!) : [])
  const attentionItems = createMemo(() => clientAttentionItems(workItems()))

  async function refresh() {
    if (!stateSync) throw new Error("GUI authoritative state sync is not connected")
    await stateSync.refresh()
  }

  async function refreshCapabilities() {
    if (!stateSync) throw new Error("GUI capability sync is not connected")
    await stateSync.refreshCapabilities()
  }

  async function refreshAll() {
    await Promise.all([refresh(), refreshCapabilities()])
  }

  async function retry() {
    if (!stateSync) throw new Error("GUI authoritative state sync is not connected")
    await stateSync.retry()
    await stateSync.refreshCapabilities()
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

  function rememberSelectedSessionData(sessionID: string, data: SessionData, loadedTime: number) {
    setSelectedSessionDataCache((current) => setRecordEntry(current, sessionID, { data, loadedTime }))
    evictSessionPresentation(sessionPresentation.remember(sessionID))
  }

  function evictSessionPresentation(sessionIDs: readonly string[]) {
    if (sessionIDs.length === 0) return
    const evicted = new Set(sessionIDs)
    setSelectedSessionDataCache((current) =>
      Object.fromEntries(Object.entries(current).filter(([sessionID]) => !evicted.has(sessionID))),
    )
    setViewSessionData((current) =>
      Object.fromEntries(Object.entries(current).filter(([sessionID]) => !evicted.has(sessionID))),
    )
    sessionIDs.forEach((sessionID) => appliedSessionVersions.delete(sessionID))
    if (!evicted.has(sessionDataSessionID())) return
    setSessionData(EMPTY_SESSION_DATA)
    setSessionDataSessionID("")
    sessionDataLoadedTime = 0
  }

  function restoreSelectedSessionData(sessionID: string) {
    if (sessionDataSessionID() === sessionID) return
    const cached = selectedSessionDataCache()[sessionID]
    if (!cached) return
    sessionPresentation.touch(sessionID)
    setSessionData(cached.data)
    setSessionDataSessionID(sessionID)
    sessionDataLoadedTime = cached.loadedTime
  }

  function applyState(nextState: ClientStateSyncState) {
    setState(nextState)
    if (nextState.lifecycle.status === "connected") {
      setLoading("")
      setError(undefined)
    }
    if (nextState.lifecycle.status === "error" && nextState.lifecycle.data === "empty")
      setError(nextState.lifecycle.error ?? nextState.error ?? "Authoritative state sync failed")
    if (nextState.epoch && nextState.scope)
      evictSessionPresentation(
        sessionPresentation.reconcile(
          `${nextState.epoch}\n${nextState.scope.projectID}\n${nextState.scope.workspaceID ?? ""}\n${nextState.scope.directory}`,
          new Set(nextState.sessions.ids),
        ),
      )
    const next = reconcileGuiAuthoritativeState(snapshot(), nextState)
    if (!next) return
    setSnapshot(next)
    Object.keys(nextState.sessionDetails).forEach((sessionID) => {
      const detail = nextState.sessionDetails[sessionID]
      if (!detail) return
      const version = `${nextState.epoch ?? ""}:${detail.revision}`
      if (appliedSessionVersions.get(sessionID) === version) return
      appliedSessionVersions.set(sessionID, version)
      const data = sessionDataFromClientState(nextState, sessionID)
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
    const models = mergeRecentModels(recentModelsFromSessions(next.sessions), input.recentModels())
    if (models.join("\n") === input.recentModels().join("\n")) return
    input.setRecentModels(models)
    writeRecentModels(models)
  }

  async function loadSession(sessionID: string, options: SessionLoadOptions) {
    if (stateSync?.getState().phase !== "ready") throw new Error("GUI authoritative state sync is not ready")
    return loadClientStateSession(stateSync, sessionID, {
      limit: options.messageLimit,
      before: options.messageBefore,
    })
  }

  async function syncSession(sessionID: string, options: { force?: boolean } = {}) {
    if (!client()) return
    restoreSelectedSessionData(sessionID)
    const session =
      snapshot()?.sessions.find((item) => item.id === sessionID) ??
      (input.materializingSessionID() === sessionID ? input.materializingSession() : undefined)
    await runSelectedSessionSync({
      force: options.force,
      sessionID,
      session,
      loadedSessionID: sessionDataSessionID(),
      loadedTime: sessionDataLoadedTime,
      nextRequestID: () => ++sessionSyncRequestID,
      latestRequestID: () => sessionSyncRequestID,
      route: () =>
        input.route().name === "new-session" && input.materializingSessionID() === sessionID
          ? { name: "session", sessionID }
          : input.route(),
      loadingSessionID,
      setLoadingSessionID,
      clearLoadingSessionID: () => setLoadingSessionID(""),
      loadData: (targetSessionID) =>
        sessionPresentation.load(
          targetSessionID,
          `tail:${SESSION_MESSAGE_PAGE_LIMIT}:${session?.directory ?? ""}:${session?.time.updated ?? 0}`,
          async () => trimToLiveTail(await loadSession(targetSessionID, { messageLimit: SESSION_MESSAGE_PAGE_LIMIT }), SESSION_MESSAGE_WINDOW),
        ),
      applyData: (data, loadedTime) => {
        const next = sessionDataSessionID() === sessionID ? mergeLiveSessionData(sessionData(), data) : data
        setSessionData(next)
        setSessionDataSessionID(sessionID)
        sessionDataLoadedTime = loadedTime
        rememberSelectedSessionData(sessionID, next, loadedTime)
        if (input.route().name === "new-session" && input.materializingSessionID() === sessionID)
          input.setRoute({ name: "session", sessionID })
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
    if (!client()) return
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
    const existing = sessionLoadPromises.get(session.id)
    if (existing?.key === loadKey) return existing.promise
    const showLoading = shouldShowViewSessionLoading(viewSessionData()[session.id])
    if (showLoading) setViewPaneLoading(session.id, true)
    const promise = sessionPresentation
      .load(session.id, loadKey, async () =>
        trimToLiveTail(await loadSession(session.id, { messageLimit: VIEW_MESSAGE_PAGE_LIMIT }), VIEW_MESSAGE_WINDOW),
      )
      .then((data) => {
        if (sessionLoadPromises.get(session.id)?.key !== loadKey) return
        setViewSessionData((current) =>
          setRecordEntry(current, session.id, mergeLiveSessionData(current[session.id], data)),
        )
        setViewPaneLoadedTime(session.id, session.time.updated)
        evictSessionPresentation(sessionPresentation.remember(session.id))
      })
      .finally(() => {
        if (sessionLoadPromises.get(session.id)?.key !== loadKey) return
        sessionLoadPromises.delete(session.id)
        if (showLoading) setViewPaneLoading(session.id, false)
      })
    sessionLoadPromises.set(session.id, { key: loadKey, promise })
    return promise
  }

  async function loadOlderSessionMessages(sessionID: string, before: string) {
    if (sessionDataSessionID() !== sessionID) return
    const data = await sessionPresentation.load(sessionID, `older:${before}`, () =>
      loadSession(sessionID, { messageLimit: SESSION_MESSAGE_PAGE_LIMIT * LOAD_MORE_MESSAGE_MULTIPLIER, messageBefore: before }),
    )
    if (sessionDataSessionID() !== sessionID) return
    const next = { ...data, messageWindowExpanded: true }
    setSessionData(next)
    rememberSelectedSessionData(sessionID, next, sessionDataLoadedTime)
  }

  async function loadOlderViewSessionMessages(sessionID: string, before: string) {
    if (!snapshot()?.sessions.some((session) => session.id === sessionID)) return
    const data = await sessionPresentation.load(sessionID, `view-older:${before}`, () =>
      loadSession(sessionID, { messageLimit: VIEW_MESSAGE_PAGE_LIMIT * LOAD_MORE_MESSAGE_MULTIPLIER, messageBefore: before }),
    )
    setViewSessionData((current) => setRecordEntry(current, sessionID, { ...data, messageWindowExpanded: true }))
    evictSessionPresentation(sessionPresentation.remember(sessionID))
  }

  async function syncViewSessions(sessions: Session[], focusedSessionID: string) {
    await syncViewSessionsInParallel(sessions, focusedSessionID, syncViewSession)
  }

  function setVisibleSessionIDs(sessionIDs: string[]) {
    evictSessionPresentation(sessionPresentation.setVisible(sessionIDs))
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

  function handleGlobalEvent(event: GlobalEvent) {
    const id = globalEventID(event)
    if (id && !rememberEventID(id)) return
    const payload = globalEventPayload(event)
    if (payload && stateSync?.applyEvent(payload)) return
    const action = globalEventAction(event)
    if (action.type !== "refresh") return
    void (action.root ? refreshAll() : refreshCapabilities())
  }

  onMount(() => {
    let unsubscribeEvents: (() => void) | undefined
    let unsubscribeState: (() => void) | undefined
    onCleanup(() => {
      unsubscribeEvents?.()
      unsubscribeState?.()
      stateSync?.stop()
    })
    void (async () => {
      try {
        const gui = await connectGuiClient()
        setClient(gui)
        setSnapshot(emptyGuiSnapshot())
        setLoading("Loading workspace")
        stateSync = createClientStateSync({ client: gui.client, directory: gui.directory || undefined })
        unsubscribeState = stateSync.subscribe(applyState)
        unsubscribeEvents = subscribeEvents(gui, handleGlobalEvent)
        await Promise.all([stateSync.start(), refreshCapabilities()])
        setLoading("")
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
  })

  return {
    client,
    snapshot,
    setSnapshot,
    sessionData,
    selectedSessionDataCache,
    viewSessionData,
    setViewSessionData,
    viewPaneStates,
    setViewPaneStates,
    sessionDataSessionID,
    loading,
    error,
    state,
    workItems,
    attentionItems,
    loadingSessionID,
    setLoadingSessionID,
    refresh,
    refreshCapabilities,
    refreshAll,
    retry,
    viewPaneState,
    updateViewPaneState,
    setViewPaneLoading,
    loadSession,
    syncSession,
    syncViewSession,
    syncViewSessions,
    loadOlderSessionMessages,
    loadOlderViewSessionMessages,
    setVisibleSessionIDs,
  }
}

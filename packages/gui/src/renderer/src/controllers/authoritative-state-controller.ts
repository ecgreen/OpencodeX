import type { GlobalEvent, Session } from "@opencode-ai/sdk/v2/client"
import {
  createClientStateSync,
  selectClientKnownSessionIDs,
  type ClientStateSyncState,
} from "@opencode-ai/sdk/v2/client-sync"
import { clientAttentionItems, createClientWorkItemSelector } from "@opencode-ai/sdk/v2/work-item"
import { createMemo, createSignal, onCleanup, onMount, type Accessor, type Setter } from "solid-js"
import { connectGuiClient, type GuiClient } from "../lib/client"
import { emptyGuiSnapshot } from "../lib/gui-state"
import { createGlobalEventFanout } from "../lib/global-event-fanout"
import { createGlobalEventBatcher } from "../lib/global-event-batcher"
import { globalEventAction, globalEventID, globalEventPayload } from "../lib/live-session-patch"
import {
  RENDERER_PERFORMANCE_MARKS,
  RENDERER_PERFORMANCE_MEASURES,
  markPerformance,
  measurePerformance,
} from "../lib/performance"
import type { Route } from "../lib/routes"
import { createSessionHydrationController } from "../lib/session-hydration"
import { loadMruSessions } from "../lib/mru-sessions"
import { readSidebarPreferences } from "../lib/sidebar-preferences"
export {
  LOAD_MORE_MESSAGE_MULTIPLIER,
  SESSION_MESSAGE_PAGE_LIMIT,
  VIEW_MESSAGE_PAGE_LIMIT,
} from "../lib/session-hydration"
import { createDeferredSessionRelease, createSessionPresentationController } from "../lib/session-presentation"
import { subscribeEvents, type GuiSnapshot, type SessionData } from "../lib/store"
import {
  EMPTY_VIEW_PANE_RUNTIME_STATE,
  setRecordEntry,
  updateViewPaneRuntimeState,
  type ViewPaneRuntimeState,
} from "../lib/view-pane-state"
import { createAuthoritativeStateApplicator } from "./authoritative-state-applicator"

export const EMPTY_SESSION_DATA: SessionData = { messages: [], todos: [], diffs: [] }
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
  const appliedSessionVersions = new Map<string, string>()
  const seenEventIDs = new Set<string>()
  const seenEventIDOrder: string[] = []
  const globalEvents = createGlobalEventFanout()
  let sessionDataLoadedTime = 0
  let stateSync: ReturnType<typeof createClientStateSync> | undefined
  const releaseSessions = createDeferredSessionRelease({
    release: (sessionID) => stateSync?.releaseSession(sessionID),
    retained: (sessionID) =>
      sessionPresentation.visibleSessionIDs().includes(sessionID) ||
      sessionPresentation.cachedSessionIDs().includes(sessionID) ||
      Boolean(selectedSessionDataCache()[sessionID]) ||
      Boolean(viewSessionData()[sessionID]) ||
      sessionDataSessionID() === sessionID,
  })
  const liveEvents = createGlobalEventBatcher({
    delay: 16,
    apply: (events) => stateSync?.applyEvents(events) ?? [],
    fallback: applyGlobalEventFallback,
  })
  const selectWorkItems = createClientWorkItemSelector()
  const workItems = createMemo(() => (state() ? selectWorkItems(state()!) : []))
  const attentionItems = createMemo(() => clientAttentionItems(workItems()))
  const applyAuthoritativeState = createAuthoritativeStateApplicator({
    state,
    setState,
    snapshot,
    setSnapshot,
    setLoading,
    setError,
    reconcilePresentation,
    selectedData: selectedSessionDataCache,
    setSelectedData: setSelectedSessionDataCache,
    activeSessionID: sessionDataSessionID,
    activeData: sessionData,
    setActiveData: setSessionData,
    activeLoadedTime: () => sessionDataLoadedTime,
    setActiveLoadedTime: (time) => (sessionDataLoadedTime = time),
    rememberActiveData: rememberSelectedSessionData,
    viewData: viewSessionData,
    setViewData: setViewSessionData,
    viewLoadedTime: (sessionID) => viewPaneState(sessionID).loadedTime,
    setViewLoadedTime: setViewPaneLoadedTime,
    appliedVersions: appliedSessionVersions,
    recentModels: input.recentModels,
    setRecentModels: input.setRecentModels,
    metrics: () => stateSync?.getMetrics(),
    retention: () => ({
      cards: stateSync?.getState().sessions.ids.length ?? 0,
      canonicalDetails: Object.keys(stateSync?.getState().sessionDetails ?? {}).length,
      canonicalLoads: Object.keys(stateSync?.getState().sessionLoads ?? {}).length,
      selectedDetails: Object.keys(selectedSessionDataCache()).length,
      viewDetails: Object.keys(viewSessionData()).length,
      presentationCached: sessionPresentation.cachedSessionIDs().length,
      presentationVisible: sessionPresentation.visibleSessionIDs().length,
      appliedVersions: appliedSessionVersions.size,
    }),
  })
  const sessionHydration = createSessionHydrationController({
    connected: () => Boolean(client()),
    stateSync: () => stateSync,
    route: input.route,
    setRoute: input.setRoute,
    snapshot,
    materializingSession: input.materializingSession,
    materializingSessionID: input.materializingSessionID,
    presentation: sessionPresentation,
    selectedData: selectedSessionDataCache,
    emptyData: EMPTY_SESSION_DATA,
    sessionData,
    setSessionData,
    sessionDataSessionID,
    setSessionDataSessionID,
    loadedTime: () => sessionDataLoadedTime,
    setLoadedTime: (time) => (sessionDataLoadedTime = time),
    loadingSessionID,
    setLoadingSessionID,
    viewData: viewSessionData,
    setViewData: setViewSessionData,
    viewLoadedTime: (sessionID) => viewPaneState(sessionID).loadedTime,
    setViewLoadedTime: setViewPaneLoadedTime,
    setViewLoading: setViewPaneLoading,
    rememberSelectedData: rememberSelectedSessionData,
    evictPresentation: evictSessionPresentation,
  })

  function applyState(next: ClientStateSyncState) {
    const previous = state()
    const reconcileUnionMembership =
      previous !== undefined &&
      previous.sessions === next.sessions &&
      (previous.projects !== next.projects || previous.views !== next.views)
    if (state()?.sessionLoads !== next.sessionLoads) {
      liveEvents.setImmediate(
        Object.values(next.sessionLoads).some((load) => load.initial === "loading" || load.older === "loading"),
      )
      if (stateSync?.getState() !== next) return
    }
    applyAuthoritativeState(next)
    if (reconcileUnionMembership) reconcilePresentation(next)
  }

  function reconcilePresentation(next: ClientStateSyncState) {
    if (!next.epoch || !next.scope) return
    evictSessionPresentation(
      sessionPresentation.reconcile(
        `${next.epoch}\n${next.scope.projectID}\n${next.scope.workspaceID ?? ""}\n${next.scope.directory}`,
        selectClientKnownSessionIDs(next),
      ),
    )
  }

  async function refresh() {
    if (!stateSync) throw new Error("GUI authoritative state sync is not connected")
    await stateSync.refresh()
  }

  async function refreshCapabilities() {
    if (!stateSync) throw new Error("GUI capability sync is not connected")
    await stateSync.refreshCapabilities()
  }

  async function loadMoreSessionCards(signal?: AbortSignal) {
    if (!stateSync) throw new Error("GUI authoritative state sync is not connected")
    return stateSync.loadSessionCards({ signal })
  }

  async function ensureSessionCards(sessionIDs: readonly string[], signal?: AbortSignal) {
    if (!stateSync) throw new Error("GUI authoritative state sync is not connected")
    return stateSync.ensureSessionCards(sessionIDs, { signal })
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
    sessionIDs.forEach((sessionID) => {
      appliedSessionVersions.delete(sessionID)
    })
    releaseSessions(sessionIDs)
    if (!evicted.has(sessionDataSessionID())) return
    setSessionData(EMPTY_SESSION_DATA)
    setSessionDataSessionID("")
    sessionDataLoadedTime = 0
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
    globalEvents.publish(event)
    if (event.payload.type === "opencodex.gui_bridge.request") {
      return
    }
    const payload = globalEventPayload(event)
    if (payload) {
      if (globalEventAction(event).type === "refresh") {
        if (!stateSync?.applyEvent(payload)) applyGlobalEventFallback(event)
        return
      }
      liveEvents.push(event, payload)
      return
    }
    applyGlobalEventFallback(event)
  }

  function applyGlobalEventFallback(event: GlobalEvent) {
    const action = globalEventAction(event)
    if (action.type !== "refresh") return
    void (action.root ? refreshAll() : refreshCapabilities())
  }

  onMount(() => {
    let unsubscribeEvents: (() => void) | undefined
    let unsubscribeState: (() => void) | undefined
    onCleanup(() => {
      liveEvents.clear()
      unsubscribeEvents?.()
      unsubscribeState?.()
      stateSync?.stop()
    })
    void (async () => {
      try {
        markPerformance(RENDERER_PERFORMANCE_MARKS.connectionStarted)
        const gui = await connectGuiClient()
        markPerformance(RENDERER_PERFORMANCE_MARKS.clientConnected)
        measurePerformance(
          RENDERER_PERFORMANCE_MEASURES.connection,
          RENDERER_PERFORMANCE_MARKS.connectionStarted,
          RENDERER_PERFORMANCE_MARKS.clientConnected,
        )
        setClient(gui)
        setSnapshot(emptyGuiSnapshot())
        setLoading("Loading workspace")
        stateSync = createClientStateSync({
          client: gui.client,
          directory: gui.directory || undefined,
        })
        unsubscribeState = stateSync.subscribe(applyState)
        unsubscribeEvents = subscribeEvents(gui, handleGlobalEvent)
        await stateSync.start()
        const preferences = readSidebarPreferences()
        const route = input.route()
        await Promise.all([
          refreshCapabilities(),
          stateSync.ensureSessionCards([
            ...preferences.pinnedSessionIDs,
            ...loadMruSessions(),
            ...(route.name === "session" && route.sessionID ? [route.sessionID] : []),
          ]),
        ])
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
    loadMoreSessionCards,
    ensureSessionCards,
    refreshAll,
    retry,
    viewPaneState,
    updateViewPaneState,
    setViewPaneLoading,
    ...sessionHydration,
    subscribeGlobalEvents: globalEvents.subscribe,
  }
}

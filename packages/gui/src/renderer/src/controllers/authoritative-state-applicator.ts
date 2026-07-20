import type { ClientStateSyncMetrics, ClientStateSyncState } from "@opencode-ai/sdk/v2/client-sync"
import { batch, type Accessor, type Setter } from "solid-js"
import { mergeRecentModels, recentModelsFromSessions } from "../lib/app-session-lists"
import { writeRecentModels } from "../lib/app-preferences"
import { authoritativeStateChanges } from "../lib/authoritative-state-changes"
import {
  reconcileGuiCapabilityState,
  reconcileGuiCatalog,
  reconcileGuiOperations,
} from "../lib/gui-state"
import { mergeLiveSessionData } from "../lib/live-session-patch"
import { sessionLoadedTime } from "../lib/session-hydration"
import {
  RENDERER_PERFORMANCE_MARKS,
  RENDERER_PERFORMANCE_MEASURES,
  RENDERER_PERFORMANCE_OPERATIONS,
  finishPerformance,
  markPerformance,
  measurePerformance,
  recordPerformanceDetail,
  startPerformance,
} from "../lib/performance"
import { sessionDataFromClientState, type GuiSnapshot, type SessionData } from "../lib/store"
import { setRecordEntry } from "../lib/view-pane-state"

type CachedSessionData = Record<string, { data: SessionData; loadedTime: number }>

export function createAuthoritativeStateApplicator(input: {
  state: Accessor<ClientStateSyncState | undefined>
  setState: Setter<ClientStateSyncState | undefined>
  snapshot: Accessor<GuiSnapshot | undefined>
  setSnapshot: Setter<GuiSnapshot | undefined>
  setLoading: Setter<string>
  setError: Setter<string | undefined>
  reconcilePresentation: (state: ClientStateSyncState) => void
  selectedData: Accessor<CachedSessionData>
  setSelectedData: Setter<CachedSessionData>
  activeSessionID: Accessor<string>
  activeData: Accessor<SessionData>
  setActiveData: Setter<SessionData>
  activeLoadedTime: () => number
  setActiveLoadedTime: (time: number) => void
  rememberActiveData: (sessionID: string, data: SessionData, loadedTime: number) => void
  viewData: Accessor<Record<string, SessionData>>
  setViewData: Setter<Record<string, SessionData>>
  viewLoadedTime: (sessionID: string) => number | undefined
  setViewLoadedTime: (sessionID: string, loadedTime: number) => void
  appliedVersions: Map<string, string>
  recentModels: Accessor<string[]>
  setRecentModels: Setter<string[]>
  metrics: () => ClientStateSyncMetrics | undefined
  retention: () => Record<string, number>
}) {
  let connectedMarked = false

  return (nextState: ClientStateSyncState) => {
    const started = startPerformance()
    const previousState = input.state()
    const changes = authoritativeStateChanges(previousState, nextState)
    batch(() => {
      input.setState(nextState)
      updateLifecycle(nextState)
      if (changes.presentation) input.reconcilePresentation(nextState)
      const snapshotStarted = startPerformance()
      const currentSnapshot = input.snapshot()
      const catalog = changes.catalog ? reconcileGuiCatalog(currentSnapshot, nextState) : currentSnapshot
      const operations = changes.operations ? reconcileGuiOperations(catalog, nextState) : catalog
      const snapshot = changes.capabilities ? reconcileGuiCapabilityState(operations, nextState) : operations
      if (snapshot && snapshot !== currentSnapshot) input.setSnapshot(snapshot)
      finishPerformance(RENDERER_PERFORMANCE_OPERATIONS.reconcileSnapshot, snapshotStarted)
      if (changes.details) applySessionDetails(previousState, nextState)
      if (changes.catalog && snapshot) updateRecentModels(snapshot)
    })
    recordPerformanceDetail("stateSync", input.metrics())
    recordPerformanceDetail("stateSyncLifecycle", nextState.lifecycle)
    recordPerformanceDetail("retention", input.retention())
    finishPerformance(RENDERER_PERFORMANCE_OPERATIONS.applyAuthoritativeState, started)
  }

  function updateLifecycle(state: ClientStateSyncState) {
    if (state.lifecycle.status === "connected") {
      input.setLoading("")
      input.setError(undefined)
      if (connectedMarked) return
      connectedMarked = true
      markPerformance(RENDERER_PERFORMANCE_MARKS.stateConnected)
      measurePerformance(
        RENDERER_PERFORMANCE_MEASURES.bootstrapToStateConnected,
        RENDERER_PERFORMANCE_MARKS.bootstrap,
        RENDERER_PERFORMANCE_MARKS.stateConnected,
      )
      return
    }
    if (state.lifecycle.status === "error" && state.lifecycle.data === "empty")
      input.setError(state.lifecycle.error ?? state.error ?? "Authoritative state sync failed")
  }

  function applySessionDetails(previousState: ClientStateSyncState | undefined, nextState: ClientStateSyncState) {
    Object.keys(nextState.sessionDetails).forEach((sessionID) => {
      const detail = nextState.sessionDetails[sessionID]
      if (!detail || previousState?.sessionDetails[sessionID] === detail) return
      const version = `${nextState.epoch ?? ""}:${detail.revision}`
      if (input.appliedVersions.get(sessionID) === version) return
      const cached = input.selectedData()[sessionID]
      const active = input.activeSessionID() === sessionID
      const viewData = input.viewData()[sessionID]
      const current = active ? input.activeData() : cached?.data ?? viewData
      if (!current) return
      const started = startPerformance()
      const projected = sessionDataFromClientState(nextState, sessionID, current)
      finishPerformance(RENDERER_PERFORMANCE_OPERATIONS.projectSession, started)
      if (!projected) return
      input.appliedVersions.set(sessionID, version)
      const loadedTime = sessionLoadedTime(
        active ? input.activeLoadedTime() : cached?.loadedTime,
        input.viewLoadedTime(sessionID),
        detail.snapshot.session.time.updated,
      )
      const selected = mergeLiveSessionData(current, projected)
      if (active) {
        input.setActiveData(selected)
        input.setActiveLoadedTime(loadedTime)
        input.rememberActiveData(sessionID, selected, loadedTime)
      } else if (cached) {
        input.setSelectedData((value) => setRecordEntry(value, sessionID, { data: selected, loadedTime }))
      }
      if (!viewData) return
      input.setViewData((value) =>
        setRecordEntry(value, sessionID, viewData === current ? selected : mergeLiveSessionData(viewData, projected)),
      )
      input.setViewLoadedTime(sessionID, loadedTime)
    })
  }

  function updateRecentModels(snapshot: GuiSnapshot) {
    const models = mergeRecentModels(recentModelsFromSessions(snapshot.sessions), input.recentModels())
    if (models.join("\n") === input.recentModels().join("\n")) return
    input.setRecentModels(models)
    writeRecentModels(models)
  }
}

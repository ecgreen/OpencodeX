import type { Session } from "@opencode-ai/sdk/v2/client"
import type { ClientStateSyncController } from "@opencode-ai/sdk/v2/client-sync"
import { batch, type Accessor, type Setter } from "solid-js"
import {
  fetchClientStateSessionPage,
  loadClientStateSessionTranscript,
  refreshClientStateSessionTail,
} from "./client-session-loader"
import { mergeLiveSessionData } from "./live-session-patch"
import { isGraphVisibleSession } from "./session-graph-visibility"
import { collapseMessageWindow, prependOlderMessages, trimToLiveTail } from "./message-window"
import type { Route } from "./routes"
import {
  ignoreAbortedSessionLoad,
  sessionLoadedTime,
  shouldApplySessionSyncResult,
  shouldClearSessionSyncLoading,
  shouldHandleSessionSyncFailure,
  shouldShowViewSessionLoading,
  shouldSkipSessionSync,
  shouldSkipViewSessionSync,
  viewSessionLoadKey,
} from "./session-hydration-policy"
import type { SessionPresentationController } from "./session-presentation"
import type { GuiSnapshot, SessionData } from "./store-types"
import { setRecordEntry } from "./view-pane-state"
import { syncViewSessionsInParallel } from "./view-sync"

type SessionSyncRoute = { name: string; sessionID?: string }
type CachedSessionData = Record<string, { data: SessionData; loadedTime: number }>

export const SESSION_MESSAGE_PAGE_LIMIT = 128
export const VIEW_MESSAGE_PAGE_LIMIT = 48
export const LOAD_MORE_MESSAGE_MULTIPLIER = 3
export const SESSION_MESSAGE_WINDOW = { count: 128, budget: 100_000 }
export const VIEW_MESSAGE_WINDOW = { count: 48, budget: 28_000 }

export async function runSelectedSessionSync(input: {
  force?: boolean
  sessionID: string
  session?: Session
  loadedSessionID: string
  loadedTime: number
  nextRequestID: () => number
  latestRequestID: () => number
  route: () => SessionSyncRoute
  loadingSessionID: () => string
  setLoadingSessionID: (sessionID: string) => void
  clearLoadingSessionID: () => void
  loadData: (sessionID: string, directory?: string) => Promise<SessionData>
  canonicalUpdatedTime?: () => number | undefined
  applyData: (data: SessionData, loadedTime: number) => void
  applyFailure: (cause: unknown) => void
  now?: () => number
}) {
  if (shouldSkipSessionSync({
    force: input.force,
    sessionID: input.sessionID,
    loadedSessionID: input.loadedSessionID,
    loadedTime: input.loadedTime,
    session: input.session,
  })) return

  const requestID = input.nextRequestID()
  input.setLoadingSessionID(input.sessionID)
  try {
    const data = await input.loadData(input.sessionID, input.session?.directory)
    if (!shouldApplySessionSyncResult({ requestID, latestRequestID: input.latestRequestID(), route: input.route(), sessionID: input.sessionID })) return
    input.applyData(
      data,
      sessionLoadedTime(
        input.loadedSessionID === input.sessionID ? input.loadedTime : undefined,
        input.session?.time.updated,
        input.canonicalUpdatedTime?.(),
        (input.now ?? Date.now)(),
      ),
    )
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") return
    if (shouldHandleSessionSyncFailure({ requestID, latestRequestID: input.latestRequestID() })) input.applyFailure(cause)
  } finally {
    if (shouldClearSessionSyncLoading({ requestID, latestRequestID: input.latestRequestID(), loadingSessionID: input.loadingSessionID(), sessionID: input.sessionID })) input.clearLoadingSessionID()
  }
}

export function createSessionHydrationController(input: {
  connected: () => boolean
  stateSync: () => ClientStateSyncController | undefined
  route: Accessor<Route>
  setRoute: (route: Route) => void
  snapshot: Accessor<GuiSnapshot | undefined>
  materializingSession: Accessor<Session | undefined>
  materializingSessionID: Accessor<string>
  presentation: SessionPresentationController
  selectedData: Accessor<CachedSessionData>
  emptyData: SessionData
  sessionData: Accessor<SessionData>
  setSessionData: Setter<SessionData>
  sessionDataSessionID: Accessor<string>
  setSessionDataSessionID: Setter<string>
  loadedTime: () => number
  setLoadedTime: (time: number) => void
  loadingSessionID: Accessor<string>
  setLoadingSessionID: Setter<string>
  viewData: Accessor<Record<string, SessionData>>
  setViewData: Setter<Record<string, SessionData>>
  viewLoadedTime: (sessionID: string) => number | undefined
  setViewLoadedTime: (sessionID: string, loadedTime: number) => void
  setViewLoading: (sessionID: string, loading: boolean) => void
  rememberSelectedData: (sessionID: string, data: SessionData, loadedTime: number) => void
  evictPresentation: (sessionIDs: readonly string[]) => void
}) {
  const sessionLoadPromises = new Map<string, { key: string; generation: number; promise: Promise<void> }>()
  let selectedGeneration = 0
  let viewGeneration = 0
  let viewBatch: { sessionIDs: Set<string>; controller: AbortController } | undefined

  const controller = () => {
    const result = input.stateSync()
    if (result?.getState().phase !== "ready") throw new Error("GUI authoritative state sync is not ready")
    return result
  }
  const loadTail = (sessionID: string, limit: number, signal: AbortSignal, current?: SessionData) =>
    refreshClientStateSessionTail(controller(), sessionID, { limit, signal }, current)

  async function loadSessionTranscript(sessionID: string, signal?: AbortSignal) {
    return loadClientStateSessionTranscript(controller(), sessionID, { signal })
  }

  async function syncSession(sessionID: string, options: { force?: boolean } = {}) {
    if (!input.connected()) return
    restoreSelectedData(sessionID)
    const session =
      input.snapshot()?.sessions.find((item) => item.id === sessionID) ??
      (input.materializingSessionID() === sessionID ? input.materializingSession() : undefined)
    await runSelectedSessionSync({
      force: options.force,
      sessionID,
      session,
      loadedSessionID: input.sessionDataSessionID(),
      loadedTime: input.loadedTime(),
      nextRequestID: () => ++selectedGeneration,
      latestRequestID: () => selectedGeneration,
      route: () =>
        input.route().name === "new-session" && input.materializingSessionID() === sessionID
          ? { name: "session", sessionID }
          : input.route(),
      loadingSessionID: input.loadingSessionID,
      setLoadingSessionID: input.setLoadingSessionID,
      clearLoadingSessionID: () => input.setLoadingSessionID(""),
      loadData: (targetSessionID) =>
        input.presentation.load(
          targetSessionID,
          `tail:${SESSION_MESSAGE_PAGE_LIMIT}:${session?.directory ?? ""}:${session?.time.updated ?? 0}`,
          async (signal) =>
            trimToLiveTail(
              await loadTail(
                targetSessionID,
                SESSION_MESSAGE_PAGE_LIMIT,
                signal,
                input.sessionDataSessionID() === targetSessionID
                  ? input.sessionData()
                  : input.selectedData()[targetSessionID]?.data,
              ),
              SESSION_MESSAGE_WINDOW,
            ),
        ),
      canonicalUpdatedTime: () => controller().getState().sessionDetails[sessionID]?.snapshot.session.time.updated,
      applyData: (data, loadedTime) => {
        const next =
          input.sessionDataSessionID() === sessionID ? mergeLiveSessionData(input.sessionData(), data) : data
        input.setSessionData(next)
        input.setSessionDataSessionID(sessionID)
        input.setLoadedTime(loadedTime)
        input.rememberSelectedData(sessionID, next, loadedTime)
        if (input.route().name === "new-session" && input.materializingSessionID() === sessionID)
          input.setRoute({ name: "session", sessionID })
      },
      applyFailure: (cause) => {
        console.error(cause)
        if (input.sessionDataSessionID() === sessionID || input.selectedData()[sessionID]) return
        input.setSessionData(input.emptyData)
        input.setSessionDataSessionID(sessionID)
      },
    })
  }

  async function syncViewSession(session: Session, options: { force?: boolean } = {}) {
    if (!input.connected()) return
    if (!input.presentation.visibleSessionIDs().includes(session.id)) return
    if (
      shouldSkipViewSessionSync({
        force: options.force,
        session,
        data: input.viewData()[session.id],
        loadedTime: input.viewLoadedTime(session.id),
      })
    )
      return
    const loadKey = viewSessionLoadKey(session)
    const existing = sessionLoadPromises.get(session.id)
    if (existing?.key === loadKey) return existing.promise
    const generation = ++viewGeneration
    const showLoading = shouldShowViewSessionLoading(input.viewData()[session.id])
    if (showLoading) input.setViewLoading(session.id, true)
    const promise = ignoreAbortedSessionLoad(
      input.presentation.load(session.id, loadKey, async (signal) =>
        trimToLiveTail(
          await loadTail(session.id, VIEW_MESSAGE_PAGE_LIMIT, signal, input.viewData()[session.id]),
          VIEW_MESSAGE_WINDOW,
        ),
      ),
    )
      .then((data) => {
        if (!data || sessionLoadPromises.get(session.id)?.generation !== generation) return
        if (!input.presentation.visibleSessionIDs().includes(session.id)) return
        // "Still exists" check. The catalog hides swarm-delegated children by
        // design, so a session the workflow graph fetched itself counts too -
        // without that, an opened graph node loads its transcript and then
        // throws it away right here.
        if (!knownViewSession(session.id)) return
        input.setViewData((current) =>
          setRecordEntry(current, session.id, mergeLiveSessionData(current[session.id], data)),
        )
        input.setViewLoadedTime(
          session.id,
          sessionLoadedTime(
            input.viewLoadedTime(session.id),
            session.time.updated,
            controller().getState().sessionDetails[session.id]?.snapshot.session.time.updated,
          ),
        )
        input.evictPresentation(input.presentation.remember(session.id))
      })
      .finally(() => {
        if (sessionLoadPromises.get(session.id)?.generation !== generation) return
        sessionLoadPromises.delete(session.id)
        if (showLoading) input.setViewLoading(session.id, false)
      })
    sessionLoadPromises.set(session.id, { key: loadKey, generation, promise })
    return promise
  }

  async function loadOlderSessionMessages(sessionID: string, before: string) {
    if (input.sessionDataSessionID() !== sessionID) return
    const page = await fetchOlderPage(sessionID, before, SESSION_MESSAGE_PAGE_LIMIT, "older")
    if (!page || input.sessionDataSessionID() !== sessionID) return
    const next = prependOlderMessages(input.sessionData(), { messages: page.messages, cursor: page.messageCursor })
    batch(() => {
      input.setSessionData(next)
      input.rememberSelectedData(sessionID, next, input.loadedTime())
    })
  }

  /**
   * Returns an expanded transcript to the live tail window. The panel calls this
   * once the reader is following the bottom again, so an expanded session cannot
   * keep growing for the rest of its life.
   */
  function collapseSessionMessageWindow(sessionID: string) {
    if (input.sessionDataSessionID() !== sessionID) return
    const current = input.sessionData()
    const next = collapseMessageWindow(current, SESSION_MESSAGE_WINDOW)
    if (next === current) return
    batch(() => {
      input.setSessionData(next)
      input.rememberSelectedData(sessionID, next, input.loadedTime())
    })
  }

  function collapseViewSessionMessageWindow(sessionID: string) {
    const current = input.viewData()[sessionID]
    if (!current) return
    const next = collapseMessageWindow(current, VIEW_MESSAGE_WINDOW)
    if (next === current) return
    input.setViewData((value) => setRecordEntry(value, sessionID, next))
  }

  /** Same catalog caveat as `syncViewSession`: graph-fetched children count. */
  const knownViewSession = (sessionID: string) =>
    input.snapshot()?.sessions.some((session) => session.id === sessionID) === true ||
    isGraphVisibleSession(sessionID)

  async function loadOlderViewSessionMessages(sessionID: string, before: string) {
    if (!knownViewSession(sessionID)) return
    const page = await fetchOlderPage(sessionID, before, VIEW_MESSAGE_PAGE_LIMIT, "view-older")
    if (!page || !input.presentation.visibleSessionIDs().includes(sessionID)) return
    if (!knownViewSession(sessionID)) return
    const current = input.viewData()[sessionID]
    if (!current) return
    batch(() => {
      input.setViewData((value) =>
        setRecordEntry(
          value,
          sessionID,
          prependOlderMessages(current, { messages: page.messages, cursor: page.messageCursor }),
        ),
      )
      input.evictPresentation(input.presentation.remember(sessionID))
    })
  }

  async function fetchOlderPage(sessionID: string, before: string, pageLimit: number, key: string) {
    return ignoreAbortedSessionLoad(
      input.presentation.load(sessionID, `${key}:${before}`, (signal) =>
        fetchClientStateSessionPage(controller(), sessionID, {
          limit: pageLimit * LOAD_MORE_MESSAGE_MULTIPLIER,
          before,
          signal,
        }),
      ),
    )
  }

  function restoreSelectedData(sessionID: string) {
    if (input.sessionDataSessionID() === sessionID) return
    const cached = input.selectedData()[sessionID]
    if (!cached) return
    input.presentation.touch(sessionID)
    input.setSessionData(cached.data)
    input.setSessionDataSessionID(sessionID)
    input.setLoadedTime(cached.loadedTime)
  }

  function setVisibleSessionIDs(sessionIDs: string[]) {
    const visible = new Set(sessionIDs)
    if (viewBatch && [...viewBatch.sessionIDs].some((sessionID) => !visible.has(sessionID)))
      viewBatch.controller.abort()
    sessionLoadPromises.forEach((_, sessionID) => {
      if (visible.has(sessionID)) return
      sessionLoadPromises.delete(sessionID)
      input.setViewLoading(sessionID, false)
    })
    input.evictPresentation(input.presentation.setVisible(sessionIDs))
  }

  async function syncViewSessions(sessions: Session[], focusedSessionID: string) {
    setVisibleSessionIDs(sessions.map((session) => session.id))
    viewBatch?.controller.abort()
    const batch = { sessionIDs: new Set(sessions.map((session) => session.id)), controller: new AbortController() }
    viewBatch = batch
    try {
      const failures = await syncViewSessionsInParallel(
        sessions,
        focusedSessionID,
        syncViewSession,
        batch.controller.signal,
      )
      failures.forEach((failure) => console.error(`Failed to synchronize view pane ${failure.sessionID}`, failure.cause))
    } finally {
      if (viewBatch === batch) viewBatch = undefined
    }
  }

  return {
    loadSessionTranscript,
    syncSession,
    syncViewSession,
    syncViewSessions,
    loadOlderSessionMessages,
    loadOlderViewSessionMessages,
    collapseSessionMessageWindow,
    collapseViewSessionMessageWindow,
    setVisibleSessionIDs,
  }
}

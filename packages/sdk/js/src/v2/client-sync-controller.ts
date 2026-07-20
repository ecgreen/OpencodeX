import type { Event, OpencodeXSessionCardPage, OpencodeXStateSnapshot, OpencodeXStateStreamFrame } from "./client.js"
import {
  applyClientSessionEvent,
  clearClientSessionEventBuffers,
  createClientSessionEventBuffers,
  drainClientSessionEventBuffer,
} from "./client-sync-events.js"
import {
  applyClientOperationsSnapshot,
  applyClientSessionCardPage,
  applyClientSessionSnapshot,
  applyClientStateEvent,
  applyClientStateSnapshot,
  clientStateSyncError,
  emptyClientStateSyncState,
  normalizeClientStateSyncLoading,
  reconcileValue,
  releaseClientSessionState,
  sameClientStateScope,
  setClientSessionLoadState,
} from "./client-sync-state.js"
import { clientEventInvalidation, clientStateSyncTransport, decodeClientStateFrame } from "./client-sync-transport.js"
import type {
  ClientStateSyncController,
  ClientStateSyncMetrics,
  ClientStateSyncOptions,
  ClientStateSyncState,
  ClientEnsureSessionCardsOptions,
  ClientSessionCardPageOptions,
  ClientSessionPageOptions,
  ClientSessionTailOptions,
} from "./client-sync-types.js"
import { isClientSessionRenderable } from "./client-sync-cards.js"

export function createClientStateSync(options: ClientStateSyncOptions): ClientStateSyncController {
  const transport = options.transport ?? clientStateSyncTransport(options)
  const listeners = new Set<(state: ClientStateSyncState) => void>()
  const queuedFrames = new Array<{ generation: number; frame: OpencodeXStateStreamFrame }>()
  const sessionTailOptions = new Map<string, ClientSessionTailOptions>()
  const sessionRequests = new Map<string, ClientSessionRequest>()
  const cardRequests = new Set<ClientCardRequest>()
  const rootCardRequests = new Set<number>()
  const exactCardRequestGenerations = new Map<string, number>()
  const deletedSessionGenerations = new Map<string, number>()
  const sessionCardGenerations = new Map<string, number>()
  const sessionRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const sessionEventBuffers = createClientSessionEventBuffers()
  const seenEventIDs = new Set<string>()
  const seenEventIDOrder = new Array<string>()
  let state = emptyClientStateSyncState()
  let stopped = true
  let connection: AbortController | undefined
  let connectionGeneration = 0
  let catalogRequestID = 0
  let operationsRequestID = 0
  let sessionRequestGeneration = 0
  let sessionDeletionGeneration = 0
  let sessionCardGeneration = 0
  let cardRequestGeneration = 0
  let paginationGeneration = 0
  let paginationRequest: Promise<OpencodeXSessionCardPage> | undefined
  let rootRefresh: Promise<void> | undefined
  let rootRefreshQueued = false
  let operationsRefresh: Promise<void> | undefined
  let operationsRefreshQueued = false
  let capabilityRefresh: Promise<void> | undefined
  let capabilityRefreshQueued = false
  let batchTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectAttempt = 0
  const metrics: ClientStateSyncMetrics = {
    commits: 0,
    rootSnapshots: 0,
    operationsSnapshots: 0,
    sessionSnapshots: 0,
    sessionCardPages: 0,
    sessionCardResolutions: 0,
    streamConnections: 0,
    streamFrames: 0,
    batches: 0,
    reconnects: 0,
    resets: 0,
    liveEvents: 0,
    liveEventDuplicates: 0,
    sessionInvalidations: 0,
    sessionCorrectionsCoalesced: 0,
    capabilitySnapshots: 0,
    capabilityRefreshesCoalesced: 0,
    operationsRefreshesCoalesced: 0,
    retryActions: 0,
    retainedSessionDetails: 0,
    retainedSessionLoads: 0,
    sessionTailOptions: 0,
    activeSessionRequests: 0,
    activeCardRequests: 0,
    sessionRefreshTimers: 0,
    bufferedSessionEvents: 0,
    queuedFrames: 0,
  }

  const notify = () => listeners.forEach((listener) => listener(state))
  const commit = (next: ClientStateSyncState) => {
    if (next === state) return
    state = next
    metrics.commits += 1
    notify()
  }
  function withoutStaleSessionCards(snapshot: OpencodeXStateSnapshot, requestGeneration: number) {
    const page = withoutStaleSessionsFromCardPage(snapshot.payloads.catalog.sessionCards, requestGeneration)
    if (page === snapshot.payloads.catalog.sessionCards) return snapshot
    return {
      ...snapshot,
      payloads: {
        ...snapshot.payloads,
        catalog: { ...snapshot.payloads.catalog, sessionCards: page },
      },
    }
  }
  function withoutStaleSessionsFromCardPage(page: OpencodeXSessionCardPage, requestGeneration: number) {
    const blocked = page.items.filter((item) => {
      const generation = sessionCardGenerations.get(item.id)
      return generation !== undefined && generation > requestGeneration
    })
    const missing = page.missing.filter((sessionID) => {
      const generation = sessionCardGenerations.get(sessionID)
      return generation === undefined || generation <= requestGeneration || state.tombstones.sessions[sessionID]
    })
    if (blocked.length === 0 && missing.length === page.missing.length) return page
    const blockedIDs = new Set(blocked.map((item) => item.id))
    const retainedMissing = new Set([
      ...missing,
      ...blocked.filter((item) => state.tombstones.sessions[item.id]).map((item) => item.id),
    ])
    const removed = new Set([...retainedMissing, ...blockedIDs])
    return {
      ...page,
      items: page.items.filter((item) => !removed.has(item.id)),
      missing: [...retainedMissing],
      sessionUiState: Object.fromEntries(
        Object.entries(page.sessionUiState).filter(([sessionID]) => !removed.has(sessionID)),
      ),
    }
  }
  function withoutSupersededExactCardResults(page: OpencodeXSessionCardPage, request: ClientCardRequest) {
    if (request.pagination || !request.sessionIDs) return page
    const current = new Set(
      request.sessionIDs.filter((sessionID) => exactCardRequestGenerations.get(sessionID) === request.generation),
    )
    if (current.size === request.sessionIDs.length) return page
    return {
      ...page,
      items: page.items.filter((item) => current.has(item.id)),
      missing: page.missing.filter((sessionID) => current.has(sessionID)),
      sessionUiState: Object.fromEntries(
        Object.entries(page.sessionUiState).filter(([sessionID]) => current.has(sessionID)),
      ),
    }
  }
  function clearExactCardRequest(request: ClientCardRequest) {
    if (request.pagination) return
    request.sessionIDs?.forEach((sessionID) => {
      if (exactCardRequestGenerations.get(sessionID) === request.generation)
        exactCardRequestGenerations.delete(sessionID)
    })
  }
  function clearSettledDeletionGenerations() {
    deletedSessionGenerations.forEach((_generation, sessionID) => {
      if (state.tombstones.sessions[sessionID]) return
      if ([...sessionRequests.values()].some((request) => request.sessionID === sessionID)) return
      deletedSessionGenerations.delete(sessionID)
    })
  }
  function markSessionCardBoundary(sessionID: string) {
    const generation = ++sessionCardGeneration
    sessionCardGenerations.set(sessionID, generation)
    return generation
  }
  function markSessionCardPage(page: OpencodeXSessionCardPage, generation: number) {
    new Set([...page.items.map((item) => item.id), ...page.missing]).forEach((sessionID) => {
      if ((sessionCardGenerations.get(sessionID) ?? 0) <= generation) sessionCardGenerations.set(sessionID, generation)
    })
  }
  function clearSettledSessionCardGenerations() {
    sessionCardGenerations.forEach((generation, sessionID) => {
      if (state.tombstones.sessions[sessionID]) return
      if ([...rootCardRequests].some((requestGeneration) => requestGeneration < generation)) return
      if ([...cardRequests].some((request) => request.cardGeneration < generation)) return
      sessionCardGenerations.delete(sessionID)
    })
  }
  const refresh = () => {
    rootRefreshQueued = true
    if (rootRefresh) return rootRefresh
    rootRefresh = (async () => {
      while (rootRefreshQueued) {
        if (stopped) break
        rootRefreshQueued = false
        const requestID = ++catalogRequestID
        const cardGeneration = ++sessionCardGeneration
        rootCardRequests.add(cardGeneration)
        metrics.rootSnapshots += 1
        const snapshot = await transport.snapshot().then(
          (value) => value,
          (error) => {
            rootCardRequests.delete(cardGeneration)
            clearSettledSessionCardGenerations()
            throw error
          },
        )
        if (requestID !== catalogRequestID || stopped) {
          rootCardRequests.delete(cardGeneration)
          clearSettledSessionCardGenerations()
          continue
        }
        const next = withoutStaleSessionCards(snapshot, cardGeneration)
        resetPaginationLane()
        markSessionCardPage(next.payloads.catalog.sessionCards, cardGeneration)
        commit(applyClientStateSnapshot(state, next))
        rootCardRequests.delete(cardGeneration)
        clearSettledDeletionGenerations()
        clearSettledSessionCardGenerations()
      }
    })().finally(() => {
      rootRefresh = undefined
    })
    return rootRefresh
  }
  const refreshCapabilities = () => {
    if (!transport.capabilities) return Promise.resolve()
    if (capabilityRefreshQueued || capabilityRefresh) metrics.capabilityRefreshesCoalesced += 1
    capabilityRefreshQueued = true
    if (capabilityRefresh) return capabilityRefresh
    capabilityRefresh = (async () => {
      while (capabilityRefreshQueued) {
        if (stopped) break
        capabilityRefreshQueued = false
        metrics.capabilitySnapshots += 1
        const capabilities = await transport.capabilities?.()
        if (!capabilities || stopped) continue
        commit({
          ...state,
          capabilities: reconcileValue(state.capabilities, capabilities),
          dirtyCapabilities: false,
        })
      }
    })().finally(() => {
      capabilityRefresh = undefined
    })
    return capabilityRefresh
  }
  const refreshOperations = () => {
    if (!transport.operations) return refresh()
    if (operationsRefreshQueued || operationsRefresh) metrics.operationsRefreshesCoalesced += 1
    operationsRefreshQueued = true
    if (operationsRefresh) return operationsRefresh
    operationsRefresh = (async () => {
      while (operationsRefreshQueued) {
        if (stopped) break
        operationsRefreshQueued = false
        metrics.operationsSnapshots += 1
        const requestID = ++operationsRequestID
        const snapshot = await transport.operations?.()
        if (!snapshot || requestID !== operationsRequestID || stopped) continue
        if (
          state.phase !== "ready" ||
          state.epoch !== snapshot.epoch ||
          !sameClientStateScope(state.scope, snapshot.scope)
        ) {
          await refresh()
          continue
        }
        commit(applyClientOperationsSnapshot(state, snapshot))
      }
    })().finally(() => {
      operationsRefresh = undefined
    })
    return operationsRefresh
  }
  const fetchCards = (
    input: ClientSessionCardPageOptions & { sessionIDs?: string[] },
    pagination: boolean,
    laneGeneration?: number,
  ) => {
    if (!transport.cards) return Promise.reject(new Error("Session-card transport is unavailable"))
    if (input.signal?.aborted) return Promise.reject(sessionRequestAbortError(input.signal))
    const controller = new AbortController()
    const abort = () => controller.abort(input.signal?.reason)
    input.signal?.addEventListener("abort", abort, { once: true })
    const request = {
      generation: ++cardRequestGeneration,
      cardGeneration: ++sessionCardGeneration,
      pagination,
      laneGeneration,
      sessionIDs: input.sessionIDs,
      activeSessionIDs: input.sessionIDs ? new Set(input.sessionIDs) : undefined,
      controller,
      detachSignal: input.signal ? () => input.signal?.removeEventListener("abort", abort) : undefined,
    }
    if (!pagination)
      request.sessionIDs?.forEach((sessionID) => exactCardRequestGenerations.set(sessionID, request.generation))
    cardRequests.add(request)
    if (pagination) commit({ ...state, sessionCards: { ...state.sessionCards, loading: true, error: undefined } })
    return transport
      .cards({
        cursor: input.cursor,
        limit: input.limit,
        sessionIDs: input.sessionIDs,
        signal: controller.signal,
      })
      .then(
        (page) => {
          if (controller.signal.aborted || stopped || !cardRequests.has(request)) {
            if (pagination && request.laneGeneration === paginationGeneration && !stopped)
              commit({ ...state, sessionCards: { ...state.sessionCards, loading: false } })
            throw sessionRequestAbortError(controller.signal)
          }
          const superseded =
            !pagination &&
            request.sessionIDs?.some(
              (sessionID) =>
                exactCardRequestGenerations.get(sessionID) !== request.generation ||
                (sessionCardGenerations.get(sessionID) ?? 0) > request.cardGeneration,
            )
          const next = withoutStaleSessionsFromCardPage(
            withoutSupersededExactCardResults(page, request),
            request.cardGeneration,
          )
          if (!pagination || request.laneGeneration === paginationGeneration) {
            markSessionCardPage(next, request.cardGeneration)
            commit(applyClientSessionCardPage(state, next, { pagination }))
          }
          if (!pagination) next.missing.forEach(invalidateDeletedSession)
          if (superseded) throw staleSessionRequestError()
          return next
        },
        (error) => {
          if (controller.signal.aborted || !cardRequests.has(request)) {
            if (pagination && request.laneGeneration === paginationGeneration && !stopped)
              commit({ ...state, sessionCards: { ...state.sessionCards, loading: false } })
            throw sessionRequestAbortError(controller.signal)
          }
          if (pagination && request.laneGeneration === paginationGeneration && !stopped)
            commit({
              ...state,
              sessionCards: { ...state.sessionCards, loading: false, error: clientStateSyncError(error) },
            })
          throw error
        },
      )
      .finally(() => {
        request.detachSignal?.()
        cardRequests.delete(request)
        clearExactCardRequest(request)
        clearSettledDeletionGenerations()
        clearSettledSessionCardGenerations()
      })
  }
  const loadSessionCards = (input: ClientSessionCardPageOptions = {}) => {
    if (paginationRequest) return paginationRequest
    metrics.sessionCardPages += 1
    const generation = ++paginationGeneration
    const request = fetchCards({ ...input, cursor: input.cursor ?? state.sessionCards.next }, true, generation)
    paginationRequest = request.finally(() => {
      if (generation === paginationGeneration) paginationRequest = undefined
    })
    return paginationRequest
  }
  const ensureSessionCards = async (sessionIDs: readonly string[], input: ClientEnsureSessionCardsOptions = {}) => {
    const missing = [...new Set(sessionIDs)].filter((sessionID) => !state.sessions.records[sessionID])
    if (missing.length === 0) return undefined
    const pages: OpencodeXSessionCardPage[] = []
    for (let index = 0; index < missing.length; index += 200) {
      metrics.sessionCardResolutions += 1
      pages.push(await fetchCards({ sessionIDs: missing.slice(index, index + 200), signal: input.signal }, false))
    }
    return {
      items: pages.flatMap((page) => page.items),
      hasMore: false,
      missing: pages.flatMap((page) => page.missing),
      sessionUiState: Object.assign({}, ...pages.map((page) => page.sessionUiState)),
    }
  }
  const beginSessionRequest = (
    sessionID: string,
    kind: ClientSessionRequest["kind"],
    cursor?: string,
    signal?: AbortSignal,
  ) => {
    const key = JSON.stringify([sessionID, kind, cursor ?? null])
    const previous = sessionRequests.get(key)
    previous?.controller.abort()
    previous?.detachSignal?.()
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
    const request = {
      key,
      sessionID,
      kind,
      cursor,
      generation: ++sessionRequestGeneration,
      deletionGeneration: deletedSessionGenerations.get(sessionID) ?? 0,
      revision: state.sessionDetails[sessionID]?.revision,
      controller,
      detachSignal: signal ? () => signal.removeEventListener("abort", abort) : undefined,
    }
    sessionRequests.set(key, request)
    return request
  }
  const isCurrentSessionRequest = (request: ClientSessionRequest) =>
    !stopped &&
    sessionRequests.get(request.key)?.generation === request.generation &&
    (deletedSessionGenerations.get(request.sessionID) ?? 0) === request.deletionGeneration
  const finishSessionRequest = (request: ClientSessionRequest) => {
    if (sessionRequests.get(request.key)?.generation !== request.generation) return
    request.detachSignal?.()
    sessionRequests.delete(request.key)
    clearSettledDeletionGenerations()
  }
  const hasSessionRequest = (sessionID: string, kind: ClientSessionRequest["kind"]) =>
    [...sessionRequests.values()].some((request) => request.sessionID === sessionID && request.kind === kind)
  const abortSessionRequests = (sessionID?: string, cleanup = true) => {
    sessionRequests.forEach((request, key) => {
      if (sessionID !== undefined && request.sessionID !== sessionID) return
      request.controller.abort()
      request.detachSignal?.()
      sessionRequests.delete(key)
    })
    if (cleanup) clearSettledDeletionGenerations()
  }
  const abortCardRequests = (sessionID?: string) => {
    cardRequests.forEach((request) => {
      if (sessionID !== undefined && !request.sessionIDs?.includes(sessionID)) return
      if (sessionID !== undefined && request.sessionIDs && request.sessionIDs.length > 1) {
        request.activeSessionIDs?.delete(sessionID)
        if (exactCardRequestGenerations.get(sessionID) === request.generation)
          exactCardRequestGenerations.delete(sessionID)
        if (request.activeSessionIDs?.size) return
      }
      request.controller.abort()
      request.detachSignal?.()
      cardRequests.delete(request)
      clearExactCardRequest(request)
    })
    if (sessionID !== undefined) return
    paginationGeneration += 1
    paginationRequest = undefined
  }
  const resetPaginationLane = () => {
    paginationGeneration += 1
    cardRequests.forEach((request) => {
      if (!request.pagination) return
      request.controller.abort()
      request.detachSignal?.()
      cardRequests.delete(request)
    })
    paginationRequest = undefined
  }
  const clearSessionRefreshTimer = (sessionID: string) => {
    const refreshTimer = sessionRefreshTimers.get(sessionID)
    if (refreshTimer !== undefined) clearTimeout(refreshTimer)
    sessionRefreshTimers.delete(sessionID)
  }
  const refreshSessionTail = (sessionID: string, input: ClientSessionTailOptions = {}) => {
    if (input.signal?.aborted) return Promise.reject(sessionRequestAbortError(input.signal))
    if (state.tombstones.sessions[sessionID] && deletedSessionGenerations.has(sessionID))
      return Promise.reject(staleSessionRequestError())
    clearSessionRefreshTimer(sessionID)
    const tailOptions = input.limit === undefined ? {} : { limit: input.limit }
    sessionTailOptions.set(sessionID, tailOptions)
    const request = beginSessionRequest(sessionID, "tail", undefined, input.signal)
    commit(setClientSessionLoadState(state, sessionID, "initial", "loading"))
    metrics.sessionSnapshots += 1
    return transport.session({ sessionID, ...tailOptions, signal: request.controller.signal }).then(
      (snapshot) => {
        if (sessionRequests.get(request.key)?.generation === request.generation && request.controller.signal.aborted) {
          finishSessionRequest(request)
          commit(resetClientSessionLoadAfterAbort(state, sessionID, "initial"))
          throw sessionRequestAbortError(request.controller.signal)
        }
        if (!isCurrentSessionRequest(request)) throw staleSessionRequestError()
        finishSessionRequest(request)
        if (request.revision !== undefined && state.sessionDetails[sessionID]?.revision !== request.revision) {
          commit(setClientSessionLoadState(state, sessionID, "initial", "ready"))
          scheduleSessionRefresh(sessionID)
          return snapshot
        }
        commit(
          setClientSessionLoadState(
            drainClientSessionEventBuffer(applyClientSessionSnapshot(state, snapshot), sessionID, sessionEventBuffers),
            sessionID,
            "initial",
            "ready",
          ),
        )
        return snapshot
      },
      (error) => {
        if (sessionRequests.get(request.key)?.generation === request.generation) {
          const aborted = request.controller.signal.aborted
          finishSessionRequest(request)
          commit(
            aborted
              ? resetClientSessionLoadAfterAbort(state, sessionID, "initial")
              : setClientSessionLoadState(state, sessionID, "initial", "error", clientStateSyncError(error)),
          )
          if (aborted) throw sessionRequestAbortError(request.controller.signal)
        }
        if (request.controller.signal.aborted) throw sessionRequestAbortError(request.controller.signal)
        throw error
      },
    )
  }
  const loadOlderSessionPage = (sessionID: string, input: ClientSessionPageOptions & { before: string }) => {
    if (input.signal?.aborted) return Promise.reject(sessionRequestAbortError(input.signal))
    if (state.tombstones.sessions[sessionID] && deletedSessionGenerations.has(sessionID))
      return Promise.reject(staleSessionRequestError())
    if (hasSessionRequest(sessionID, "older"))
      return Promise.reject(new Error(`An older-page mutation is already active for ${sessionID}`))
    const request = beginSessionRequest(sessionID, "older", input.before, input.signal)
    commit(setClientSessionLoadState(state, sessionID, "older", "loading"))
    metrics.sessionSnapshots += 1
    return transport.session({ sessionID, ...input, signal: request.controller.signal }).then(
      (snapshot) => {
        if (sessionRequests.get(request.key)?.generation === request.generation && request.controller.signal.aborted) {
          finishSessionRequest(request)
          commit(resetClientSessionLoadAfterAbort(state, sessionID, "older", hasSessionRequest(sessionID, "older")))
          throw sessionRequestAbortError(request.controller.signal)
        }
        if (!isCurrentSessionRequest(request)) throw staleSessionRequestError()
        finishSessionRequest(request)
        commit(
          setClientSessionLoadState(
            drainClientSessionEventBuffer(
              applyClientSessionSnapshot(state, snapshot, { prepend: true }),
              sessionID,
              sessionEventBuffers,
            ),
            sessionID,
            "older",
            hasSessionRequest(sessionID, "older") ? "loading" : "idle",
          ),
        )
        return snapshot
      },
      (error) => {
        if (sessionRequests.get(request.key)?.generation === request.generation) {
          const aborted = request.controller.signal.aborted
          finishSessionRequest(request)
          const loading = hasSessionRequest(sessionID, "older")
          commit(
            aborted
              ? resetClientSessionLoadAfterAbort(state, sessionID, "older", loading)
              : setClientSessionLoadState(
                  state,
                  sessionID,
                  "older",
                  loading ? "loading" : "error",
                  loading ? undefined : clientStateSyncError(error),
                ),
          )
          if (aborted) throw sessionRequestAbortError(request.controller.signal)
        }
        if (request.controller.signal.aborted) throw sessionRequestAbortError(request.controller.signal)
        throw error
      },
    )
  }
  const fetchSessionPage = (sessionID: string, input: ClientSessionPageOptions = {}) => {
    if (input.signal?.aborted) return Promise.reject(sessionRequestAbortError(input.signal))
    if (state.tombstones.sessions[sessionID] && deletedSessionGenerations.has(sessionID))
      return Promise.reject(staleSessionRequestError())
    const request = beginSessionRequest(sessionID, "fetch", input.before, input.signal)
    metrics.sessionSnapshots += 1
    return transport.session({ sessionID, ...input, signal: request.controller.signal }).then(
      (snapshot) => {
        if (sessionRequests.get(request.key)?.generation === request.generation && request.controller.signal.aborted) {
          finishSessionRequest(request)
          throw sessionRequestAbortError(request.controller.signal)
        }
        if (!isCurrentSessionRequest(request)) throw staleSessionRequestError()
        finishSessionRequest(request)
        return snapshot
      },
      (error) => {
        const aborted = request.controller.signal.aborted
        finishSessionRequest(request)
        if (aborted) throw sessionRequestAbortError(request.controller.signal)
        throw error
      },
    )
  }
  const releaseSession = (sessionID: string) => {
    abortSessionRequests(sessionID)
    abortCardRequests(sessionID)
    clearSessionRefreshTimer(sessionID)
    sessionTailOptions.delete(sessionID)
    clearClientSessionEventBuffers(sessionEventBuffers, sessionID)
    commit(releaseClientSessionState(state, sessionID))
  }
  const invalidateDeletedSession = (sessionID: string) => {
    deletedSessionGenerations.set(sessionID, ++sessionDeletionGeneration)
    markSessionCardBoundary(sessionID)
    catalogRequestID += 1
    if (rootRefresh) rootRefreshQueued = true
    abortSessionRequests(sessionID, false)
    abortCardRequests(sessionID)
    clearSessionRefreshTimer(sessionID)
    sessionTailOptions.delete(sessionID)
    clearClientSessionEventBuffers(sessionEventBuffers, sessionID)
  }
  const scheduleSessionRefresh = (sessionID: string) => {
    metrics.sessionInvalidations += 1
    const current = sessionRefreshTimers.get(sessionID)
    if (current !== undefined) {
      metrics.sessionCorrectionsCoalesced += 1
      clearTimeout(current)
    }
    sessionRefreshTimers.set(
      sessionID,
      setTimeout(() => {
        sessionRefreshTimers.delete(sessionID)
        if (stopped || !state.sessionDetails[sessionID]) return
        void refreshSessionTail(sessionID, sessionTailOptions.get(sessionID)).catch(() => undefined)
      }, options.sessionRefreshDelayMs ?? 500),
    )
  }
  const reloadDirty = (
    catalog: boolean,
    operations: boolean,
    capabilities: boolean,
    sessions: string[],
    catalogSessions: string[],
  ) => {
    if (catalog)
      void refresh()
        .then(async () => {
          if (!transport.cards || catalogSessions.length === 0) return
          for (let index = 0; index < catalogSessions.length; index += 200) {
            await fetchCards({ sessionIDs: catalogSessions.slice(index, index + 200) }, false)
          }
        })
        .catch((error) => {
          if (
            error instanceof Error &&
            error.name === "AbortError" &&
            error.message === "Session request was superseded or released"
          )
            return
          fail(error)
        })
    if (!catalog && operations) void refreshOperations().catch(fail)
    if (capabilities) void refreshCapabilities().catch(fail)
    sessions.forEach((sessionID) => {
      if (!state.sessionDetails[sessionID]) return
      scheduleSessionRefresh(sessionID)
    })
  }
  const flush = () => {
    batchTimer = undefined
    if (queuedFrames.length === 0) return
    const frames = queuedFrames
      .splice(0)
      .filter((item) => item.generation === connectionGeneration)
      .map((item) => item.frame)
    if (frames.length === 0) return
    metrics.batches += 1
    let next = state
    let reset = false
    let catalog = false
    let operations = false
    let capabilities = false
    const sessions = new Set<string>()
    const catalogSessions = new Set<string>()
    for (const frame of frames) {
      if (frame.type === "ready") continue
      if (frame.type === "reset_required") {
        reset = true
        continue
      }
      const result = applyClientStateEvent(next, frame.event)
      const changed = result.state !== next
      next = result.state
      if (result.gap) reset = true
      if (changed && frame.event.domain === "catalog") {
        catalog = true
        if (frame.event.payload.eventType.startsWith("session.")) {
          const sessionID = frame.event.payload.aggregateID
          if (frame.event.payload.eventType === "session.deleted") {
            invalidateDeletedSession(sessionID)
            next = applyClientSessionCardPage(next, {
              items: [],
              hasMore: false,
              missing: [sessionID],
              sessionUiState: {},
            })
          }
          if (frame.event.payload.eventType !== "session.deleted") {
            markSessionCardBoundary(sessionID)
            catalogSessions.add(sessionID)
          }
        }
      }
      if (changed && frame.event.domain === "operations") operations = true
      if (changed && frame.event.domain === "capabilities") capabilities = true
      if (changed && frame.event.domain === "session") sessions.add(frame.event.payload.aggregateID)
    }
    commit(next)
    clearSettledDeletionGenerations()
    clearSettledSessionCardGenerations()
    if (reset) {
      void resetState().catch(fail)
      return
    }
    reloadDirty(catalog, operations, capabilities, [...sessions], [...catalogSessions])
  }
  const queue = (generation: number, frame: OpencodeXStateStreamFrame) => {
    if (generation !== connectionGeneration) return
    queuedFrames.push({ generation, frame })
    if (batchTimer !== undefined) return
    batchTimer = setTimeout(flush, options.batchMs ?? 16)
  }
  const connect = async () => {
    const hasAuthoritativeData = state.phase === "ready"
    commit({
      ...state,
      lifecycle: {
        status: hasAuthoritativeData ? "reconnecting" : "bootstrapping",
        data: hasAuthoritativeData ? "stale" : "empty",
        attempt: reconnectAttempt,
        error: state.error,
      },
    })
    const generation = ++connectionGeneration
    connection?.abort()
    const controller = new AbortController()
    connection = controller
    metrics.streamConnections += 1
    const stream = await transport.events({ after: state.cursor, signal: controller.signal })
    const iterator = stream[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (generation !== connectionGeneration || stopped) return
    if (first.done) throw new Error("State stream ended before ready")
    metrics.streamFrames += 1
    const ready = decodeClientStateFrame(first.value)
    if (ready.type !== "ready") throw new Error("State stream did not begin with ready")
    reconnectAttempt = 0
    const buffered = new Array<OpencodeXStateStreamFrame>()
    let bootstrapping = state.phase !== "ready"
    const consume = async () => {
      for await (const input of { [Symbol.asyncIterator]: () => iterator }) {
        if (generation !== connectionGeneration || stopped) return
        metrics.streamFrames += 1
        const frame = decodeClientStateFrame(input)
        if (bootstrapping) buffered.push(frame)
        else queue(generation, frame)
      }
    }
    const consuming = consume()
    void consuming.catch(() => undefined)
    if (bootstrapping) {
      await refresh()
      if (generation !== connectionGeneration || stopped) return
      buffered.forEach((frame) => queue(generation, frame))
      bootstrapping = false
    }
    commit({
      ...state,
      lifecycle: {
        status: "connected",
        data: "current",
        attempt: 0,
        connectedAt: (options.clock ?? Date.now)(),
      },
      error: undefined,
    })
    void consuming.then(
      () => reconnect(generation, new Error("State stream ended")),
      (error) => reconnect(generation, error),
    )
  }
  const reconnect = (generation: number, cause?: unknown) => {
    if (stopped || generation !== connectionGeneration || reconnectTimer !== undefined) return
    reconnectAttempt += 1
    const exponential = Math.min(
      options.reconnectMaxDelayMs ?? 30_000,
      (options.reconnectDelayMs ?? 500) * 2 ** Math.min(reconnectAttempt - 1, 30),
    )
    const jitter = 0.8 + Math.min(1, Math.max(0, (options.reconnectJitter ?? Math.random)())) * 0.4
    const delay = Math.round(exponential * jitter)
    const error = cause === undefined ? state.error : clientStateSyncError(cause)
    metrics.reconnects += 1
    commit({
      ...state,
      lifecycle: {
        status: "reconnecting",
        data: state.epoch ? "stale" : "empty",
        attempt: reconnectAttempt,
        retryAt: (options.clock ?? Date.now)() + delay,
        error,
      },
      error,
    })
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void connect().catch((error) => {
        fail(error)
        reconnect(connectionGeneration, error)
      })
    }, delay)
  }
  const resetState = async () => {
    const reloadCapabilities = state.capabilities !== undefined
    metrics.resets += 1
    connection?.abort()
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
    reconnectTimer = undefined
    catalogRequestID += 1
    operationsRequestID += 1
    abortSessionRequests()
    abortCardRequests()
    rootCardRequests.clear()
    sessionTailOptions.clear()
    sessionRefreshTimers.forEach((timer) => clearTimeout(timer))
    sessionRefreshTimers.clear()
    clearClientSessionEventBuffers(sessionEventBuffers)
    deletedSessionGenerations.clear()
    sessionCardGenerations.clear()
    seenEventIDs.clear()
    seenEventIDOrder.length = 0
    queuedFrames.length = 0
    commit({
      ...emptyClientStateSyncState(),
      phase: "resetting",
      lifecycle: { status: "resetting", data: "empty", attempt: 0 },
    })
    await Promise.all([connect(), reloadCapabilities ? refreshCapabilities() : Promise.resolve()])
  }
  const fail = (error: unknown) => {
    if (stopped) return
    commit({
      ...state,
      phase: state.phase === "ready" ? "ready" : "error",
      lifecycle: {
        status: "error",
        data: state.epoch ? "stale" : "empty",
        attempt: reconnectAttempt,
        error: clientStateSyncError(error),
      },
      error: clientStateSyncError(error),
    })
  }
  const applyEvents = (events: readonly Event[]) => {
    const handled = new Array<boolean>()
    let next = state
    for (let index = 0; index < events.length; ) {
      const event = events[index]
      if (seenEventIDs.has(event.id)) {
        metrics.liveEventDuplicates += 1
        if (event.type !== "session.deleted") {
          handled.push(true)
          index += 1
          continue
        }
      }
      const group = contiguousDeltaGroup(events, index, seenEventIDs)
      if (
        group.reduced.type === "session.deleted" ||
        ((group.reduced.type === "session.created" || group.reduced.type === "session.updated") &&
          !isClientSessionRenderable(group.reduced.properties.info))
      )
        invalidateDeletedSession(group.reduced.properties.info.id)
      if (
        (group.reduced.type === "session.created" || group.reduced.type === "session.updated") &&
        isClientSessionRenderable(group.reduced.properties.info)
      )
        markSessionCardBoundary(group.reduced.properties.info.id)
      const result = applyClientSessionEvent(next, group.reduced, sessionEventBuffers)
      const invalidation = result.handled ? undefined : clientEventInvalidation(group.reduced)
      if (!result.handled) {
        commit(next)
        next = state
        if (!invalidation || (invalidation === "capabilities" && !transport.capabilities)) {
          handled.push(false)
          index += 1
          continue
        }
      }
      metrics.liveEvents += group.events.length
      group.events.forEach((item) => {
        if (!seenEventIDs.has(item.id)) {
          seenEventIDs.add(item.id)
          seenEventIDOrder.push(item.id)
        }
        handled.push(true)
      })
      while (seenEventIDOrder.length > 2_048) {
        const stale = seenEventIDOrder.shift()
        if (stale) seenEventIDs.delete(stale)
      }
      index += group.events.length
      if (result.handled) {
        next = result.state
        continue
      }
      if (invalidation === "capabilities") {
        commit({ ...state, dirtyCapabilities: true })
        void refreshCapabilities().catch(fail)
      } else if (invalidation === "operations") {
        commit({ ...state, dirtyOperations: true })
        void refreshOperations().catch(fail)
      } else {
        commit({ ...state, dirtyCatalog: true })
        void refresh().catch(fail)
      }
      next = state
    }
    commit(next)
    clearSettledDeletionGenerations()
    clearSettledSessionCardGenerations()
    return handled
  }

  return {
    getState: () => state,
    getMetrics: () => ({
      ...metrics,
      retainedSessionDetails: Object.keys(state.sessionDetails).length,
      retainedSessionLoads: Object.keys(state.sessionLoads).length,
      sessionTailOptions: sessionTailOptions.size,
      activeSessionRequests: sessionRequests.size,
      activeCardRequests: cardRequests.size,
      sessionRefreshTimers: sessionRefreshTimers.size,
      bufferedSessionEvents: sessionEventBuffers.size,
      queuedFrames: queuedFrames.length,
    }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async start() {
      if (!stopped) return
      stopped = false
      commit({
        ...state,
        phase: "bootstrapping",
        lifecycle: { status: "bootstrapping", data: "empty", attempt: 0 },
        error: undefined,
      })
      await connect().catch((error) => {
        fail(error)
        reconnect(connectionGeneration, error)
        throw error
      })
    },
    stop() {
      stopped = true
      connectionGeneration += 1
      connection?.abort()
      catalogRequestID += 1
      operationsRequestID += 1
      rootRefreshQueued = false
      operationsRefreshQueued = false
      capabilityRefreshQueued = false
      abortSessionRequests()
      abortCardRequests()
      rootCardRequests.clear()
      deletedSessionGenerations.clear()
      sessionCardGenerations.clear()
      sessionTailOptions.clear()
      sessionRefreshTimers.forEach((timer) => clearTimeout(timer))
      sessionRefreshTimers.clear()
      clearClientSessionEventBuffers(sessionEventBuffers)
      seenEventIDs.clear()
      seenEventIDOrder.length = 0
      if (batchTimer !== undefined) clearTimeout(batchTimer)
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      batchTimer = undefined
      reconnectTimer = undefined
      reconnectAttempt = 0
      queuedFrames.length = 0
      commit({
        ...normalizeClientStateSyncLoading(state),
        phase: "idle",
        lifecycle: { status: "idle", data: state.epoch ? "current" : "empty", attempt: 0 },
      })
    },
    refresh,
    refreshOperations,
    refreshCapabilities,
    loadSessionCards,
    ensureSessionCards,
    refreshSessionTail,
    loadOlderSessionPage,
    fetchSessionPage,
    releaseSession,
    async retry() {
      if (stopped) return
      metrics.retryActions += 1
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      reconnectTimer = undefined
      await connect().catch((error) => {
        fail(error)
        reconnect(connectionGeneration, error)
        throw error
      })
    },
    applyEvents,
    applyEvent: (event) => applyEvents([event])[0] ?? false,
    async runMutation(key, mutation) {
      commit({
        ...state,
        pendingMutations: { ...state.pendingMutations, [key]: { status: "pending" } },
      })
      return mutation().then(
        (result) => {
          const pendingMutations = { ...state.pendingMutations }
          delete pendingMutations[key]
          commit({ ...state, pendingMutations })
          return result
        },
        (error) => {
          commit({
            ...state,
            pendingMutations: {
              ...state.pendingMutations,
              [key]: { status: "failed", error: error instanceof Error ? error.message : String(error) },
            },
          })
          throw error
        },
      )
    },
  }
}

type PartDeltaEvent = Extract<Event, { type: "message.part.delta" }>

type ClientSessionRequest = {
  key: string
  sessionID: string
  kind: "tail" | "older" | "fetch"
  cursor?: string
  generation: number
  deletionGeneration: number
  revision?: number
  controller: AbortController
  detachSignal?: () => void
}

type ClientCardRequest = {
  generation: number
  cardGeneration: number
  pagination: boolean
  laneGeneration?: number
  sessionIDs?: string[]
  activeSessionIDs?: Set<string>
  controller: AbortController
  detachSignal?: () => void
}

function staleSessionRequestError() {
  const error = new Error("Session request was superseded or released")
  error.name = "AbortError"
  return error
}

function sessionRequestAbortError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error(signal.reason === undefined ? "Session request was aborted" : String(signal.reason))
  error.name = "AbortError"
  return error
}

function resetClientSessionLoadAfterAbort(
  state: ClientStateSyncState,
  sessionID: string,
  kind: "initial" | "older",
  loading = false,
) {
  return setClientSessionLoadState(
    state,
    sessionID,
    kind,
    loading ? "loading" : kind === "initial" && state.sessionDetails[sessionID] ? "ready" : "idle",
  )
}

function contiguousDeltaGroup(events: readonly Event[], start: number, seen: ReadonlySet<string>) {
  const first = events[start]
  if (first.type !== "message.part.delta") return { events: [first], reduced: first }
  const grouped = [first]
  const ids = new Set([first.id])
  for (let index = start + 1; index < events.length; index += 1) {
    const event = events[index]
    if (
      event.type !== "message.part.delta" ||
      seen.has(event.id) ||
      ids.has(event.id) ||
      !sameDeltaTarget(first, event)
    )
      break
    grouped.push(event)
    ids.add(event.id)
  }
  if (grouped.length === 1) return { events: grouped, reduced: first }
  return {
    events: grouped,
    reduced: {
      ...first,
      properties: { ...first.properties, delta: grouped.map((event) => event.properties.delta).join("") },
    },
  }
}

function sameDeltaTarget(left: PartDeltaEvent, right: PartDeltaEvent) {
  return (
    left.properties.sessionID === right.properties.sessionID &&
    left.properties.messageID === right.properties.messageID &&
    left.properties.partID === right.properties.partID &&
    left.properties.field === right.properties.field
  )
}

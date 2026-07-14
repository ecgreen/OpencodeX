import type { OpencodeXStateStreamFrame } from "./client.js"
import {
  applyClientSessionEvent,
  clearClientSessionEventBuffers,
  createClientSessionEventBuffers,
} from "./client-sync-events.js"
import {
  applyClientOperationsSnapshot,
  applyClientSessionSnapshot,
  applyClientStateEvent,
  applyClientStateSnapshot,
  clientStateSyncError,
  emptyClientStateSyncState,
  reconcileValue,
  sameClientStateScope,
  setClientSessionLoadState,
} from "./client-sync-state.js"
import { clientEventInvalidation, clientStateSyncTransport, decodeClientStateFrame } from "./client-sync-transport.js"
import type {
  ClientStateSyncController,
  ClientStateSyncMetrics,
  ClientStateSyncOptions,
  ClientStateSyncState,
} from "./client-sync-types.js"

export function createClientStateSync(options: ClientStateSyncOptions): ClientStateSyncController {
  const transport = options.transport ?? clientStateSyncTransport(options)
  const listeners = new Set<(state: ClientStateSyncState) => void>()
  const queuedFrames = new Array<{ generation: number; frame: OpencodeXStateStreamFrame }>()
  const sessionLoadOptions = new Map<string, { limit?: number; before?: string }>()
  const sessionRequestIDs = new Map<string, number>()
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
  }

  const notify = () => listeners.forEach((listener) => listener(state))
  const commit = (next: ClientStateSyncState) => {
    if (next === state) return
    state = next
    metrics.commits += 1
    notify()
  }
  const refresh = () => {
    rootRefreshQueued = true
    if (rootRefresh) return rootRefresh
    rootRefresh = (async () => {
      while (rootRefreshQueued) {
        if (stopped) break
        rootRefreshQueued = false
        const requestID = ++catalogRequestID
        metrics.rootSnapshots += 1
        const snapshot = await transport.snapshot()
        if (requestID !== catalogRequestID || stopped) continue
        commit(applyClientStateSnapshot(state, snapshot))
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
  const hydrateSession = async (sessionID: string, input: { limit?: number; before?: string } = {}) => {
    const refreshTimer = sessionRefreshTimers.get(sessionID)
    if (refreshTimer !== undefined) clearTimeout(refreshTimer)
    sessionRefreshTimers.delete(sessionID)
    sessionLoadOptions.set(sessionID, input)
    const requestID = (sessionRequestIDs.get(sessionID) ?? 0) + 1
    sessionRequestIDs.set(sessionID, requestID)
    const kind = input.before === undefined ? "initial" : "older"
    commit(setClientSessionLoadState(state, sessionID, kind, "loading"))
    metrics.sessionSnapshots += 1
    return transport.session({ sessionID, ...input }).then(
      (snapshot) => {
        if (sessionRequestIDs.get(sessionID) !== requestID || stopped) return
        commit(
          setClientSessionLoadState(
            applyClientSessionSnapshot(state, snapshot, { prepend: input.before !== undefined }),
            sessionID,
            kind,
            kind === "initial" ? "ready" : "idle",
          ),
        )
      },
      (error) => {
        if (sessionRequestIDs.get(sessionID) === requestID && !stopped)
          commit(setClientSessionLoadState(state, sessionID, kind, "error", clientStateSyncError(error)))
        throw error
      },
    )
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
        void hydrateSession(sessionID, sessionLoadOptions.get(sessionID)).catch(() => undefined)
      }, options.sessionRefreshDelayMs ?? 500),
    )
  }
  const reloadDirty = (catalog: boolean, operations: boolean, capabilities: boolean, sessions: string[]) => {
    if (catalog) void refresh().catch(fail)
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
      if (changed && frame.event.domain === "catalog") catalog = true
      if (changed && frame.event.domain === "operations") operations = true
      if (changed && frame.event.domain === "capabilities") capabilities = true
      if (changed && frame.event.domain === "session") sessions.add(frame.event.payload.aggregateID)
    }
    commit(next)
    if (reset) {
      void resetState().catch(fail)
      return
    }
    reloadDirty(catalog, operations, capabilities, [...sessions])
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
    sessionRequestIDs.clear()
    sessionRefreshTimers.forEach((timer) => clearTimeout(timer))
    sessionRefreshTimers.clear()
    clearClientSessionEventBuffers(sessionEventBuffers)
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

  return {
    getState: () => state,
    getMetrics: () => ({ ...metrics }),
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
      sessionRequestIDs.clear()
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
        ...state,
        phase: "idle",
        lifecycle: { status: "idle", data: state.epoch ? "current" : "empty", attempt: 0 },
      })
    },
    refresh,
    refreshOperations,
    refreshCapabilities,
    hydrateSession,
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
    applyEvent(event) {
      if (seenEventIDs.has(event.id)) {
        metrics.liveEventDuplicates += 1
        return true
      }
      const result = applyClientSessionEvent(state, event, sessionEventBuffers)
      const invalidation = result.handled ? undefined : clientEventInvalidation(event)
      if (!result.handled && !invalidation) return false
      if (invalidation === "capabilities" && !transport.capabilities) return false
      metrics.liveEvents += 1
      seenEventIDs.add(event.id)
      seenEventIDOrder.push(event.id)
      while (seenEventIDOrder.length > 2_048) {
        const stale = seenEventIDOrder.shift()
        if (stale) seenEventIDs.delete(stale)
      }
      if (result.handled) commit(result.state)
      else if (invalidation === "capabilities") {
        commit({ ...state, dirtyCapabilities: true })
        void refreshCapabilities().catch(fail)
      } else if (invalidation === "operations") {
        commit({ ...state, dirtyOperations: true })
        void refreshOperations().catch(fail)
      } else {
        commit({ ...state, dirtyCatalog: true })
        void refresh().catch(fail)
      }
      return true
    },
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

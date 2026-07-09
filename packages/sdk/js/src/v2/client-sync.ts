import type {
  GlobalSession,
  Message,
  OpencodeClient,
  OpencodeXProject,
  OpencodeXSessionSnapshot,
  OpencodeXSessionState,
  OpencodeXSessionSyncResponse,
  OpencodeXSessionSyncSnapshot,
  OpencodeXStateEvent,
  OpencodeXStateScope,
  OpencodeXStateSnapshot,
  OpencodeXStateStreamFrame,
  OpencodeXSessionUiState,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
} from "./client.js"

export const CLIENT_SESSION_SYNC_INTERVAL_MS = 500
export const CLIENT_SESSION_LIST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export type ClientSessionSyncSnapshot = OpencodeXSessionSyncSnapshot

export type ClientSessionSyncQuery = {
  scope?: "project"
  path?: string
  roots?: boolean
  start?: number
  search?: string
  limit?: number
}

export type ClientSessionSyncResult = OpencodeXSessionSyncResponse

export type ClientSessionStateUpdate = {
  seenAt?: number
  reviewedAt?: number
  reviewedFiles?: readonly string[]
}

export type ClientSessionSyncInput = {
  client: OpencodeClient
  directory?: string
  sessionQuery?: ClientSessionSyncQuery
  since?: string
  filterSession?: (session: Session) => boolean
}

export async function loadClientSessionSync(input: ClientSessionSyncInput): Promise<ClientSessionSyncResult> {
  const response = await input.client.opencodex.session.sync(
    {
      directory: input.directory,
      scope: input.sessionQuery?.scope,
      path: input.sessionQuery?.path,
      roots: input.sessionQuery?.roots === undefined ? undefined : input.sessionQuery.roots ? "true" : "false",
      start: String(input.sessionQuery?.start ?? Date.now() - CLIENT_SESSION_LIST_WINDOW_MS),
      search: input.sessionQuery?.search,
      limit: input.sessionQuery?.limit === undefined ? undefined : String(input.sessionQuery.limit),
      since: input.since,
    },
    { throwOnError: true },
  )
  if (!response.data.changed || !input.filterSession) return response.data
  const projects = response.data.snapshot.projects.map((project) => ({
    ...project,
    sessions: project.sessions.filter((session) => input.filterSession?.(session)),
  }))
  return {
    ...response.data,
    snapshot: {
      ...response.data.snapshot,
      projects,
      sessions: mergeClientSessions(response.data.snapshot.sessions, projects, input.filterSession),
    },
  }
}

export async function updateClientSessionState(
  client: OpencodeClient,
  sessionID: string,
  input: ClientSessionStateUpdate,
): Promise<OpencodeXSessionState> {
  return (
    await client.opencodex.sessionState.update(
      {
        sessionID,
        seenAt: input.seenAt,
        reviewedAt: input.reviewedAt,
        reviewedFiles: input.reviewedFiles ? [...input.reviewedFiles] : undefined,
      },
      { throwOnError: true },
    )
  ).data
}

export function mergeClientSessions(
  sessions: readonly (Session | GlobalSession)[],
  projects: readonly OpencodeXProject[],
  filterSession?: (session: Session) => boolean,
): Session[] {
  return Array.from(
    new Map(
      [...sessions, ...projects.flatMap((project) => project.sessions as Session[])]
        .filter((session) => filterSession?.(session) ?? true)
        .map((session): [string, Session] => [session.id, session]),
    ).values(),
  ).sort((a, b) => b.time.updated - a.time.updated)
}

export function isRenderableClientSession(session: Session) {
  if (session.parentID) return true
  if (session.model || session.summary || session.share || session.revert) return true
  const tokens = session.tokens
  if (tokens && tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write > 0)
    return true
  if ((session.cost ?? 0) > 0) return true
  return !isPlaceholderTitle(session.title)
}

function isPlaceholderTitle(title: string) {
  return title === "New session" || /^New session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

export type ClientEntityState<T> = {
  ids: string[]
  records: Record<string, T>
}

export type ClientSessionDetailState = {
  snapshot: OpencodeXSessionSnapshot
  messageIDs: string[]
  messageCoverage: Record<string, "older" | "tail">
  messages: Record<string, Message>
  partIDs: Record<string, string[]>
  parts: Record<string, Part>
}

export type ClientStateSyncState = {
  phase: "idle" | "bootstrapping" | "ready" | "resetting" | "error"
  scope?: OpencodeXStateScope
  epoch?: string
  cursor?: string
  digest?: string
  projects: ClientEntityState<OpencodeXProject>
  sessions: ClientEntityState<Session>
  views: ClientEntityState<OpencodeXSessionSyncSnapshot["views"][number]>
  permissions: ClientEntityState<PermissionRequest>
  questions: ClientEntityState<QuestionRequest>
  sessionStatus: Record<string, SessionStatus>
  sessionUiState: Record<string, OpencodeXSessionUiState>
  sessionDetails: Record<string, ClientSessionDetailState>
  dirtyCatalog: boolean
  dirtySessions: Record<string, true>
  tombstones: {
    sessions: Record<string, true>
    messages: Record<string, true>
    parts: Record<string, true>
  }
  aggregateSequences: Record<string, number>
  pendingMutations: Record<string, { status: "pending" | "failed"; error?: string }>
  error?: string
}

export type ClientStateSyncTransport = {
  snapshot: () => Promise<OpencodeXStateSnapshot>
  session: (input: { sessionID: string; limit?: number; before?: string }) => Promise<OpencodeXSessionSnapshot>
  events: (input: { after?: string; signal: AbortSignal }) => Promise<AsyncIterable<unknown>>
}

export type ClientStateSyncController = {
  getState: () => ClientStateSyncState
  subscribe: (listener: (state: ClientStateSyncState) => void) => () => void
  start: () => Promise<void>
  stop: () => void
  refresh: () => Promise<void>
  hydrateSession: (sessionID: string, input?: { limit?: number; before?: string }) => Promise<void>
  runMutation: <T>(key: string, mutation: () => Promise<T>) => Promise<T>
}

export type ClientStateSyncOptions = {
  client?: OpencodeClient
  transport?: ClientStateSyncTransport
  directory?: string
  workspace?: string
  batchMs?: number
  reconnectDelayMs?: number
}

export function createClientStateSync(options: ClientStateSyncOptions): ClientStateSyncController {
  const transport = options.transport ?? clientStateSyncTransport(options)
  const listeners = new Set<(state: ClientStateSyncState) => void>()
  const queuedFrames = new Array<{ generation: number; frame: OpencodeXStateStreamFrame }>()
  const sessionLoadOptions = new Map<string, { limit?: number; before?: string }>()
  const sessionRequestIDs = new Map<string, number>()
  let state = emptyClientStateSyncState()
  let stopped = true
  let connection: AbortController | undefined
  let connectionGeneration = 0
  let catalogRequestID = 0
  let batchTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined

  const notify = () => listeners.forEach((listener) => listener(state))
  const commit = (next: ClientStateSyncState) => {
    if (next === state) return
    state = next
    notify()
  }
  const refresh = async () => {
    const requestID = ++catalogRequestID
    const snapshot = await transport.snapshot()
    if (requestID !== catalogRequestID || stopped) return
    commit(applyClientStateSnapshot(state, snapshot))
  }
  const hydrateSession = async (sessionID: string, input: { limit?: number; before?: string } = {}) => {
    sessionLoadOptions.set(sessionID, input)
    const requestID = (sessionRequestIDs.get(sessionID) ?? 0) + 1
    sessionRequestIDs.set(sessionID, requestID)
    const snapshot = await transport.session({ sessionID, ...input })
    if (sessionRequestIDs.get(sessionID) !== requestID || stopped) return
    commit(applyClientSessionSnapshot(state, snapshot, { prepend: input.before !== undefined }))
  }
  const reloadDirty = (catalog: boolean, sessions: string[]) => {
    if (catalog) void refresh().catch(fail)
    sessions.forEach((sessionID) => {
      if (!state.sessionDetails[sessionID]) return
      void hydrateSession(sessionID, sessionLoadOptions.get(sessionID)).catch(fail)
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
    let next = state
    let reset = false
    let catalog = false
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
      if (changed) catalog = true
      if (changed && frame.event.domain === "session") sessions.add(frame.event.payload.aggregateID)
    }
    commit(next)
    if (reset) {
      void resetState().catch(fail)
      return
    }
    reloadDirty(catalog, [...sessions])
  }
  const queue = (generation: number, frame: OpencodeXStateStreamFrame) => {
    if (generation !== connectionGeneration) return
    queuedFrames.push({ generation, frame })
    if (batchTimer !== undefined) return
    batchTimer = setTimeout(flush, options.batchMs ?? 16)
  }
  const connect = async () => {
    const generation = ++connectionGeneration
    connection?.abort()
    const controller = new AbortController()
    connection = controller
    const stream = await transport.events({ after: state.cursor, signal: controller.signal })
    const iterator = stream[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (generation !== connectionGeneration || stopped) return
    if (first.done) throw new Error("State stream ended before ready")
    const ready = decodeClientStateFrame(first.value)
    if (ready.type !== "ready") throw new Error("State stream did not begin with ready")
    const buffered = new Array<OpencodeXStateStreamFrame>()
    let bootstrapping = state.phase !== "ready"
    const consume = async () => {
      for await (const input of { [Symbol.asyncIterator]: () => iterator }) {
        if (generation !== connectionGeneration || stopped) return
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
    void consuming.then(
      () => reconnect(generation),
      () => reconnect(generation),
    )
  }
  const reconnect = (generation: number) => {
    if (stopped || generation !== connectionGeneration || reconnectTimer !== undefined) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void connect().catch(() => reconnect(connectionGeneration))
    }, options.reconnectDelayMs ?? 1_000)
  }
  const resetState = async () => {
    connection?.abort()
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
    reconnectTimer = undefined
    catalogRequestID += 1
    sessionRequestIDs.clear()
    queuedFrames.length = 0
    commit({ ...emptyClientStateSyncState(), phase: "resetting" })
    await connect()
  }
  const fail = (error: unknown) => {
    if (stopped) return
    commit({
      ...state,
      phase: state.phase === "ready" ? "ready" : "error",
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async start() {
      if (!stopped) return
      stopped = false
      commit({ ...state, phase: "bootstrapping", error: undefined })
      await connect().catch((error) => {
        fail(error)
        reconnect(connectionGeneration)
        throw error
      })
    },
    stop() {
      stopped = true
      connectionGeneration += 1
      connection?.abort()
      catalogRequestID += 1
      sessionRequestIDs.clear()
      if (batchTimer !== undefined) clearTimeout(batchTimer)
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      batchTimer = undefined
      reconnectTimer = undefined
      queuedFrames.length = 0
      commit({ ...state, phase: "idle" })
    },
    refresh,
    hydrateSession,
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

export function applyClientStateSnapshot(
  current: ClientStateSyncState,
  snapshot: OpencodeXStateSnapshot,
): ClientStateSyncState {
  if (
    current.phase === "ready" &&
    current.digest === snapshot.digest &&
    current.epoch === snapshot.epoch &&
    current.scope &&
    sameClientStateScope(current.scope, snapshot.scope) &&
    !current.dirtyCatalog
  )
    return current
  const reset =
    current.epoch !== undefined &&
    (current.epoch !== snapshot.epoch || !sameClientStateScope(current.scope, snapshot.scope))
  const previous = reset ? emptyClientStateSyncState() : current
  const catalog = snapshot.payloads.catalog
  const projects = reconcileEntities(previous.projects, catalog.projects, (item) => item.id)
  const sessions = reconcileEntities(previous.sessions, catalog.sessions, (item) => item.id)
  const views = reconcileEntities(previous.views, catalog.views, (item) => item.id)
  const permissions = reconcileEntities(previous.permissions, catalog.permissions, (item) => item.id)
  const questions = reconcileEntities(previous.questions, catalog.questions, (item) => item.id)
  const deletedSessionIDs = previous.sessions.ids.filter((id) => !sessions.records[id])
  const sessionTombstones = deletedSessionIDs.reduce(
    (result, id) => ({ ...result, [id]: true as const }),
    withoutRecordKeys(previous.tombstones.sessions, sessions.ids),
  )
  const sessionDetails = Object.fromEntries(
    Object.entries(previous.sessionDetails).filter(([sessionID]) => Boolean(sessions.records[sessionID])),
  )
  return {
    ...previous,
    phase: "ready",
    scope: snapshot.scope,
    epoch: snapshot.epoch,
    cursor: previous.cursor ?? snapshot.cursor,
    digest: snapshot.digest,
    projects,
    sessions,
    views,
    permissions,
    questions,
    sessionStatus: reconcileRecord(previous.sessionStatus, catalog.sessionStatus),
    sessionUiState: reconcileRecord(previous.sessionUiState, catalog.sessionUiState),
    sessionDetails,
    dirtyCatalog: false,
    dirtySessions: Object.fromEntries(
      Object.entries(previous.dirtySessions).filter(([sessionID]) => Boolean(sessions.records[sessionID])),
    ),
    tombstones: {
      ...previous.tombstones,
      sessions: sessionTombstones,
    },
    error: undefined,
  }
}

export function applyClientSessionSnapshot(
  current: ClientStateSyncState,
  snapshot: OpencodeXSessionSnapshot,
  options: { prepend?: boolean } = {},
): ClientStateSyncState {
  if (current.epoch && (current.epoch !== snapshot.epoch || !sameClientStateScope(current.scope, snapshot.scope)))
    return current
  const previous = current.sessionDetails[snapshot.session.id]
  if (previous?.snapshot.digest === snapshot.digest && previous.snapshot.cursor === snapshot.cursor) return current
  const incoming = new Map(snapshot.messages.items.map((item) => [item.info.id, item]))
  const preservedIDs = previous
    ? previous.messageIDs.filter((messageID) => options.prepend || previous.messageCoverage[messageID] === "older")
    : []
  const messageIDs = options.prepend
    ? [...new Set([...snapshot.messages.items.map((item) => item.info.id), ...preservedIDs])]
    : [...new Set([...preservedIDs, ...snapshot.messages.items.map((item) => item.info.id)])]
  const messages = reconcileRecord(
    previous?.messages ?? {},
    Object.fromEntries(
      messageIDs.flatMap((messageID) => {
        const info = incoming.get(messageID)?.info ?? previous?.messages[messageID]
        return info ? [[messageID, info]] : []
      }),
    ),
  )
  const partIDs = reconcileRecord(
    previous?.partIDs ?? {},
    Object.fromEntries(
      messageIDs.map((messageID) => [
        messageID,
        incoming.get(messageID)?.parts.map((part) => part.id) ?? previous?.partIDs[messageID] ?? [],
      ]),
    ),
  )
  const parts = reconcileRecord(
    previous?.parts ?? {},
    Object.fromEntries(
      messageIDs.flatMap((messageID) => {
        const bundle = incoming.get(messageID)
        if (bundle) return bundle.parts.map((part) => [part.id, part] as const)
        return (previous?.partIDs[messageID] ?? []).flatMap((partID) => {
          const part = previous?.parts[partID]
          return part ? [[partID, part] as const] : []
        })
      }),
    ),
  )
  const messageCoverage = Object.fromEntries(
    messageIDs.map((messageID) => [
      messageID,
      incoming.has(messageID)
        ? options.prepend
          ? "older"
          : "tail"
        : (previous?.messageCoverage[messageID] ?? "older"),
    ]),
  ) as Record<string, "older" | "tail">
  const deletedMessageIDs =
    options.prepend || !previous
      ? []
      : previous.messageIDs.filter(
          (messageID) => previous.messageCoverage[messageID] === "tail" && !incoming.has(messageID),
        )
  const deletedPartIDs = previous
    ? [
        ...deletedMessageIDs.flatMap((messageID) => previous.partIDs[messageID] ?? []),
        ...snapshot.messages.items.flatMap((item) => {
          const currentPartIDs = new Set(item.parts.map((part) => part.id))
          return (previous.partIDs[item.info.id] ?? []).filter((partID) => !currentPartIDs.has(partID))
        }),
      ]
    : []
  const dirtySessions = { ...current.dirtySessions }
  delete dirtySessions[snapshot.session.id]
  const liveMessageIDs = Object.keys(messages)
  const livePartIDs = Object.keys(parts)
  return {
    ...current,
    sessionDetails: {
      ...current.sessionDetails,
      [snapshot.session.id]: {
        snapshot: reconcileValue(previous?.snapshot, snapshot),
        messageIDs: equalCanonical(previous?.messageIDs, messageIDs)
          ? (previous?.messageIDs ?? messageIDs)
          : messageIDs,
        messageCoverage: reconcileRecord(previous?.messageCoverage ?? {}, messageCoverage),
        messages,
        partIDs,
        parts,
      },
    },
    dirtySessions,
    tombstones: {
      ...current.tombstones,
      messages: deletedMessageIDs.reduce(
        (result, messageID) => ({ ...result, [messageID]: true as const }),
        withoutRecordKeys(current.tombstones.messages, liveMessageIDs),
      ),
      parts: deletedPartIDs.reduce(
        (result, partID) => ({ ...result, [partID]: true as const }),
        withoutRecordKeys(current.tombstones.parts, livePartIDs),
      ),
    },
  }
}

export function applyClientStateEvent(
  current: ClientStateSyncState,
  event: OpencodeXStateEvent,
): { state: ClientStateSyncState; gap: boolean } {
  if (current.epoch && (current.epoch !== event.epoch || !sameClientStateScope(current.scope, event.scope))) {
    return { state: current, gap: true }
  }
  const previous = current.aggregateSequences[event.payload.aggregateID]
  if (previous !== undefined && event.aggregateSequence <= previous) return { state: current, gap: false }
  if (previous !== undefined && event.aggregateSequence !== previous + 1) return { state: current, gap: true }
  const aggregateSequences = { ...current.aggregateSequences, [event.payload.aggregateID]: event.aggregateSequence }
  switch (event.operation) {
    case "invalidate":
      switch (event.domain) {
        case "catalog":
          return {
            state: { ...current, cursor: event.cursor, aggregateSequences, dirtyCatalog: true },
            gap: false,
          }
        case "session":
          return {
            state: {
              ...current,
              cursor: event.cursor,
              aggregateSequences,
              dirtySessions: { ...current.dirtySessions, [event.payload.aggregateID]: true },
            },
            gap: false,
          }
      }
  }
}

export function selectClientSessionMessages(state: ClientStateSyncState, sessionID: string) {
  const detail = state.sessionDetails[sessionID]
  if (!detail) return []
  return detail.messageIDs.map((messageID) => ({
    info: detail.messages[messageID],
    parts: (detail.partIDs[messageID] ?? []).flatMap((partID) => detail.parts[partID] ?? []),
  }))
}

export function selectClientSessionChildren(state: ClientStateSyncState, sessionID: string) {
  return state.sessions.ids.flatMap((id) => {
    const session = state.sessions.records[id]
    return session?.parentID === sessionID ? [session] : []
  })
}

export function selectClientStateSyncSnapshot(
  state: ClientStateSyncState,
  filterSession?: (session: Session) => boolean,
): ClientSessionSyncSnapshot | undefined {
  if (state.phase !== "ready") return
  const projects = state.projects.ids.flatMap((id) => {
    const project = state.projects.records[id]
    if (!project) return []
    return [
      {
        ...project,
        sessions: project.sessions.filter((session) => filterSession?.(session) ?? true),
      },
    ]
  })
  return {
    projects,
    sessions: mergeClientSessions(
      state.sessions.ids.flatMap((id) => state.sessions.records[id] ?? []),
      projects,
      filterSession,
    ),
    views: state.views.ids.flatMap((id) => state.views.records[id] ?? []),
    permissions: state.permissions.ids.flatMap((id) => state.permissions.records[id] ?? []),
    questions: state.questions.ids.flatMap((id) => state.questions.records[id] ?? []),
    sessionStatus: state.sessionStatus,
    sessionUiState: state.sessionUiState,
  }
}

function clientStateSyncTransport(options: ClientStateSyncOptions): ClientStateSyncTransport {
  if (!options.client) throw new Error("createClientStateSync requires client or transport")
  const client = options.client
  return {
    snapshot: async () =>
      (
        await client.opencodex.state.snapshot(
          { directory: options.directory, workspace: options.workspace },
          { throwOnError: true },
        )
      ).data,
    session: async (input) =>
      (
        await client.opencodex.state.session(
          {
            sessionID: input.sessionID,
            directory: options.directory,
            workspace: options.workspace,
            limit: input.limit === undefined ? undefined : String(input.limit),
            before: input.before,
          },
          { throwOnError: true },
        )
      ).data,
    events: async (input) =>
      (
        await client.opencodex.state.event(
          { directory: options.directory, workspace: options.workspace, after: input.after },
          { signal: input.signal, sseMaxRetryAttempts: 0 },
        )
      ).stream,
  }
}

function decodeClientStateFrame(input: unknown): OpencodeXStateStreamFrame {
  const value = typeof input === "string" ? (JSON.parse(input) as unknown) : input
  if (!value || typeof value !== "object" || !("type" in value)) throw new Error("Invalid state stream frame")
  const type = value.type
  if (type === "ready" || type === "event" || type === "reset_required") return value as OpencodeXStateStreamFrame
  throw new Error("Unknown state stream frame")
}

function emptyClientStateSyncState(): ClientStateSyncState {
  return {
    phase: "idle",
    projects: emptyEntities(),
    sessions: emptyEntities(),
    views: emptyEntities(),
    permissions: emptyEntities(),
    questions: emptyEntities(),
    sessionStatus: {},
    sessionUiState: {},
    sessionDetails: {},
    dirtyCatalog: false,
    dirtySessions: {},
    tombstones: { sessions: {}, messages: {}, parts: {} },
    aggregateSequences: {},
    pendingMutations: {},
  }
}

function emptyEntities<T>(): ClientEntityState<T> {
  return { ids: [], records: {} }
}

function reconcileEntities<T>(current: ClientEntityState<T>, items: readonly T[], id: (item: T) => string) {
  const ids = items.map(id)
  return {
    ids: equalCanonical(current.ids, ids) ? current.ids : ids,
    records: reconcileRecord(current.records, Object.fromEntries(items.map((item) => [id(item), item]))),
  }
}

function reconcileRecord<T>(current: Record<string, T>, next: Record<string, T>) {
  const entries = Object.entries(next).map(([key, value]) => [key, reconcileValue(current[key], value)] as const)
  if (Object.keys(current).length === entries.length && entries.every(([key, value]) => current[key] === value))
    return current
  return Object.fromEntries(entries)
}

function reconcileValue<T>(current: T | undefined, next: T): T {
  return current !== undefined && equalCanonical(current, next) ? current : next
}

function withoutRecordKeys<T>(record: Record<string, T>, keys: readonly string[]) {
  if (keys.length === 0) return record
  const removed = new Set(keys)
  const entries = Object.entries(record).filter(([key]) => !removed.has(key))
  return entries.length === Object.keys(record).length ? record : Object.fromEntries(entries)
}

function equalCanonical(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => equalCanonical(value, right[index]))
  }
  if (typeof left !== "object" || typeof right !== "object") return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => equalCanonical(leftRecord[key], rightRecord[key]))
  )
}

function sameClientStateScope(left: OpencodeXStateScope | undefined, right: OpencodeXStateScope) {
  return Boolean(
    left &&
      left.projectID === right.projectID &&
      left.workspaceID === right.workspaceID &&
      left.directory === right.directory,
  )
}

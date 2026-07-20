import type {
  OpencodeXOperationsSnapshot,
  OpencodeXSessionSnapshot,
  OpencodeXStateEvent,
  OpencodeXStateScope,
  OpencodeXStateSnapshot,
  Session,
} from "./client.js"
import type {
  ClientCatalogSnapshot,
  ClientEntityState,
  ClientSessionLoadState,
  ClientStateSyncState,
} from "./client-sync-types.js"
import { applyClientSessionCardPage } from "./client-sync-cards.js"
export { applyClientSessionCardPage } from "./client-sync-cards.js"

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
    !current.dirtyCatalog &&
    !current.dirtyOperations &&
    current.sessionCards.pages === 1 &&
    !current.sessionCards.loading &&
    current.sessionCards.next === snapshot.payloads.catalog.sessionCards.next &&
    current.sessionCards.hasMore === snapshot.payloads.catalog.sessionCards.hasMore
  )
    return current
  const reset =
    current.epoch !== undefined &&
    (current.epoch !== snapshot.epoch || !sameClientStateScope(current.scope, snapshot.scope))
  const previous = reset ? emptyClientStateSyncState() : current
  const catalog = snapshot.payloads.catalog
  const projects = reconcileEntities(previous.projects, catalog.projects, (item) => item.id)
  const views = reconcileEntities(previous.views, catalog.views, (item) => item.id)
  const paged = applyClientSessionCardPage(previous, catalog.sessionCards, {
    root: true,
  })
  const permissions = reconcileEntities(previous.permissions, catalog.permissions, (item) => item.id)
  const questions = reconcileEntities(previous.questions, catalog.questions, (item) => item.id)
  const jobs = reconcileEntities(previous.jobs, snapshot.payloads.operations.jobs, (item) => item.id)
  const swarms = reconcileEntities(previous.swarms, snapshot.payloads.operations.swarms, (item) => item.id)
  const knownSessionIDs = collectKnownSessionIDs(paged.sessions, projects, views)
  return {
    ...paged,
    phase: "ready",
    scope: snapshot.scope,
    epoch: snapshot.epoch,
    cursor: previous.cursor ?? snapshot.cursor,
    digest: snapshot.digest,
    projects,
    views,
    permissions,
    questions,
    jobs,
    swarms,
    sessionStatus: reconcileRecord(previous.sessionStatus, catalog.sessionStatus),
    sessionUiState: mergeRecord(paged.sessionUiState, catalog.sessionUiState),
    dirtyCatalog: false,
    dirtyOperations: false,
    dirtySessions: Object.fromEntries(
      Object.entries(previous.dirtySessions).filter(([sessionID]) => knownSessionIDs.has(sessionID)),
    ),
    error: undefined,
  }
}

export function applyClientOperationsSnapshot(
  current: ClientStateSyncState,
  snapshot: OpencodeXOperationsSnapshot,
): ClientStateSyncState {
  if (
    current.phase !== "ready" ||
    current.epoch !== snapshot.epoch ||
    !sameClientStateScope(current.scope, snapshot.scope)
  )
    return current
  const jobs = reconcileEntities(current.jobs, snapshot.payload.jobs, (item) => item.id)
  const swarms = reconcileEntities(current.swarms, snapshot.payload.swarms, (item) => item.id)
  if (jobs === current.jobs && swarms === current.swarms && !current.dirtyOperations && !current.error) return current
  return {
    ...current,
    jobs,
    swarms,
    dirtyOperations: false,
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
  if (
    previous?.snapshot.digest === snapshot.digest &&
    previous.snapshot.cursor === snapshot.cursor &&
    (options.prepend || !current.dirtySessions[snapshot.session.id])
  )
    return current
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
        const info = options.prepend
          ? (previous?.messages[messageID] ?? incoming.get(messageID)?.info)
          : (incoming.get(messageID)?.info ?? previous?.messages[messageID])
        return info ? [[messageID, info]] : []
      }),
    ),
  )
  const partIDs = reconcileRecord(
    previous?.partIDs ?? {},
    Object.fromEntries(
      messageIDs.map((messageID) => [
        messageID,
        options.prepend && previous?.messages[messageID]
          ? (previous.partIDs[messageID] ?? [])
          : (incoming.get(messageID)?.parts.map((part) => part.id) ?? previous?.partIDs[messageID] ?? []),
      ]),
    ),
  )
  const parts = reconcileRecord(
    previous?.parts ?? {},
    Object.fromEntries(
      messageIDs.flatMap((messageID) => {
        if (options.prepend && previous?.messages[messageID]) {
          return (previous.partIDs[messageID] ?? []).flatMap((partID) => {
            const part = previous.parts[partID]
            return part ? [[partID, part] as const] : []
          })
        }
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
      incoming.has(messageID) && !(options.prepend && previous?.messages[messageID])
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
  if (!options.prepend) delete dirtySessions[snapshot.session.id]
  const liveMessageIDs = Object.keys(messages)
  const livePartIDs = Object.keys(parts)
  const messageTombstones = deletedMessageIDs.reduce(
    (result, messageID) => ({ ...result, [messageID]: true as const }),
    withoutRecordKeys(current.tombstones.messages, liveMessageIDs),
  )
  const partTombstones = deletedPartIDs.reduce(
    (result, partID) => ({ ...result, [partID]: true as const }),
    withoutRecordKeys(current.tombstones.parts, livePartIDs),
  )
  return {
    ...current,
    sessions: mergeSessionRecords(current.sessions, [snapshot.session]),
    sessionDetails: {
      ...current.sessionDetails,
      [snapshot.session.id]: {
        revision: (previous?.revision ?? 0) + 1,
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
      sessions: withoutRecordKeys(current.tombstones.sessions, [snapshot.session.id]),
      messages: messageTombstones,
      parts: partTombstones,
      messageSessions: deletedMessageIDs.reduce(
        (result, messageID) => ({ ...result, [messageID]: snapshot.session.id }),
        withoutRecordKeys(current.tombstones.messageSessions, liveMessageIDs),
      ),
      partSessions: deletedPartIDs.reduce(
        (result, partID) => ({ ...result, [partID]: snapshot.session.id }),
        withoutRecordKeys(current.tombstones.partSessions, livePartIDs),
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
        case "capabilities":
          return {
            state: { ...current, cursor: event.cursor, aggregateSequences, dirtyCapabilities: true },
            gap: false,
          }
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
        case "operations":
          return {
            state: { ...current, cursor: event.cursor, aggregateSequences, dirtyOperations: true },
            gap: false,
          }
      }
  }
  return { state: current, gap: true }
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
  return collectClientSessions(state).filter((session) => session.parentID === sessionID)
}

export function selectClientKnownSessionIDs(state: ClientStateSyncState) {
  return collectKnownSessionIDs(state.sessions, state.projects, state.views)
}

export function selectClientStateSyncSnapshot(
  state: ClientStateSyncState,
  filterSession?: (session: Session) => boolean,
): ClientCatalogSnapshot | undefined {
  if (state.phase !== "ready") return undefined
  const sessionByID = state.sessions.records
  const projects = state.projects.ids.flatMap((id) => {
    const project = state.projects.records[id]
    if (!project) return []
    return [
      {
        ...project,
        sessions: project.sessionIDs
          .flatMap((sessionID) => sessionByID[sessionID] ?? [])
          .filter((session) => filterSession?.(session) ?? true),
      },
    ]
  })
  const views = state.views.ids.flatMap((id) => {
    const view = state.views.records[id]
    return view
      ? [
          {
            ...view,
            sessions: view.sessionIDs
              .flatMap((sessionID) => sessionByID[sessionID] ?? [])
              .filter((session) => filterSession?.(session) ?? true),
          },
        ]
      : []
  })
  return {
    projects,
    sessions: state.sessions.ids
      .flatMap((id) => state.sessions.records[id] ?? [])
      .filter((session) => filterSession?.(session) ?? true),
    views,
    permissions: state.permissions.ids.flatMap((id) => state.permissions.records[id] ?? []),
    questions: state.questions.ids.flatMap((id) => state.questions.records[id] ?? []),
    sessionStatus: state.sessionStatus,
    sessionUiState: state.sessionUiState,
  }
}

export function selectClientOperationsSnapshot(state: ClientStateSyncState) {
  if (state.phase !== "ready") return undefined
  return {
    jobs: state.jobs.ids.flatMap((id) => state.jobs.records[id] ?? []),
    swarms: state.swarms.ids.flatMap((id) => state.swarms.records[id] ?? []),
  }
}

export function selectClientCapabilitiesSnapshot(state: ClientStateSyncState) {
  return state.capabilities
}

export function emptyClientStateSyncState(): ClientStateSyncState {
  return {
    phase: "idle",
    lifecycle: { status: "idle", data: "empty", attempt: 0 },
    projects: emptyEntities(),
    sessions: emptyEntities(),
    views: emptyEntities(),
    sessionCards: { hasMore: false, pages: 0, loading: false },
    permissions: emptyEntities(),
    questions: emptyEntities(),
    jobs: emptyEntities(),
    swarms: emptyEntities(),
    sessionStatus: {},
    sessionUiState: {},
    sessionDetails: {},
    sessionLoads: {},
    dirtyCatalog: false,
    dirtyOperations: false,
    dirtyCapabilities: false,
    dirtySessions: {},
    tombstones: { sessions: {}, messages: {}, parts: {}, messageSessions: {}, partSessions: {} },
    aggregateSequences: {},
    pendingMutations: {},
  }
}

export function setClientSessionLoadState(
  state: ClientStateSyncState,
  sessionID: string,
  kind: "initial" | "older",
  status: ClientSessionLoadState["initial"] | ClientSessionLoadState["older"],
  error?: string,
) {
  const current = state.sessionLoads[sessionID] ?? { initial: "idle" as const, older: "idle" as const }
  const next = {
    ...current,
    [kind]: status,
    error,
  }
  return {
    ...state,
    sessionLoads: {
      ...state.sessionLoads,
      [sessionID]: next,
    },
  }
}

export function releaseClientSessionState(state: ClientStateSyncState, sessionID: string) {
  const messageIDs = Object.keys(state.tombstones.messageSessions).filter(
    (messageID) => state.tombstones.messageSessions[messageID] === sessionID,
  )
  const partIDs = Object.keys(state.tombstones.partSessions).filter(
    (partID) => state.tombstones.partSessions[partID] === sessionID,
  )
  if (
    !state.sessionDetails[sessionID] &&
    !state.sessionLoads[sessionID] &&
    !state.dirtySessions[sessionID] &&
    messageIDs.length === 0 &&
    partIDs.length === 0
  )
    return state
  const sessionDetails = { ...state.sessionDetails }
  const sessionLoads = { ...state.sessionLoads }
  const dirtySessions = { ...state.dirtySessions }
  delete sessionDetails[sessionID]
  delete sessionLoads[sessionID]
  delete dirtySessions[sessionID]
  return {
    ...state,
    sessionDetails,
    sessionLoads,
    dirtySessions,
    tombstones: {
      ...state.tombstones,
      messages: withoutRecordKeys(state.tombstones.messages, messageIDs),
      parts: withoutRecordKeys(state.tombstones.parts, partIDs),
      messageSessions: withoutRecordKeys(state.tombstones.messageSessions, messageIDs),
      partSessions: withoutRecordKeys(state.tombstones.partSessions, partIDs),
    },
  }
}

export function normalizeClientStateSyncLoading(state: ClientStateSyncState) {
  const sessionLoads = Object.fromEntries(
    Object.keys(state.sessionLoads).map((sessionID) => [
      sessionID,
      {
        initial: state.sessionDetails[sessionID] ? ("ready" as const) : ("idle" as const),
        older: "idle" as const,
      },
    ]),
  )
  return {
    ...state,
    sessionCards: state.sessionCards.loading ? { ...state.sessionCards, loading: false } : state.sessionCards,
    sessionLoads,
  }
}

export function clientStateSyncError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
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

function collectKnownSessionIDs(
  sessions: ClientStateSyncState["sessions"],
  projects: ClientStateSyncState["projects"],
  views: ClientStateSyncState["views"],
) {
  return new Set([
    ...sessions.ids,
    ...projects.ids.flatMap((id) => projects.records[id]?.sessionIDs ?? []),
    ...views.ids.flatMap((id) => views.records[id]?.sessionIDs ?? []),
  ])
}

function collectClientSessions(state: ClientStateSyncState) {
  return state.sessions.ids.flatMap((id) => state.sessions.records[id] ?? [])
}

function mergeSessionRecords(current: ClientEntityState<Session>, items: readonly Session[]) {
  const records = { ...current.records }
  items.forEach((item) => {
    records[item.id] = reconcileValue(records[item.id], item)
  })
  const ids = Object.values(records)
    .sort((left, right) => right.time.updated - left.time.updated || right.id.localeCompare(left.id))
    .map((session) => session.id)
  return {
    ids: equalCanonical(current.ids, ids) ? current.ids : ids,
    records: sameRecord(current.records, records) ? current.records : records,
  }
}

function sameRecord<T>(current: Record<string, T>, next: Record<string, T>) {
  const keys = Object.keys(next)
  return keys.length === Object.keys(current).length && keys.every((key) => current[key] === next[key])
}

function reconcileRecord<T>(current: Record<string, T>, next: Record<string, T>) {
  const entries = Object.entries(next).map(([key, value]) => [key, reconcileValue(current[key], value)] as const)
  if (Object.keys(current).length === entries.length && entries.every(([key, value]) => current[key] === value))
    return current
  return Object.fromEntries(entries)
}

function mergeRecord<T>(current: Record<string, T>, incoming: Record<string, T>) {
  if (Object.keys(incoming).length === 0) return current
  const next = { ...current }
  Object.entries(incoming).forEach(([key, value]) => {
    next[key] = reconcileValue(current[key], value)
  })
  return sameRecord(current, next) ? current : next
}

export function reconcileValue<T>(current: T | undefined, next: T): T {
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
  if (!isRecord(left) || !isRecord(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => equalCanonical(left[key], right[key]))
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

export function sameClientStateScope(left: OpencodeXStateScope | undefined, right: OpencodeXStateScope) {
  return Boolean(
    left &&
      left.projectID === right.projectID &&
      left.workspaceID === right.workspaceID &&
      left.directory === right.directory,
  )
}

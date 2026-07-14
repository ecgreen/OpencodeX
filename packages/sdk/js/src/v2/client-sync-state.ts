import type {
  OpencodeXOperationsSnapshot,
  OpencodeXSessionSnapshot,
  OpencodeXSessionSyncSnapshot,
  OpencodeXStateEvent,
  OpencodeXStateScope,
  OpencodeXStateSnapshot,
  Session,
} from "./client.js"
import { mergeClientSessions } from "./client-sync-session.js"
import type { ClientEntityState, ClientSessionLoadState, ClientStateSyncState } from "./client-sync-types.js"

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
    !current.dirtyOperations
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
  const jobs = reconcileEntities(previous.jobs, snapshot.payloads.operations.jobs, (item) => item.id)
  const swarms = reconcileEntities(previous.swarms, snapshot.payloads.operations.swarms, (item) => item.id)
  const deletedSessionIDs = previous.sessions.ids.filter((id) => !sessions.records[id])
  const sessionTombstones = deletedSessionIDs.reduce(
    (result, id) => ({ ...result, [id]: true as const }),
    withoutRecordKeys(previous.tombstones.sessions, sessions.ids),
  )
  const sessionDetails = Object.fromEntries(
    Object.entries(previous.sessionDetails).filter(([sessionID]) => Boolean(sessions.records[sessionID])),
  )
  const sessionLoads = Object.fromEntries(
    Object.entries(previous.sessionLoads).filter(([sessionID]) => Boolean(sessions.records[sessionID])),
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
    jobs,
    swarms,
    sessionStatus: reconcileRecord(previous.sessionStatus, catalog.sessionStatus),
    sessionUiState: reconcileRecord(previous.sessionUiState, catalog.sessionUiState),
    sessionDetails,
    sessionLoads,
    dirtyCatalog: false,
    dirtyOperations: false,
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
  return state.sessions.ids.flatMap((id) => {
    const session = state.sessions.records[id]
    return session?.parentID === sessionID ? [session] : []
  })
}

export function selectClientStateSyncSnapshot(
  state: ClientStateSyncState,
  filterSession?: (session: Session) => boolean,
): OpencodeXSessionSyncSnapshot | undefined {
  if (state.phase !== "ready") return undefined
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
    tombstones: { sessions: {}, messages: {}, parts: {} },
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

function reconcileRecord<T>(current: Record<string, T>, next: Record<string, T>) {
  const entries = Object.entries(next).map(([key, value]) => [key, reconcileValue(current[key], value)] as const)
  if (Object.keys(current).length === entries.length && entries.every(([key, value]) => current[key] === value))
    return current
  return Object.fromEntries(entries)
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

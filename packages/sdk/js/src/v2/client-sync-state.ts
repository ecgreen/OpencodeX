import type {
  OpencodeXOperationsSnapshot,
  OpencodeXSessionSnapshot,
  OpencodeXStateEvent,
  OpencodeXStateScope,
  OpencodeXStateSnapshot,
  Part,
  Session,
} from "./client.js"
import type {
  ClientCatalogSnapshot,
  ClientEntityState,
  ClientSessionDetailState,
  ClientSessionLoadState,
  ClientStateSyncState,
} from "./client-sync-types.js"
import { applyClientSessionCardPage } from "./client-sync-cards.js"
export { applyClientSessionCardPage } from "./client-sync-cards.js"

/**
 * True while a text-bearing part is mid-stream: it has started (`time.start`)
 * but has not been closed out (`time.end`). Parts that never carry timing at
 * all (user prompts, synthetic parts) are final, never streaming.
 *
 * This is the canonical streaming predicate. Display normalization, live-text
 * overlay retention, and delta buffering all delegate here — the unsafe
 * `part.time?.end === undefined` form misclassifies timeless parts as
 * streaming, which exempts them from display normalization and leaks
 * system-reminder blocks.
 */
export function isStreamingClientPart(part: Part) {
  if (part.type !== "text" && part.type !== "reasoning") return false
  return part.time !== undefined && part.time.end === undefined
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
  const terminalSessions = reconcileEntities(
    previous.terminalSessions,
    catalog.terminalSessions ?? [],
    (item) => item.id,
  )
  const views = reconcileEntities(previous.views, catalog.views, (item) => item.id)
  const paged = applyClientSessionCardPage({ ...previous, projects, terminalSessions, views }, catalog.sessionCards, {
    root: true,
  })
  const permissions = reconcileEntities(previous.permissions, catalog.permissions, (item) => item.id)
  const questions = reconcileEntities(previous.questions, catalog.questions, (item) => item.id)
  const jobs = reconcileEntities(previous.jobs, snapshot.payloads.operations.jobs, (item) => item.id)
  const swarms = reconcileEntities(previous.swarms, snapshot.payloads.operations.swarms, (item) => item.id)
  const knownSessionIDs = collectKnownSessionIDs(paged.sessions, paged.projects, paged.views)
  return {
    ...paged,
    phase: "ready",
    scope: snapshot.scope,
    epoch: snapshot.epoch,
    cursor: previous.cursor ?? snapshot.cursor,
    digest: snapshot.digest,
    projects: paged.projects,
    terminalSessions: paged.terminalSessions,
    views: paged.views,
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
  const incomingItems = snapshot.messages.items.flatMap((item) => {
    if (current.tombstones.messages[item.info.id]) return []
    const parts = item.parts.filter((part) => !current.tombstones.parts[part.id])
    return [{ ...item, parts }]
  })
  const incoming = new Map(incomingItems.map((item) => [item.info.id, item]))
  const preservedIDs = previous
    ? previous.messageIDs.filter((messageID) => options.prepend || previous.messageCoverage[messageID] === "older")
    : []
  const incomingParts = new Map(incomingItems.flatMap((item) => item.parts.map((part) => [part.id, part] as const)))
  const livePartText = options.prepend
    ? (previous?.livePartText ?? {})
    : Object.fromEntries(
        Object.entries(previous?.livePartText ?? {}).filter(([partID, live]) => {
          const part = incomingParts.get(partID)
          if (!part) {
            const previousPart = findClientDetailPart(previous, partID)
            return previousPart ? preservedIDs.includes(previousPart.messageID) : false
          }
          if (part.type !== "text" && part.type !== "reasoning") return false
          const previousPart = previous?.parts[part.messageID]?.[partID]
          return previousPart?.type === part.type && isStreamingClientPart(part) && part.text === live.base
        }),
      )
  const messageIDs = options.prepend
    ? [...new Set([...incomingItems.map((item) => item.info.id), ...preservedIDs])]
    : [...new Set([...preservedIDs, ...incomingItems.map((item) => item.info.id)])]
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
      messageIDs.map((messageID) => {
        const previousParts = previous?.parts[messageID] ?? {}
        const nextParts = (() => {
          if (options.prepend && previous?.messages[messageID]) return previousParts
          const bundle = incoming.get(messageID)
          if (bundle)
            return Object.fromEntries(
              bundle.parts.map((part) => [part.id, applyLivePartText(part, livePartText[part.id])] as const),
            )
          return previousParts
        })()
        return [messageID, reconcileRecord(previousParts, nextParts)] as const
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
        ...incomingItems.flatMap((item) => {
          // Prepend keeps the resident copy of an already-known message (see the
          // guards on `partIDs`/`parts` above), so a stale older-page copy must
          // not tombstone parts that remain live in the resident detail.
          if (options.prepend && previous.messages[item.info.id]) return []
          const currentPartIDs = new Set(item.parts.map((part) => part.id))
          return (previous.partIDs[item.info.id] ?? []).filter((partID) => !currentPartIDs.has(partID))
        }),
      ]
    : []
  const dirtySessions = { ...current.dirtySessions }
  if (!options.prepend) delete dirtySessions[snapshot.session.id]
  const liveMessageIDs = Object.keys(messages)
  const livePartIDs = Object.values(parts).flatMap((messageParts) => Object.keys(messageParts))
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
        livePartText: Object.keys(livePartText).length > 0 ? livePartText : undefined,
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

function applyLivePartText(incoming: Part, live: { base: string; text: string } | undefined): Part {
  if (!live) return incoming
  if (incoming.type === "text" || incoming.type === "reasoning") return { ...incoming, text: live.text }
  return incoming
}

export function applyClientStateEvent(
  current: ClientStateSyncState,
  event: OpencodeXStateEvent,
): { state: ClientStateSyncState; gap: boolean } {
  if (current.epoch && (current.epoch !== event.epoch || !sameClientStateScope(current.scope, event.scope))) {
    return { state: current, gap: true }
  }
  const aggregateKey = `${event.visibility}:${event.payload.aggregateID}`
  const previous = current.aggregateSequences[aggregateKey]
  if (previous !== undefined && event.aggregateSequence <= previous) return { state: current, gap: false }
  if (previous !== undefined && event.aggregateSequence !== previous + 1) return { state: current, gap: true }
  if (current.position !== undefined && event.position <= current.position) return { state: current, gap: true }
  const aggregateSequences = { ...current.aggregateSequences, [aggregateKey]: event.aggregateSequence }
  switch (event.operation) {
    case "invalidate":
      switch (event.domain) {
        case "capabilities":
          return {
            state: {
              ...current,
              cursor: event.cursor,
              position: event.position,
              aggregateSequences,
              dirtyCapabilities: true,
            },
            gap: false,
          }
        case "catalog":
          return {
            state: {
              ...current,
              cursor: event.cursor,
              position: event.position,
              aggregateSequences,
              dirtyCatalog: true,
            },
            gap: false,
          }
        case "session":
          return {
            state: {
              ...current,
              cursor: event.cursor,
              position: event.position,
              aggregateSequences,
              dirtySessions: { ...current.dirtySessions, [event.payload.aggregateID]: true },
            },
            gap: false,
          }
        case "operations":
          return {
            state: {
              ...current,
              cursor: event.cursor,
              position: event.position,
              aggregateSequences,
              dirtyOperations: true,
            },
            gap: false,
          }
      }
  }
  return { state: current, gap: true }
}

export function selectClientSessionMessages(state: ClientStateSyncState, sessionID: string) {
  const detail = state.sessionDetails[sessionID]
  if (!detail) return []
  return detail.messageIDs.map((messageID) => {
    const messageParts = detail.parts[messageID]
    return {
      info: detail.messages[messageID],
      parts: (detail.partIDs[messageID] ?? []).flatMap((partID) => messageParts?.[partID] ?? []),
    }
  })
}

/**
 * Looks a part up without its message ID. Costs one hash probe per loaded
 * message, so it stays cheap for the handful of live-streaming part IDs that
 * need it - never use it on a per-part hot path.
 */
export function findClientDetailPart(detail: ClientSessionDetailState | undefined, partID: string) {
  if (!detail) return undefined
  for (const messageParts of Object.values(detail.parts)) {
    const part = messageParts[partID]
    if (part) return part
  }
  return undefined
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
  const terminalSessionByID = state.terminalSessions.records
  const projects = state.projects.ids.flatMap((id) => {
    const project = state.projects.records[id]
    if (!project) return []
    return [
      {
        ...project,
        sessions: project.sessionIDs
          .flatMap((sessionID) => sessionByID[sessionID] ?? [])
          .filter((session) => filterSession?.(session) ?? true),
        terminalSessions: (project.terminalSessionIDs ?? []).flatMap(
          (terminalSessionID) => terminalSessionByID[terminalSessionID] ?? [],
        ),
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
            terminalSessions: (view.members ?? []).flatMap((member) =>
              member.kind === "terminal" ? (terminalSessionByID[member.id] ?? []) : [],
            ),
          },
        ]
      : []
  })
  return {
    projects,
    sessions: state.sessions.ids
      .flatMap((id) => state.sessions.records[id] ?? [])
      .filter((session) => filterSession?.(session) ?? true),
    terminalSessions: state.terminalSessions.ids.flatMap((id) => state.terminalSessions.records[id] ?? []),
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
    terminalSessions: emptyEntities(),
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

import type { Event, GlobalSession, OpencodeXSessionSnapshot, Part, Session } from "./client.js"
import type { ClientEntityState, ClientSessionDetailState, ClientStateSyncState } from "./client-sync-types.js"

export type ClientSessionEventBuffers = {
  pendingParts: Map<string, Part[]>
  pendingPartDeltas: Map<string, Map<string, string>>
}

export function createClientSessionEventBuffers(): ClientSessionEventBuffers {
  return { pendingParts: new Map(), pendingPartDeltas: new Map() }
}

export function clearClientSessionEventBuffers(buffers: ClientSessionEventBuffers) {
  buffers.pendingParts.clear()
  buffers.pendingPartDeltas.clear()
}

export function applyClientSessionEvent(
  current: ClientStateSyncState,
  event: Event,
  buffers: ClientSessionEventBuffers,
): { state: ClientStateSyncState; handled: boolean } {
  switch (event.type) {
    case "session.created":
    case "session.updated":
      return { state: patchClientSession(current, event.properties.info), handled: true }
    case "session.deleted":
      return { state: deleteClientSession(current, event.properties.info.id), handled: true }
    case "session.status":
      return {
        state: reconcileClientSessionUiState(
          {
            ...current,
            sessionStatus: { ...current.sessionStatus, [event.properties.sessionID]: event.properties.status },
          },
          event.properties.sessionID,
        ),
        handled: true,
      }
    case "session.idle": {
      const sessionStatus = { ...current.sessionStatus }
      delete sessionStatus[event.properties.sessionID]
      return {
        state: reconcileClientSessionUiState({ ...current, sessionStatus }, event.properties.sessionID),
        handled: true,
      }
    }
    case "opencodex.session_state.updated":
      return {
        state: reconcileClientSessionUiState(
          {
            ...current,
            sessionUiState: {
              ...current.sessionUiState,
              [event.properties.sessionID]: {
                sessionID: event.properties.sessionID,
                ...(event.properties.state.seenAt === undefined ? {} : { seenAt: event.properties.state.seenAt }),
                ...(event.properties.state.reviewedAt === undefined
                  ? {}
                  : { reviewedAt: event.properties.state.reviewedAt }),
                reviewedFiles: event.properties.state.reviewedFiles,
                displayStatus: current.sessionUiState[event.properties.sessionID]?.displayStatus ?? "idle",
                updated: current.sessionUiState[event.properties.sessionID]?.updated ?? false,
              },
            },
          },
          event.properties.sessionID,
        ),
        handled: true,
      }
    case "permission.asked":
      return {
        state: reconcileClientSessionUiState(
          patchClientPendingInteractions(
            { ...current, permissions: upsertClientEntity(current.permissions, event.properties, (item) => item.id) },
            event.properties.sessionID,
          ),
          event.properties.sessionID,
        ),
        handled: true,
      }
    case "permission.replied":
      return {
        state: reconcileClientSessionUiState(
          patchClientPendingInteractions(
            { ...current, permissions: removeClientEntity(current.permissions, event.properties.requestID) },
            event.properties.sessionID,
          ),
          event.properties.sessionID,
        ),
        handled: true,
      }
    case "question.asked":
      return {
        state: reconcileClientSessionUiState(
          patchClientPendingInteractions(
            { ...current, questions: upsertClientEntity(current.questions, event.properties, (item) => item.id) },
            event.properties.sessionID,
          ),
          event.properties.sessionID,
        ),
        handled: true,
      }
    case "question.replied":
    case "question.rejected":
      return {
        state: reconcileClientSessionUiState(
          patchClientPendingInteractions(
            { ...current, questions: removeClientEntity(current.questions, event.properties.requestID) },
            event.properties.sessionID,
          ),
          event.properties.sessionID,
        ),
        handled: true,
      }
    case "message.updated": {
      const detail = current.sessionDetails[event.properties.info.sessionID]
      if (!detail) return { state: current, handled: true }
      const messageID = event.properties.info.id
      const bufferedParts = buffers.pendingParts.get(messageID) ?? []
      buffers.pendingParts.delete(messageID)
      const next = bufferedParts.reduce(
        (result, part) => upsertClientPart(result, applyPendingClientPartDeltas(part, buffers)),
        {
          ...detail,
          revision: detail.revision + 1,
          messageIDs: detail.messages[messageID] ? detail.messageIDs : [...detail.messageIDs, messageID],
          messages: { ...detail.messages, [messageID]: event.properties.info },
        },
      )
      return { state: replaceClientSessionDetail(current, event.properties.info.sessionID, next), handled: true }
    }
    case "message.removed": {
      forgetPendingClientMessage(event.properties.messageID, buffers)
      const detail = current.sessionDetails[event.properties.sessionID]
      if (!detail?.messages[event.properties.messageID]) return { state: current, handled: true }
      const messages = { ...detail.messages }
      const partIDs = { ...detail.partIDs }
      const parts = { ...detail.parts }
      delete messages[event.properties.messageID]
      ;(partIDs[event.properties.messageID] ?? []).forEach((partID) => delete parts[partID])
      delete partIDs[event.properties.messageID]
      return {
        state: replaceClientSessionDetail(current, event.properties.sessionID, {
          ...detail,
          revision: detail.revision + 1,
          messageIDs: detail.messageIDs.filter((messageID) => messageID !== event.properties.messageID),
          messages,
          partIDs,
          parts,
        }),
        handled: true,
      }
    }
    case "message.part.updated": {
      const part = applyPendingClientPartDeltas(event.properties.part, buffers)
      const detail = current.sessionDetails[part.sessionID]
      if (!detail) return { state: current, handled: true }
      if (!detail.messages[part.messageID]) {
        buffers.pendingParts.set(
          part.messageID,
          upsertClientPartList(buffers.pendingParts.get(part.messageID) ?? [], part),
        )
        return { state: current, handled: true }
      }
      return {
        state: replaceClientSessionDetail(current, part.sessionID, {
          ...upsertClientPart(detail, part),
          revision: detail.revision + 1,
        }),
        handled: true,
      }
    }
    case "message.part.delta": {
      const detail = current.sessionDetails[event.properties.sessionID]
      if (!detail) return { state: current, handled: true }
      const part = detail.parts[event.properties.partID]
      if (!part) {
        rememberPendingClientPartDelta(event.properties, buffers)
        return { state: current, handled: true }
      }
      const next = applyClientPartDelta(part, event.properties.field, event.properties.delta)
      if (next === part) return { state: current, handled: true }
      return {
        state: replaceClientSessionDetail(current, event.properties.sessionID, {
          ...detail,
          revision: detail.revision + 1,
          parts: { ...detail.parts, [part.id]: next },
        }),
        handled: true,
      }
    }
    case "message.part.removed": {
      forgetPendingClientPart(event.properties.messageID, event.properties.partID, buffers)
      const detail = current.sessionDetails[event.properties.sessionID]
      if (!detail?.parts[event.properties.partID]) return { state: current, handled: true }
      const parts = { ...detail.parts }
      delete parts[event.properties.partID]
      return {
        state: replaceClientSessionDetail(current, event.properties.sessionID, {
          ...detail,
          revision: detail.revision + 1,
          partIDs: {
            ...detail.partIDs,
            [event.properties.messageID]: (detail.partIDs[event.properties.messageID] ?? []).filter(
              (partID) => partID !== event.properties.partID,
            ),
          },
          parts,
        }),
        handled: true,
      }
    }
    case "todo.updated":
      return {
        state: updateClientSessionSnapshot(current, event.properties.sessionID, (snapshot) => ({
          ...snapshot,
          todos: event.properties.todos,
        })),
        handled: true,
      }
    case "session.diff":
      return {
        state: updateClientSessionSnapshot(current, event.properties.sessionID, (snapshot) => ({
          ...snapshot,
          diff: event.properties.diff,
        })),
        handled: true,
      }
    default:
      return { state: current, handled: false }
  }
}

function patchClientSession(current: ClientStateSyncState, session: Session) {
  const sessionDetails = current.sessionDetails[session.id]
    ? {
        ...current.sessionDetails,
        [session.id]: {
          ...current.sessionDetails[session.id],
          revision: current.sessionDetails[session.id].revision + 1,
          snapshot: { ...current.sessionDetails[session.id].snapshot, session },
        },
      }
    : current.sessionDetails
  const patchEmbedded = (sessions: GlobalSession[]) => {
    const index = sessions.findIndex((item) => item.id === session.id)
    if (index === -1) return sessions
    return sessions.map((item, itemIndex) => (itemIndex === index ? { ...item, ...session } : item))
  }
  return reconcileClientSessionUiState(
    {
      ...current,
      sessions: upsertClientEntity(current.sessions, session, (item) => item.id),
      projects: mapClientEntities(current.projects, (project) => {
        const sessions = patchEmbedded(project.sessions)
        return sessions === project.sessions ? project : { ...project, sessions }
      }),
      views: mapClientEntities(current.views, (view) => {
        const sessions = patchEmbedded(view.sessions)
        return sessions === view.sessions ? view : { ...view, sessions }
      }),
      sessionDetails,
    },
    session.id,
  )
}

function deleteClientSession(current: ClientStateSyncState, sessionID: string) {
  const sessionStatus = { ...current.sessionStatus }
  const sessionUiState = { ...current.sessionUiState }
  const sessionDetails = { ...current.sessionDetails }
  delete sessionStatus[sessionID]
  delete sessionUiState[sessionID]
  delete sessionDetails[sessionID]
  return {
    ...current,
    sessions: removeClientEntity(current.sessions, sessionID),
    projects: mapClientEntities(current.projects, (project) => ({
      ...project,
      sessions: project.sessions.filter((session) => session.id !== sessionID),
    })),
    views: mapClientEntities(current.views, (view) => ({
      ...view,
      sessions: view.sessions.filter((session) => session.id !== sessionID),
    })),
    permissions: filterClientEntities(current.permissions, (request) => request.sessionID !== sessionID),
    questions: filterClientEntities(current.questions, (request) => request.sessionID !== sessionID),
    sessionStatus,
    sessionUiState,
    sessionDetails,
    tombstones: { ...current.tombstones, sessions: { ...current.tombstones.sessions, [sessionID]: true as const } },
  }
}

function patchClientPendingInteractions(current: ClientStateSyncState, sessionID: string) {
  return updateClientSessionSnapshot(current, sessionID, (snapshot) => ({
    ...snapshot,
    pendingInteractions: {
      permissions: current.permissions.ids.flatMap((id) => {
        const request = current.permissions.records[id]
        return request?.sessionID === sessionID ? [request] : []
      }),
      questions: current.questions.ids.flatMap((id) => {
        const request = current.questions.records[id]
        return request?.sessionID === sessionID ? [request] : []
      }),
    },
  }))
}

function reconcileClientSessionUiState(current: ClientStateSyncState, sessionID: string) {
  const session = current.sessions.records[sessionID]
  if (!session) return current
  const previous = current.sessionUiState[sessionID]
  const needsInput =
    current.permissions.ids.some((id) => current.permissions.records[id]?.sessionID === sessionID) ||
    current.questions.ids.some((id) => current.questions.records[id]?.sessionID === sessionID)
  const running =
    current.sessionStatus[sessionID]?.type === "busy" || current.sessionStatus[sessionID]?.type === "retry"
  const next = {
    sessionID,
    ...(previous?.seenAt === undefined ? {} : { seenAt: previous.seenAt }),
    ...(previous?.reviewedAt === undefined ? {} : { reviewedAt: previous.reviewedAt }),
    reviewedFiles: previous?.reviewedFiles ?? [],
    displayStatus: needsInput
      ? ("input_needed" as const)
      : running
        ? ("in_progress" as const)
        : session.time.updated > (previous?.reviewedAt ?? 0)
          ? ("needs_review" as const)
          : ("idle" as const),
    updated: session.time.updated > (previous?.seenAt ?? 0),
  }
  if (equalClientSessionUiState(previous, next)) return current
  return { ...current, sessionUiState: { ...current.sessionUiState, [sessionID]: next } }
}

function equalClientSessionUiState(
  left: ClientStateSyncState["sessionUiState"][string] | undefined,
  right: ClientStateSyncState["sessionUiState"][string],
) {
  return (
    left?.sessionID === right.sessionID &&
    left.seenAt === right.seenAt &&
    left.reviewedAt === right.reviewedAt &&
    left.displayStatus === right.displayStatus &&
    left.updated === right.updated &&
    left.reviewedFiles.length === right.reviewedFiles.length &&
    left.reviewedFiles.every((file, index) => file === right.reviewedFiles[index])
  )
}

function upsertClientEntity<T>(current: ClientEntityState<T>, item: T, id: (item: T) => string) {
  const itemID = id(item)
  return {
    ids: current.records[itemID] ? current.ids : [...current.ids, itemID],
    records: { ...current.records, [itemID]: item },
  }
}

function removeClientEntity<T>(current: ClientEntityState<T>, id: string) {
  if (!current.records[id]) return current
  const records = { ...current.records }
  delete records[id]
  return { ids: current.ids.filter((itemID) => itemID !== id), records }
}

function filterClientEntities<T>(current: ClientEntityState<T>, keep: (item: T) => boolean) {
  const ids = current.ids.filter((id) => {
    const item = current.records[id]
    return item ? keep(item) : false
  })
  if (ids.length === current.ids.length) return current
  return { ids, records: Object.fromEntries(ids.map((id) => [id, current.records[id]])) }
}

function mapClientEntities<T>(current: ClientEntityState<T>, update: (item: T) => T) {
  const entries = current.ids.map((id) => [id, update(current.records[id])] as const)
  if (entries.every(([id, item]) => item === current.records[id])) return current
  const records = Object.fromEntries(entries)
  return { ids: current.ids, records }
}

function replaceClientSessionDetail(
  current: ClientStateSyncState,
  sessionID: string,
  detail: ClientSessionDetailState,
) {
  return { ...current, sessionDetails: { ...current.sessionDetails, [sessionID]: detail } }
}

function updateClientSessionSnapshot(
  current: ClientStateSyncState,
  sessionID: string,
  update: (snapshot: OpencodeXSessionSnapshot) => OpencodeXSessionSnapshot,
) {
  const detail = current.sessionDetails[sessionID]
  if (!detail) return current
  return replaceClientSessionDetail(current, sessionID, {
    ...detail,
    revision: detail.revision + 1,
    snapshot: update(detail.snapshot),
  })
}

function upsertClientPart(detail: ClientSessionDetailState, part: Part): ClientSessionDetailState {
  return {
    ...detail,
    partIDs: {
      ...detail.partIDs,
      [part.messageID]: upsertClientPartID(detail.partIDs[part.messageID] ?? [], part.id),
    },
    parts: { ...detail.parts, [part.id]: part },
  }
}

function upsertClientPartID(partIDs: string[], partID: string) {
  if (partIDs.includes(partID)) return partIDs
  return [...partIDs, partID].sort((a, b) => a.localeCompare(b))
}

function upsertClientPartList(parts: Part[], part: Part) {
  const index = parts.findIndex((item) => item.id === part.id)
  if (index === -1) return [...parts, part].sort((a, b) => a.id.localeCompare(b.id))
  return parts.map((item, itemIndex) => (itemIndex === index ? part : item))
}

function applyClientPartDelta(part: Part, field: string, delta: string): Part {
  if (field !== "text" || (part.type !== "text" && part.type !== "reasoning")) return part
  return { ...part, text: part.text + delta }
}

function rememberPendingClientPartDelta(
  input: { messageID: string; partID: string; field: string; delta: string },
  buffers: ClientSessionEventBuffers,
) {
  const pending = buffers.pendingParts.get(input.messageID)
  if (pending?.some((part) => part.id === input.partID)) {
    buffers.pendingParts.set(
      input.messageID,
      pending.map((part) => (part.id === input.partID ? applyClientPartDelta(part, input.field, input.delta) : part)),
    )
    return
  }
  const deltas = buffers.pendingPartDeltas.get(input.messageID) ?? new Map<string, string>()
  const key = `${input.partID}\0${input.field}`
  deltas.set(key, (deltas.get(key) ?? "") + input.delta)
  buffers.pendingPartDeltas.set(input.messageID, deltas)
}

function applyPendingClientPartDeltas(part: Part, buffers: ClientSessionEventBuffers) {
  const deltas = buffers.pendingPartDeltas.get(part.messageID)
  if (!deltas) return part
  const next = Array.from(deltas).reduce((current, [key, delta]) => {
    const [partID, field] = key.split("\0")
    if (partID !== part.id || !field) return current
    deltas.delete(key)
    return applyClientPartDelta(current, field, delta)
  }, part)
  if (deltas.size === 0) buffers.pendingPartDeltas.delete(part.messageID)
  return next
}

function forgetPendingClientMessage(messageID: string, buffers: ClientSessionEventBuffers) {
  buffers.pendingParts.delete(messageID)
  buffers.pendingPartDeltas.delete(messageID)
}

function forgetPendingClientPart(messageID: string, partID: string, buffers: ClientSessionEventBuffers) {
  const parts = buffers.pendingParts.get(messageID)
  if (parts) {
    const next = parts.filter((part) => part.id !== partID)
    if (next.length > 0) buffers.pendingParts.set(messageID, next)
    else buffers.pendingParts.delete(messageID)
  }
  const deltas = buffers.pendingPartDeltas.get(messageID)
  if (!deltas) return
  Array.from(deltas.keys())
    .filter((key) => key.startsWith(`${partID}\0`))
    .forEach((key) => deltas.delete(key))
  if (deltas.size === 0) buffers.pendingPartDeltas.delete(messageID)
}

import type { Event, OpencodeXSessionSnapshot, Part, Session } from "./client.js"
import type { ClientEntityState, ClientSessionDetailState, ClientStateSyncState } from "./client-sync-types.js"
import { isStreamingClientPart, releaseClientSessionState } from "./client-sync-state.js"
import { isClientSessionRenderable } from "./client-sync-cards.js"
import { deriveClientSessionDisplayStatus } from "./client-session-status.js"

type ClientBufferedSessionEvent = Extract<
  Event,
  {
    type:
      | "message.updated"
      | "message.removed"
      | "message.part.updated"
      | "message.part.delta"
      | "message.part.removed"
      | "todo.updated"
      | "session.diff"
  }
>

type ClientSessionEventBuffer = {
  pendingEvents: ClientBufferedSessionEvent[]
  pendingParts: Map<string, Part[]>
  pendingPartDeltas: Map<string, Map<string, string>>
}

export type ClientSessionEventBuffers = Map<string, ClientSessionEventBuffer>

export function createClientSessionEventBuffers(): ClientSessionEventBuffers {
  return new Map()
}

export function clearClientSessionEventBuffers(buffers: ClientSessionEventBuffers, sessionID?: string) {
  if (sessionID !== undefined) {
    buffers.delete(sessionID)
    return
  }
  buffers.clear()
}

export function beginClientSessionEventBuffer(buffers: ClientSessionEventBuffers, sessionID: string) {
  getClientSessionEventBuffer(buffers, sessionID)
}

export function drainClientSessionEventBuffer(
  current: ClientStateSyncState,
  sessionID: string,
  buffers: ClientSessionEventBuffers,
) {
  const buffer = buffers.get(sessionID)
  if (!buffer || !current.sessionDetails[sessionID]) return current
  const events = buffer.pendingEvents.splice(0)
  const replayed = events.reduce((state, event) => applyClientSessionEvent(state, event, buffers).state, current)
  const detail = replayed.sessionDetails[sessionID]
  if (!detail) return replayed
  const pendingParts = Array.from(buffer.pendingParts).flatMap(([messageID, parts]) => {
    if (!detail.messages[messageID]) return []
    buffer.pendingParts.delete(messageID)
    return parts
  })
  const withParts = pendingParts.reduce(upsertClientPart, detail)
  // Pending deltas are keyed by message, so only those messages can change.
  const drained = [...buffer.pendingPartDeltas.keys()].reduce(
    (current, messageID) => {
      const messageParts = current.detail.parts[messageID]
      if (!messageParts) return current
      const entries = Object.entries(messageParts).map(
        ([partID, part]) => [partID, applyPendingClientPartDeltas(part, buffer)] as const,
      )
      if (entries.every(([partID, part]) => part === messageParts[partID])) return current
      const withLive = entries.reduce(
        (result, [partID, part]) => recordLivePartText(result, messageParts[partID], part),
        current.detail,
      )
      return {
        detail: { ...withLive, parts: { ...withLive.parts, [messageID]: Object.fromEntries(entries) } },
        changed: true,
      }
    },
    { detail: withParts, changed: false },
  )
  const next =
    pendingParts.length === 0 && !drained.changed
      ? replayed
      : replaceClientSessionDetail(replayed, sessionID, {
          ...drained.detail,
          revision: drained.detail.revision + 1,
        })
  const cleared = clearClientDetailTombstones(next, sessionID)
  if (buffer.pendingEvents.length === 0 && buffer.pendingParts.size === 0 && buffer.pendingPartDeltas.size === 0)
    buffers.delete(sessionID)
  return cleared
}

export function applyClientSessionEvent(
  current: ClientStateSyncState,
  event: Event,
  buffers: ClientSessionEventBuffers,
): { state: ClientStateSyncState; handled: boolean } {
  switch (event.type) {
    case "session.created":
    case "session.updated":
      if (!isClientSessionRenderable(event.properties.info)) {
        clearClientSessionEventBuffers(buffers, event.properties.info.id)
        return { state: deleteClientSession(current, event.properties.info.id), handled: true }
      }
      return { state: patchClientSession(current, event.properties.info), handled: true }
    case "session.deleted":
      clearClientSessionEventBuffers(buffers, event.properties.info.id)
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
      if (!detail) {
        buffers.get(event.properties.info.sessionID)?.pendingEvents.push(event)
        return { state: current, handled: true }
      }
      // Peek, don't create: a message update with nothing buffered must not
      // grow the buffer map with an empty entry that only a drain removes.
      const sessionBuffers = buffers.get(event.properties.info.sessionID)
      const messageID = event.properties.info.id
      const bufferedParts = sessionBuffers?.pendingParts.get(messageID) ?? []
      sessionBuffers?.pendingParts.delete(messageID)
      const next = bufferedParts.reduce(
        (result, part) => {
          const updated = sessionBuffers ? applyPendingClientPartDeltas(part, sessionBuffers) : part
          return recordLivePartText(upsertClientPart(result, updated), part, updated)
        },
        {
          ...detail,
          revision: detail.revision + 1,
          messageIDs: detail.messages[messageID] ? detail.messageIDs : [...detail.messageIDs, messageID],
          messages: { ...detail.messages, [messageID]: event.properties.info },
        },
      )
      return {
        state: clearClientMessageTombstone(
          replaceClientSessionDetail(current, event.properties.info.sessionID, next),
          messageID,
        ),
        handled: true,
      }
    }
    case "message.removed": {
      const sessionBuffers = buffers.get(event.properties.sessionID)
      if (sessionBuffers) forgetPendingClientMessage(event.properties.messageID, sessionBuffers)
      const detail = current.sessionDetails[event.properties.sessionID]
      if (!detail) {
        const buffer = buffers.get(event.properties.sessionID)
        if (!buffer) return { state: current, handled: true }
        buffer.pendingEvents.push(event)
        return {
          state: markClientMessageTombstone(current, event.properties.sessionID, event.properties.messageID),
          handled: true,
        }
      }
      if (!detail.messages[event.properties.messageID])
        return {
          state: markClientMessageTombstone(current, event.properties.sessionID, event.properties.messageID),
          handled: true,
        }
      const messages = { ...detail.messages }
      const partIDs = { ...detail.partIDs }
      const parts = { ...detail.parts }
      const removedPartIDs = partIDs[event.properties.messageID] ?? []
      delete messages[event.properties.messageID]
      delete parts[event.properties.messageID]
      delete partIDs[event.properties.messageID]
      return {
        state: removedPartIDs.reduce(
          (state, partID) => markClientPartTombstone(state, event.properties.sessionID, partID),
          markClientMessageTombstone(
            replaceClientSessionDetail(
              current,
              event.properties.sessionID,
              clearLivePartText(
                {
                  ...detail,
                  revision: detail.revision + 1,
                  messageIDs: detail.messageIDs.filter((messageID) => messageID !== event.properties.messageID),
                  messages,
                  partIDs,
                  parts,
                },
                removedPartIDs,
              ),
            ),
            event.properties.sessionID,
            event.properties.messageID,
          ),
        ),
        handled: true,
      }
    }
    case "message.part.updated": {
      const detail = current.sessionDetails[event.properties.part.sessionID]
      if (!detail) {
        buffers.get(event.properties.part.sessionID)?.pendingEvents.push(event)
        return { state: current, handled: true }
      }
      if (!detail.messages[event.properties.part.messageID]) {
        const sessionBuffers = getClientSessionEventBuffer(buffers, event.properties.part.sessionID)
        sessionBuffers.pendingParts.set(
          event.properties.part.messageID,
          upsertClientPartList(
            sessionBuffers.pendingParts.get(event.properties.part.messageID) ?? [],
            event.properties.part,
          ),
        )
        return { state: current, handled: true }
      }
      // Peek, don't create: only the buffering branch above needs an entry.
      const sessionBuffers = buffers.get(event.properties.part.sessionID)
      const part = sessionBuffers
        ? applyPendingClientPartDeltas(event.properties.part, sessionBuffers)
        : event.properties.part
      const updated = recordLivePartText(upsertClientPart(detail, part), event.properties.part, part)
      return {
        state: clearClientPartTombstone(
          replaceClientSessionDetail(current, part.sessionID, {
            ...updated,
            revision: updated.revision + 1,
          }),
          part.id,
        ),
        handled: true,
      }
    }
    case "message.part.delta": {
      const detail = current.sessionDetails[event.properties.sessionID]
      if (!detail) {
        buffers.get(event.properties.sessionID)?.pendingEvents.push(event)
        return { state: current, handled: true }
      }
      const messageParts = detail.parts[event.properties.messageID]
      const part = messageParts?.[event.properties.partID]
      if (!messageParts || !part) {
        rememberPendingClientPartDelta(
          event.properties,
          getClientSessionEventBuffer(buffers, event.properties.sessionID),
        )
        return { state: current, handled: true }
      }
      const next = applyClientPartDelta(part, event.properties.field, event.properties.delta)
      if (next === part) return { state: current, handled: true }
      if ((part.type !== "text" && part.type !== "reasoning") || (next.type !== "text" && next.type !== "reasoning"))
        return { state: current, handled: true }
      const live = detail.livePartText?.[part.id]
      return {
        state: replaceClientSessionDetail(
          current,
          event.properties.sessionID,
          recordLivePartText(
            {
              ...detail,
              revision: detail.revision + 1,
              parts: { ...detail.parts, [part.messageID]: { ...messageParts, [part.id]: next } },
            },
            part,
            next,
            live,
          ),
        ),
        handled: true,
      }
    }
    case "message.part.removed": {
      const sessionBuffers = buffers.get(event.properties.sessionID)
      if (sessionBuffers) forgetPendingClientPart(event.properties.messageID, event.properties.partID, sessionBuffers)
      const detail = current.sessionDetails[event.properties.sessionID]
      if (!detail) {
        const buffer = buffers.get(event.properties.sessionID)
        if (!buffer) return { state: current, handled: true }
        buffer.pendingEvents.push(event)
        return {
          state: markClientPartTombstone(current, event.properties.sessionID, event.properties.partID),
          handled: true,
        }
      }
      const messageParts = detail.parts[event.properties.messageID]
      if (!messageParts?.[event.properties.partID])
        return {
          state: markClientPartTombstone(current, event.properties.sessionID, event.properties.partID),
          handled: true,
        }
      const nextMessageParts = { ...messageParts }
      delete nextMessageParts[event.properties.partID]
      const parts = { ...detail.parts, [event.properties.messageID]: nextMessageParts }
      return {
        state: markClientPartTombstone(
          replaceClientSessionDetail(
            current,
            event.properties.sessionID,
            clearLivePartText(
              {
                ...detail,
                revision: detail.revision + 1,
                partIDs: {
                  ...detail.partIDs,
                  [event.properties.messageID]: (detail.partIDs[event.properties.messageID] ?? []).filter(
                    (partID) => partID !== event.properties.partID,
                  ),
                },
                parts,
              },
              [event.properties.partID],
            ),
          ),
          event.properties.sessionID,
          event.properties.partID,
        ),
        handled: true,
      }
    }
    case "todo.updated":
      if (!current.sessionDetails[event.properties.sessionID]) {
        buffers.get(event.properties.sessionID)?.pendingEvents.push(event)
        return { state: current, handled: true }
      }
      return {
        state: updateClientSessionSnapshot(current, event.properties.sessionID, (snapshot) => ({
          ...snapshot,
          todos: event.properties.todos,
        })),
        handled: true,
      }
    case "session.diff":
      if (!current.sessionDetails[event.properties.sessionID]) {
        buffers.get(event.properties.sessionID)?.pendingEvents.push(event)
        return { state: current, handled: true }
      }
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
  const previous = current.sessions.records[session.id]
  if (previous && previous.time.updated > session.time.updated) return current
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
  return reconcileClientSessionUiState(
    {
      ...current,
      sessions: upsertClientEntity(current.sessions, session, (item) => item.id),
      sessionDetails,
      tombstones: {
        ...current.tombstones,
        sessions: withoutClientRecordKey(current.tombstones.sessions, session.id),
      },
    },
    session.id,
  )
}

function deleteClientSession(current: ClientStateSyncState, sessionID: string) {
  const released = releaseClientSessionState(current, sessionID)
  const sessionStatus = { ...released.sessionStatus }
  const sessionUiState = { ...released.sessionUiState }
  const sessionDetails = { ...released.sessionDetails }
  delete sessionStatus[sessionID]
  delete sessionUiState[sessionID]
  delete sessionDetails[sessionID]
  return {
    ...released,
    sessions: removeClientEntity(released.sessions, sessionID),
    projects: mapClientEntities(released.projects, (project) => ({
      ...project,
      sessionIDs: project.sessionIDs.filter((id) => id !== sessionID),
    })),
    views: mapClientEntities(released.views, (view) => ({
      ...view,
      sessionIDs: view.sessionIDs.filter((id) => id !== sessionID),
      focusedSessionID:
        view.focusedSessionID === sessionID ? view.sessionIDs.find((id) => id !== sessionID) : view.focusedSessionID,
    })),
    permissions: filterClientEntities(released.permissions, (request) => request.sessionID !== sessionID),
    questions: filterClientEntities(released.questions, (request) => request.sessionID !== sessionID),
    sessionStatus,
    sessionUiState,
    sessionDetails,
    tombstones: { ...released.tombstones, sessions: { ...released.tombstones.sessions, [sessionID]: true as const } },
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
  const next = {
    sessionID,
    ...(previous?.seenAt === undefined ? {} : { seenAt: previous.seenAt }),
    ...(previous?.reviewedAt === undefined ? {} : { reviewedAt: previous.reviewedAt }),
    reviewedFiles: previous?.reviewedFiles ?? [],
    // Same core the clients render from, so the persisted value cannot drift
    // from the derived one. The reconciler has no view of a client's optimistic
    // pending prompt or of transcript activity, so it only supplies what it
    // authoritatively knows.
    displayStatus: deriveClientSessionDisplayStatus({
      status: current.sessionStatus[sessionID],
      hasPendingInteraction: needsInput,
      updatedAt: session.time.updated,
      reviewedAt: previous?.reviewedAt,
    }),
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
  const updated = {
    ...detail,
    partIDs: {
      ...detail.partIDs,
      [part.messageID]: upsertClientPartID(detail.partIDs[part.messageID] ?? [], part.id),
    },
    parts: { ...detail.parts, [part.messageID]: { ...detail.parts[part.messageID], [part.id]: part } },
  }
  return clearLivePartText(updated, [part.id])
}

function clearLivePartText(detail: ClientSessionDetailState, partIDs: readonly string[]) {
  if (!detail.livePartText || !partIDs.some((partID) => detail.livePartText?.[partID])) return detail
  const livePartText = { ...detail.livePartText }
  partIDs.forEach((partID) => delete livePartText[partID])
  return { ...detail, livePartText: Object.keys(livePartText).length > 0 ? livePartText : undefined }
}

function recordLivePartText(
  detail: ClientSessionDetailState,
  base: Part | undefined,
  next: Part,
  existing?: { base: string; text: string },
) {
  if (
    !base ||
    (base.type !== "text" && base.type !== "reasoning") ||
    (next.type !== "text" && next.type !== "reasoning") ||
    !isStreamingClientPart(next) ||
    base.text === next.text
  )
    return detail
  return {
    ...detail,
    livePartText: {
      ...detail.livePartText,
      [next.id]: existing ? { ...existing, text: next.text } : { base: base.text, text: next.text },
    },
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
  buffers: ClientSessionEventBuffer,
) {
  const deltas = buffers.pendingPartDeltas.get(input.messageID) ?? new Map<string, string>()
  const key = `${input.partID}\0${input.field}`
  deltas.set(key, (deltas.get(key) ?? "") + input.delta)
  buffers.pendingPartDeltas.set(input.messageID, deltas)
}

function applyPendingClientPartDeltas(part: Part, buffers: ClientSessionEventBuffer) {
  const deltas = buffers.pendingPartDeltas.get(part.messageID)
  if (!deltas) return part
  if ((part.type === "text" || part.type === "reasoning") && !isStreamingClientPart(part)) {
    Array.from(deltas.keys())
      .filter((key) => key.startsWith(`${part.id}\0`))
      .forEach((key) => deltas.delete(key))
    if (deltas.size === 0) buffers.pendingPartDeltas.delete(part.messageID)
    return part
  }
  const next = Array.from(deltas).reduce((current, [key, delta]) => {
    const [partID, field] = key.split("\0")
    if (partID !== part.id || !field) return current
    deltas.delete(key)
    return applyClientPartDelta(current, field, delta)
  }, part)
  if (deltas.size === 0) buffers.pendingPartDeltas.delete(part.messageID)
  return next
}

function forgetPendingClientMessage(messageID: string, buffers: ClientSessionEventBuffer) {
  buffers.pendingParts.delete(messageID)
  buffers.pendingPartDeltas.delete(messageID)
}

function forgetPendingClientPart(messageID: string, partID: string, buffers: ClientSessionEventBuffer) {
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

function getClientSessionEventBuffer(buffers: ClientSessionEventBuffers, sessionID: string) {
  const current = buffers.get(sessionID)
  if (current) return current
  const next = {
    pendingEvents: new Array<ClientBufferedSessionEvent>(),
    pendingParts: new Map<string, Part[]>(),
    pendingPartDeltas: new Map<string, Map<string, string>>(),
  }
  buffers.set(sessionID, next)
  return next
}

function markClientMessageTombstone(current: ClientStateSyncState, sessionID: string, messageID: string) {
  return {
    ...current,
    tombstones: {
      ...current.tombstones,
      messages: { ...current.tombstones.messages, [messageID]: true as const },
      messageSessions: { ...current.tombstones.messageSessions, [messageID]: sessionID },
    },
  }
}

function markClientPartTombstone(current: ClientStateSyncState, sessionID: string, partID: string) {
  return {
    ...current,
    tombstones: {
      ...current.tombstones,
      parts: { ...current.tombstones.parts, [partID]: true as const },
      partSessions: { ...current.tombstones.partSessions, [partID]: sessionID },
    },
  }
}

function clearClientMessageTombstone(current: ClientStateSyncState, messageID: string) {
  if (!current.tombstones.messages[messageID] && !current.tombstones.messageSessions[messageID]) return current
  return {
    ...current,
    tombstones: {
      ...current.tombstones,
      messages: withoutClientRecordKey(current.tombstones.messages, messageID),
      messageSessions: withoutClientRecordKey(current.tombstones.messageSessions, messageID),
    },
  }
}

function clearClientPartTombstone(current: ClientStateSyncState, partID: string) {
  if (!current.tombstones.parts[partID] && !current.tombstones.partSessions[partID]) return current
  return {
    ...current,
    tombstones: {
      ...current.tombstones,
      parts: withoutClientRecordKey(current.tombstones.parts, partID),
      partSessions: withoutClientRecordKey(current.tombstones.partSessions, partID),
    },
  }
}

function clearClientDetailTombstones(current: ClientStateSyncState, sessionID: string) {
  const detail = current.sessionDetails[sessionID]
  if (!detail) return current
  return Object.values(detail.parts).reduce(
    (state, messageParts) =>
      Object.keys(messageParts).reduce((result, partID) => clearClientPartTombstone(result, partID), state),
    detail.messageIDs.reduce((state, messageID) => clearClientMessageTombstone(state, messageID), current),
  )
}

function withoutClientRecordKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

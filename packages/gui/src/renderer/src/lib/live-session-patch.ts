import type { GlobalEvent, Message, OpencodeXSessionState, Part, PermissionRequest, QuestionRequest, Session, SnapshotFileDiff, Todo } from "@opencode-ai/sdk/v2/client"
import { trimToLiveTail, type MessageWindow } from "./message-window"
import { displayMessageText } from "./message-text"
import { reconcileSessionUiState } from "./session-status"
import { isRenderableSession, type GuiSnapshot, type MessageBundle, type SessionCardSnapshot, type SessionData } from "./store"
import { setRecordEntry } from "./view-pane-state"

const pendingLiveParts = new Map<string, Part[]>()
const pendingLivePartDeltas = new Map<string, Map<string, string>>()

type SessionDataPatchOptions = {
  appendMissingMessages?: boolean
}

export type SessionDataEventRouteContext = {
  currentSessionID?: string
  activeViewSessionIDs?: string[]
  loadedSessionID?: string
  loadedSessionData?: SessionData
  viewSessionData: Record<string, SessionData>
}

type RouteLike = { name: string; sessionID?: string }

export type SessionDataEventTargets = {
  selectedSessionID?: string
  visibleSessionIDs: string[]
}

export type GlobalEventAction =
  | { type: "status"; sessionID: string; status: NonNullable<GuiSnapshot["sessionStatus"][string]>; syncVisible: boolean }
  | { type: "state"; sessionID: string; state: OpencodeXSessionState }
  | { type: "session-data" }
  | { type: "snapshot" }
  | { type: "ignore" }
  | { type: "refresh"; sessionID?: string }

export type GlobalEventRefreshAction = { sessionID?: string }

export function runGlobalEventAction(action: GlobalEventAction, handlers: {
  applyStatus: (sessionID: string, status: NonNullable<GuiSnapshot["sessionStatus"][string]>) => void
  syncVisible: (sessionID: string) => void
  applyState: (sessionID: string, state: OpencodeXSessionState) => void
  applySessionData: () => void
  applySnapshot: () => void
}): GlobalEventRefreshAction | undefined {
  switch (action.type) {
    case "status":
      handlers.applyStatus(action.sessionID, action.status)
      if (action.syncVisible) handlers.syncVisible(action.sessionID)
      return
    case "state":
      handlers.applyState(action.sessionID, action.state)
      return
    case "session-data":
      handlers.applySessionData()
      return
    case "snapshot":
      handlers.applySnapshot()
      return
    case "ignore":
      return
    case "refresh":
      return { sessionID: action.sessionID }
  }
}

export function applySessionStatusSnapshot(snapshot: GuiSnapshot | undefined, sessionID: string, status: NonNullable<GuiSnapshot["sessionStatus"][string]>) {
  if (!snapshot) return snapshot
  const next = status.type === "idle"
    ? {
      ...snapshot,
      sessionStatus: Object.fromEntries(Object.entries(snapshot.sessionStatus).filter(([id]) => id !== sessionID)),
    }
    : { ...snapshot, sessionStatus: { ...snapshot.sessionStatus, [sessionID]: status } }
  return reconcileSessionUiState(next, sessionID)
}

export function applySessionStateSnapshot(snapshot: GuiSnapshot | undefined, sessionID: string, state: OpencodeXSessionState) {
  if (!snapshot) return snapshot
  const existing = snapshot.sessionUiState[sessionID]
  return reconcileSessionUiState({
    ...snapshot,
    sessionUiState: {
      ...snapshot.sessionUiState,
      [sessionID]: {
        sessionID,
        ...(state.seenAt === undefined ? {} : { seenAt: state.seenAt }),
        ...(state.reviewedAt === undefined ? {} : { reviewedAt: state.reviewedAt }),
        reviewedFiles: state.reviewedFiles,
        displayStatus: existing?.displayStatus ?? "idle",
        updated: existing?.updated ?? false,
      },
    },
  }, sessionID)
}

export function mergeSnapshot(snapshot: GuiSnapshot, next: GuiSnapshot): GuiSnapshot {
  const cardSnapshot = mergeSessionCardSnapshot(snapshot, next)
  const merged = {
    ...snapshot,
    ...cardSnapshot,
    providers: stableValue(snapshot.providers, next.providers),
    agents: stableValue(snapshot.agents, next.agents),
    commands: stableValue(snapshot.commands, next.commands),
    lsp: stableValue(snapshot.lsp, next.lsp),
    mcp: stableValue(snapshot.mcp, next.mcp),
    config: stableValue(snapshot.config, next.config),
    plugins: stableValue(snapshot.plugins, next.plugins),
    swarms: stableValue(snapshot.swarms, next.swarms),
    jobs: stableValue(snapshot.jobs, next.jobs),
  }
  return snapshot === merged
    || (
      snapshot.projects === merged.projects
      && snapshot.sessions === merged.sessions
      && snapshot.views === merged.views
      && snapshot.sessionStatus === merged.sessionStatus
      && snapshot.sessionUiState === merged.sessionUiState
      && snapshot.permissions === merged.permissions
      && snapshot.questions === merged.questions
      && snapshot.providers === merged.providers
      && snapshot.agents === merged.agents
      && snapshot.commands === merged.commands
      && snapshot.lsp === merged.lsp
      && snapshot.mcp === merged.mcp
      && snapshot.config === merged.config
      && snapshot.plugins === merged.plugins
      && snapshot.swarms === merged.swarms
      && snapshot.jobs === merged.jobs
      && snapshot.sessionSyncRevision === merged.sessionSyncRevision
    )
    ? snapshot
    : merged
}

export function mergeSessionCardSnapshot(snapshot: GuiSnapshot, next: SessionCardSnapshot): GuiSnapshot {
  const merged = {
    ...snapshot,
    projects: stableValue(snapshot.projects, next.projects),
    sessions: stableValue(snapshot.sessions, next.sessions),
    views: stableValue(snapshot.views, next.views),
    sessionStatus: stableValue(snapshot.sessionStatus, next.sessionStatus),
    sessionUiState: stableValue(snapshot.sessionUiState, next.sessionUiState),
    permissions: stableValue(snapshot.permissions, next.permissions),
    questions: stableValue(snapshot.questions, next.questions),
    sessionSyncRevision: next.sessionSyncRevision,
  }
  return snapshot.projects === merged.projects
    && snapshot.sessions === merged.sessions
    && snapshot.views === merged.views
    && snapshot.sessionStatus === merged.sessionStatus
    && snapshot.sessionUiState === merged.sessionUiState
    && snapshot.permissions === merged.permissions
    && snapshot.questions === merged.questions
    && snapshot.sessionSyncRevision === merged.sessionSyncRevision
    ? snapshot
    : merged
}

export function isSessionDataEvent(event: GlobalEvent) {
  const kind = eventKind(event)
  return kind === "message.updated"
    || kind === "message.removed"
    || kind === "message.part.updated"
    || kind === "message.part.removed"
    || kind === "message.part.delta"
    || kind === "todo.updated"
    || kind === "session.diff"
}

export function isSnapshotPatchEvent(event: GlobalEvent) {
  const kind = eventKind(event)
  return kind === "session.updated"
    || kind === "session.deleted"
    || kind === "permission.asked"
    || kind === "permission.replied"
    || kind === "question.asked"
    || kind === "question.replied"
    || kind === "question.rejected"
}

export function isHighFrequencySessionEvent(event: GlobalEvent) {
  return eventKind(event).startsWith("session.next.")
}

export function globalEventAction(event: GlobalEvent): GlobalEventAction {
  const statusEvent = globalEventSessionStatus(event)
  if (statusEvent) return { type: "status", ...statusEvent }
  const stateEvent = globalEventSessionState(event)
  if (stateEvent) return { type: "state", ...stateEvent }
  if (isSessionDataEvent(event)) return { type: "session-data" }
  if (isSnapshotPatchEvent(event)) return { type: "snapshot" }
  if (isHighFrequencySessionEvent(event)) return { type: "ignore" }
  return { type: "refresh", sessionID: eventSessionID(event) }
}

export function patchBoundedSessionData(data: SessionData, event: GlobalEvent, limit: MessageWindow): SessionData {
  return trimToLiveTail(patchSessionData(data, event), limit)
}

export function mergeLiveSessionData(current: SessionData | undefined, incoming: SessionData): SessionData {
  if (!current) return incoming
  const currentMessages = new Map(current.messages.map((bundle) => [bundle.info.id, bundle]))
  return stableValue(current, {
    ...incoming,
    messages: incoming.messages.map((bundle) => {
      const existing = currentMessages.get(bundle.info.id)
      if (!existing) return bundle
      return { ...bundle, parts: mergeLoadedParts(existing.parts, bundle.parts) }
    }),
  })
}

export function patchSelectedSessionData(input: {
  data: SessionData
  loadedSessionID: string
  targetSessionID: string
  event: GlobalEvent
  limit: MessageWindow
  emptyData: SessionData
}) {
  return patchBoundedSessionData(
    input.loadedSessionID === input.targetSessionID ? input.data : input.emptyData,
    input.event,
    input.limit,
  )
}

export function patchVisibleViewSessionData(input: {
  data: Record<string, SessionData>
  sessionIDs: string[]
  event: GlobalEvent
  limit: MessageWindow
  emptyData: SessionData
}) {
  return input.sessionIDs.reduce((next, sessionID) => {
    const current = next[sessionID] ?? input.emptyData
    return setRecordEntry(next, sessionID, patchBoundedSessionData(current, input.event, input.limit))
  }, input.data)
}

export function markViewSessionsLoaded(current: Record<string, number>, sessionIDs: string[], time: number) {
  return sessionIDs.reduce((next, sessionID) => setRecordEntry(next, sessionID, time), current)
}

export function sessionDataEventTargets(event: GlobalEvent, context: {
  route: RouteLike
  activeViewSessions: Session[]
  loadedSessionID?: string
  loadedSessionData?: SessionData
  viewSessionData: Record<string, SessionData>
}): SessionDataEventTargets | undefined {
  if (!isSessionDataEvent(event)) return
  const sessionIDs = sessionDataEventSessionIDs(event, {
    currentSessionID: context.route.name === "session" ? context.route.sessionID : undefined,
    activeViewSessionIDs: context.route.name === "views" ? context.activeViewSessions.map((session) => session.id) : [],
    loadedSessionID: context.loadedSessionID,
    loadedSessionData: context.loadedSessionData,
    viewSessionData: context.viewSessionData,
  })

  return {
    selectedSessionID: context.route.name === "session" && context.route.sessionID && sessionIDs.has(context.route.sessionID) ? context.route.sessionID : undefined,
    visibleSessionIDs: context.route.name === "views" ? context.activeViewSessions.filter((session) => sessionIDs.has(session.id)).map((session) => session.id) : [],
  }
}

export function sessionDataEventSessionIDs(event: GlobalEvent, context: SessionDataEventRouteContext) {
  const sessionID = eventSessionID(event)
  if (sessionID) return new Set([sessionID])

  const aggregateID = eventAggregateID(event)
  if (aggregateID && (context.currentSessionID === aggregateID || context.activeViewSessionIDs?.includes(aggregateID))) return new Set([aggregateID])

  const messageID = eventMessageID(event)
  if (!messageID) return new Set<string>()

  return new Set([
    ...(context.loadedSessionID && context.loadedSessionData && sessionDataHasMessage(context.loadedSessionData, messageID) ? [context.loadedSessionID] : []),
    ...Object.entries(context.viewSessionData).flatMap(([viewSessionID, data]) => sessionDataHasMessage(data, messageID) ? [viewSessionID] : []),
  ])
}

export function patchSessionData(data: SessionData, event: GlobalEvent, options: SessionDataPatchOptions = {}): SessionData {
  const properties = eventData(event)
  if (!properties) return data
  switch (eventKind(event)) {
    case "message.updated":
      return { ...data, messages: upsertMessage(data.messages, (properties as { info: Message }).info, options) }
    case "message.removed": {
      forgetPendingMessageParts((properties as { messageID: string }).messageID)
      return { ...data, messages: data.messages.filter((bundle) => bundle.info.id !== (properties as { messageID: string }).messageID) }
    }
    case "message.part.updated":
      return { ...data, messages: upsertPart(data.messages, normalizeLivePart((properties as { part: Part }).part), options) }
    case "message.part.removed": {
      const removed = properties as { messageID: string; partID: string }
      forgetPendingPart(removed.messageID, removed.partID)
      return { ...data, messages: removePart(data.messages, removed.messageID, removed.partID) }
    }
    case "message.part.delta": {
      const delta = properties as { messageID: string; partID: string; field: string; delta: string }
      return { ...data, messages: applyPartDelta(data.messages, delta.messageID, delta.partID, delta.field, delta.delta, options) }
    }
    case "todo.updated":
      return { ...data, todos: (properties as { todos: Todo[] }).todos }
    case "session.diff":
      return { ...data, diffs: (properties as { diff: SnapshotFileDiff[] }).diff }
    default:
      return data
  }
}

function sessionDataHasMessage(data: SessionData, messageID: string) {
  return data.messages.some((bundle) => bundle.info.id === messageID)
}

export function patchSnapshot(snapshot: GuiSnapshot, event: GlobalEvent): GuiSnapshot {
  const properties = eventData(event)
  if (!properties) return snapshot
  switch (eventKind(event)) {
    case "session.updated":
      return patchSnapshotSession(snapshot, (properties as { info: Session }).info)
    case "session.deleted": {
      const deletedSessionID = (properties as { sessionID: string }).sessionID
      return {
        ...snapshot,
        sessions: snapshot.sessions.filter((session) => session.id !== deletedSessionID),
        projects: snapshot.projects.map((project) => ({
          ...project,
          sessions: project.sessions.filter((session) => session.id !== deletedSessionID),
        })),
        sessionStatus: Object.fromEntries(Object.entries(snapshot.sessionStatus).filter(([id]) => id !== deletedSessionID)),
        sessionUiState: Object.fromEntries(Object.entries(snapshot.sessionUiState).filter(([id]) => id !== deletedSessionID)),
        permissions: snapshot.permissions.filter((request) => request.sessionID !== deletedSessionID),
        questions: snapshot.questions.filter((request) => request.sessionID !== deletedSessionID),
      }
    }
    case "permission.asked": {
      const requestProperties = properties as PermissionRequest
      const request: PermissionRequest = {
        id: requestProperties.id,
        sessionID: requestProperties.sessionID,
        permission: requestProperties.permission,
        patterns: requestProperties.patterns,
        metadata: requestProperties.metadata,
        always: requestProperties.always,
        tool: requestProperties.tool,
      }
      return reconcileSessionUiState({ ...snapshot, permissions: upsertByID(snapshot.permissions, request) }, request.sessionID)
    }
    case "permission.replied": {
      const reply = properties as { requestID: string; sessionID?: string }
      const sessionID = reply.sessionID ?? snapshot.permissions.find((request) => request.id === reply.requestID)?.sessionID
      const next = { ...snapshot, permissions: snapshot.permissions.filter((request) => request.id !== reply.requestID) }
      return sessionID ? reconcileSessionUiState(next, sessionID) : next
    }
    case "question.asked": {
      const requestProperties = properties as QuestionRequest
      const request: QuestionRequest = {
        id: requestProperties.id,
        sessionID: requestProperties.sessionID,
        questions: requestProperties.questions,
        tool: requestProperties.tool,
      }
      return reconcileSessionUiState({ ...snapshot, questions: upsertByID(snapshot.questions, request) }, request.sessionID)
    }
    case "question.replied":
    case "question.rejected": {
      const reply = properties as { requestID: string; sessionID?: string }
      const sessionID = reply.sessionID ?? snapshot.questions.find((request) => request.id === reply.requestID)?.sessionID
      const next = { ...snapshot, questions: snapshot.questions.filter((request) => request.id !== reply.requestID) }
      return sessionID ? reconcileSessionUiState(next, sessionID) : next
    }
    default:
      return snapshot
  }
}

export function globalEventID(event: GlobalEvent) {
  const id = (event.payload as { id?: string }).id
  return typeof id === "string" ? id : undefined
}

export function eventAggregateID(event: GlobalEvent) {
  const id = (event.payload as { aggregateID?: string }).aggregateID
  return typeof id === "string" ? id : undefined
}

export function eventSessionID(event: GlobalEvent) {
  return sessionIDFrom(eventData(event))
}

export function globalEventSessionStatus(event: GlobalEvent) {
  const kind = eventKind(event)
  if (kind === "session.idle") {
    const sessionID = eventSessionID(event)
    return sessionID ? { sessionID, status: { type: "idle" } as GuiSnapshot["sessionStatus"][string], syncVisible: true } : undefined
  }

  if (kind !== "session.status") return
  const properties = eventData(event)
  if (!isRecordValue(properties) || typeof properties.sessionID !== "string" || !isSessionStatus(properties.status)) return
  return { sessionID: properties.sessionID, status: properties.status, syncVisible: properties.status.type === "idle" }
}

export function globalEventSessionState(event: GlobalEvent) {
  if (eventKind(event) !== "opencodex.session_state.updated") return
  const properties = eventData(event)
  if (!isRecordValue(properties) || typeof properties.sessionID !== "string" || !isRecordValue(properties.state)) return
  return { sessionID: properties.sessionID, state: properties.state as OpencodeXSessionState }
}

export function eventMessageID(event: GlobalEvent) {
  return messageIDFrom(eventData(event))
}

function stableValue<T>(current: T, next: T): T {
  return JSON.stringify(current) === JSON.stringify(next) ? current : next
}

function upsertMessage(messages: MessageBundle[], info: Message, options: SessionDataPatchOptions = {}) {
  const index = messages.findIndex((bundle) => bundle.info.id === info.id)
  if (index < 0 && options.appendMissingMessages === false) {
    forgetPendingMessageParts(info.id)
    return messages
  }
  const pendingParts = takePendingParts(info.id)
  const next = index >= 0
    ? messages.map((bundle, i) => i === index ? { ...bundle, info, parts: mergePartLists(bundle.parts, pendingParts) } : bundle)
    : [...messages, { info, parts: pendingParts }]
  return sortMessageBundles(next)
}

function upsertPart(messages: MessageBundle[], part: Part, options: SessionDataPatchOptions = {}) {
  const nextPart = applyPendingDeltasToPart(part)
  let found = false
  const next = messages.map((bundle) => {
    if (bundle.info.id !== nextPart.messageID) return bundle
    found = true
    forgetPendingPart(nextPart.messageID, nextPart.id)
    const parts = upsertPartList(bundle.parts, nextPart)
    return { ...bundle, parts }
  })
  if (found) return next
  if (options.appendMissingMessages === false) return messages
  rememberPendingPart(nextPart)
  return messages
}

function removePart(messages: MessageBundle[], messageID: string, partID: string) {
  return messages.map((bundle) => bundle.info.id === messageID
    ? { ...bundle, parts: bundle.parts.filter((part) => part.id !== partID) }
    : bundle)
}

function applyPartDelta(messages: MessageBundle[], messageID: string, partID: string, field: string, delta: string, options: SessionDataPatchOptions = {}) {
  if (field !== "text") {
    if (options.appendMissingMessages !== false) rememberPendingPartDelta(messageID, partID, field, delta)
    return messages
  }
  let found = false
  const next = messages.map((bundle) => {
    if (bundle.info.id !== messageID) return bundle
    return {
      ...bundle,
      parts: bundle.parts.map((part) => {
        if (part.id !== partID || (part.type !== "text" && part.type !== "reasoning")) return part
        found = true
        return { ...part, text: part.text + delta } as Part
      }),
    }
  })
  if (!found && options.appendMissingMessages !== false) rememberPendingPartDelta(messageID, partID, field, delta)
  return next
}

function normalizeLivePart(part: Part): Part {
  if (part.type !== "text" && part.type !== "reasoning") return part
  return { ...part, text: displayMessageText(part.text) } as Part
}

function mergePartLists(parts: Part[], incoming: Part[]) {
  if (incoming.length === 0) return parts
  let next = parts
  for (const part of incoming) next = upsertPartList(next, part)
  return next
}

function upsertPartList(parts: Part[], part: Part) {
  const index = parts.findIndex((item) => item.id === part.id)
  const next = index >= 0
    ? parts.map((item, i) => i === index ? mergeLivePart(item, part) : item)
    : [...parts, part]
  return sortParts(next)
}

function mergeLivePart(current: Part, incoming: Part): Part {
  if (!isTextPart(current) || !isTextPart(incoming)) return incoming
  if (textPartEnded(incoming)) return incoming
  if (!incoming.text) return current
  if (!current.text) return incoming
  if (incoming.text === current.text || incoming.text.startsWith(current.text)) return incoming
  if (current.text.startsWith(incoming.text) || current.text.endsWith(incoming.text)) return { ...incoming, text: current.text } as Part
  return { ...incoming, text: current.text + incoming.text } as Part
}

function mergeLoadedParts(current: Part[], incoming: Part[]) {
  const currentParts = new Map(current.map((part) => [part.id, part]))
  const incomingPartIDs = new Set(incoming.map((part) => part.id))
  return sortParts([
    ...incoming.map((part) => {
      const existing = currentParts.get(part.id)
      return existing ? mergeLivePart(existing, part) : part
    }),
    ...current.filter((part) => !incomingPartIDs.has(part.id) && isTextPart(part) && !textPartEnded(part)),
  ])
}

function isTextPart(part: Part): part is Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }> {
  return part.type === "text" || part.type === "reasoning"
}

function textPartEnded(part: Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }>) {
  return typeof part.time?.end === "number"
}

function sortParts(parts: Part[]) {
  return parts.toSorted((a, b) => a.id.localeCompare(b.id))
}

function rememberPendingPart(part: Part) {
  pendingLiveParts.set(part.messageID, upsertPartList(pendingLiveParts.get(part.messageID) ?? [], part))
}

function takePendingParts(messageID: string) {
  const parts = pendingLiveParts.get(messageID) ?? []
  pendingLiveParts.delete(messageID)
  return parts
}

function forgetPendingMessageParts(messageID: string) {
  pendingLiveParts.delete(messageID)
  pendingLivePartDeltas.delete(messageID)
}

function forgetPendingPart(messageID: string, partID: string) {
  const parts = pendingLiveParts.get(messageID)
  if (parts) {
    const next = parts.filter((part) => part.id !== partID)
    if (next.length > 0) pendingLiveParts.set(messageID, next)
    else pendingLiveParts.delete(messageID)
  }
  const deltas = pendingLivePartDeltas.get(messageID)
  if (!deltas) return
  for (const key of deltas.keys()) {
    if (key.startsWith(`${partID}\0`)) deltas.delete(key)
  }
  if (deltas.size === 0) pendingLivePartDeltas.delete(messageID)
}

function rememberPendingPartDelta(messageID: string, partID: string, field: string, delta: string) {
  const pending = pendingLiveParts.get(messageID)
  if (pending?.some((part) => part.id === partID)) {
    pendingLiveParts.set(messageID, pending.map((part) => part.id === partID ? applyDeltaToPart(part, field, delta) : part))
    return
  }
  const deltas = pendingLivePartDeltas.get(messageID) ?? new Map<string, string>()
  const key = pendingDeltaKey(partID, field)
  deltas.set(key, (deltas.get(key) ?? "") + delta)
  pendingLivePartDeltas.set(messageID, deltas)
}

function applyPendingDeltasToPart(part: Part): Part {
  const deltas = pendingLivePartDeltas.get(part.messageID)
  if (!deltas) return part
  let next = part
  for (const [key, delta] of deltas) {
    const [partID, field] = key.split("\0")
    if (partID !== part.id || !field) continue
    next = applyDeltaToPart(next, field, delta)
    deltas.delete(key)
  }
  if (deltas.size === 0) pendingLivePartDeltas.delete(part.messageID)
  return next
}

function applyDeltaToPart(part: Part, field: string, delta: string): Part {
  if (field !== "text" || (part.type !== "text" && part.type !== "reasoning")) return part
  return { ...part, text: part.text + delta } as Part
}

function pendingDeltaKey(partID: string, field: string) {
  return `${partID}\0${field}`
}

function sortMessageBundles(messages: MessageBundle[]) {
  return messages.toSorted((a, b) => (a.info.time.created ?? 0) - (b.info.time.created ?? 0))
}

function patchSnapshotSession(snapshot: GuiSnapshot, info: Session): GuiSnapshot {
  return reconcileSessionUiState({
    ...snapshot,
    sessions: upsertSession(snapshot.sessions, info),
    projects: snapshot.projects.map((project) => project.sessions.some((session) => session.id === info.id)
      ? { ...project, sessions: upsertSession(project.sessions, info) }
      : project),
    views: snapshot.views.map((view) => view.sessions.some((session) => session.id === info.id)
      ? { ...view, sessions: upsertSession(view.sessions, info) }
      : view),
  }, info.id)
}

function upsertSession<T extends Session>(sessions: T[], session: Session): T[] {
  if (!isRenderableSession(session)) return sessions.filter((item) => item.id !== session.id)
  const index = sessions.findIndex((item) => item.id === session.id)
  const next = index >= 0 ? sessions.map((item, i) => i === index ? { ...item, ...session } : item) : [...sessions, session as T]
  return next.toSorted((a, b) => b.time.updated - a.time.updated)
}

function upsertByID<T extends { id: string }>(items: T[], item: T) {
  return items.some((current) => current.id === item.id)
    ? items.map((current) => current.id === item.id ? item : current)
    : [...items, item]
}

export function eventKind(event: GlobalEvent) {
  const payload = event.payload as { type: string; name?: string }
  return payload.type === "sync" && payload.name ? payload.name.replace(/\.\d+$/, "") : payload.type
}

export function eventData(event: GlobalEvent) {
  const payload = event.payload as { properties?: Record<string, unknown>; data?: Record<string, unknown> }
  return payload.properties ?? payload.data
}

function sessionIDFrom(value: unknown) {
  if (!isRecordValue(value)) return
  if (typeof value.sessionID === "string") return value.sessionID
  if (isRecordValue(value.info) && typeof value.info.sessionID === "string") return value.info.sessionID
  if (isRecordValue(value.part) && typeof value.part.sessionID === "string") return value.part.sessionID
}

function messageIDFrom(value: unknown) {
  if (!isRecordValue(value)) return
  if (typeof value.messageID === "string") return value.messageID
  if (isRecordValue(value.info) && typeof value.info.id === "string") return value.info.id
  if (isRecordValue(value.part) && typeof value.part.messageID === "string") return value.part.messageID
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isSessionStatus(value: unknown): value is GuiSnapshot["sessionStatus"][string] {
  return isRecordValue(value) && typeof value.type === "string"
}

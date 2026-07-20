import type {
  GlobalEvent,
  Message,
  OpencodeXSessionState,
  Part,
  Session,
  SnapshotFileDiff,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import { trimToLiveTail, type MessageWindow } from "./message-window"
import { reconcileSessionUiState } from "./session-status"
import type { GuiSnapshot, MessageBundle, SessionCardSnapshot, SessionData } from "./store"
export { mergeLiveSessionData } from "./live-session-merge"
import { setRecordEntry } from "./view-pane-state"
import {
  eventAggregateID,
  eventData,
  eventKind,
  eventMessageID,
  eventSessionID,
  globalEventPayload,
  globalEventID,
  globalEventSessionState,
  globalEventSessionStatus,
} from "./live-session-event"
import {
  forgetPendingMessageParts,
  forgetPendingPart,
  normalizeLivePart,
} from "./live-session-parts"
import {
  applyPartDelta,
  removePart,
  stableValue,
  upsertByID,
  upsertMessage,
  upsertPart,
  type SessionDataPatchOptions,
} from "./live-session-patch-helpers"
export {
  eventAggregateID,
  eventData,
  eventKind,
  eventMessageID,
  eventSessionID,
  globalEventPayload,
  globalEventID,
  globalEventSessionState,
  globalEventSessionStatus,
} from "./live-session-event"
export { patchSnapshot } from "./live-snapshot-patch"

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
  | {
      type: "status"
      sessionID: string
      status: NonNullable<GuiSnapshot["sessionStatus"][string]>
      syncVisible: boolean
    }
  | { type: "state"; sessionID: string; state: OpencodeXSessionState }
  | { type: "session-data" }
  | { type: "snapshot" }
  | { type: "ignore" }
  | { type: "refresh"; root: boolean }

export type GlobalEventRefreshAction = { root: boolean }

export function runGlobalEventAction(
  action: GlobalEventAction,
  handlers: {
    applyStatus: (sessionID: string, status: NonNullable<GuiSnapshot["sessionStatus"][string]>) => void
    syncVisible: (sessionID: string) => void
    applyState: (sessionID: string, state: OpencodeXSessionState) => void
    applySessionData: () => void
    applySnapshot: () => void
  },
): GlobalEventRefreshAction | undefined {
  switch (action.type) {
    case "status":
      handlers.applyStatus(action.sessionID, action.status)
      if (action.syncVisible) handlers.syncVisible(action.sessionID)
      return undefined
    case "state":
      handlers.applyState(action.sessionID, action.state)
      return undefined
    case "session-data":
      handlers.applySessionData()
      return undefined
    case "snapshot":
      handlers.applySnapshot()
      return undefined
    case "ignore":
      return undefined
    case "refresh":
      return { root: action.root }
  }
  return undefined
}

export function applySessionStatusSnapshot(
  snapshot: GuiSnapshot | undefined,
  sessionID: string,
  status: NonNullable<GuiSnapshot["sessionStatus"][string]>,
) {
  if (!snapshot) return snapshot
  const next =
    status.type === "idle"
      ? {
          ...snapshot,
          sessionStatus: Object.fromEntries(Object.entries(snapshot.sessionStatus).filter(([id]) => id !== sessionID)),
        }
      : { ...snapshot, sessionStatus: { ...snapshot.sessionStatus, [sessionID]: status } }
  return reconcileSessionUiState(next, sessionID)
}

export function applySessionStateSnapshot(
  snapshot: GuiSnapshot | undefined,
  sessionID: string,
  state: OpencodeXSessionState,
) {
  if (!snapshot) return snapshot
  const existing = snapshot.sessionUiState[sessionID]
  return reconcileSessionUiState(
    {
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
    },
    sessionID,
  )
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
    stateRevision: next.stateRevision,
  }
  return snapshot.projects === merged.projects &&
    snapshot.sessions === merged.sessions &&
    snapshot.views === merged.views &&
    snapshot.sessionStatus === merged.sessionStatus &&
    snapshot.sessionUiState === merged.sessionUiState &&
    snapshot.permissions === merged.permissions &&
    snapshot.questions === merged.questions &&
    snapshot.stateRevision === merged.stateRevision
    ? snapshot
    : merged
}

export function isSessionDataEvent(event: GlobalEvent) {
  const kind = eventKind(event)
  return (
    kind === "message.updated" ||
    kind === "message.removed" ||
    kind === "message.part.updated" ||
    kind === "message.part.removed" ||
    kind === "message.part.delta" ||
    kind === "todo.updated" ||
    kind === "session.diff"
  )
}

export function isSnapshotPatchEvent(event: GlobalEvent) {
  const kind = eventKind(event)
  return (
    kind === "session.updated" ||
    kind === "session.deleted" ||
    kind === "permission.asked" ||
    kind === "permission.replied" ||
    kind === "question.asked" ||
    kind === "question.replied" ||
    kind === "question.rejected"
  )
}

export function isHighFrequencySessionEvent(event: GlobalEvent) {
  return eventKind(event).startsWith("session.next.")
}

export function isCapabilityRefreshEvent(event: GlobalEvent) {
  const kind = eventKind(event)
  return kind === "plugin.added" || kind === "lsp.updated" || kind === "mcp.tools.changed" || kind === "server.instance.disposed"
}

export function globalEventAction(event: GlobalEvent): GlobalEventAction {
  const statusEvent = globalEventSessionStatus(event)
  if (statusEvent) return { type: "status", ...statusEvent }
  const stateEvent = globalEventSessionState(event)
  if (stateEvent) return { type: "state", ...stateEvent }
  if (isSessionDataEvent(event)) return { type: "session-data" }
  if (isSnapshotPatchEvent(event)) return { type: "snapshot" }
  if (isHighFrequencySessionEvent(event)) return { type: "ignore" }
  if (isCapabilityRefreshEvent(event)) return { type: "refresh", root: eventKind(event) === "server.instance.disposed" }
  return { type: "ignore" }
}

export function patchBoundedSessionData(data: SessionData, event: GlobalEvent, limit: MessageWindow): SessionData {
  return trimToLiveTail(patchSessionData(data, event), limit)
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

export function sessionDataEventTargets(
  event: GlobalEvent,
  context: {
    route: RouteLike
    activeViewSessions: Session[]
    loadedSessionID?: string
    loadedSessionData?: SessionData
    viewSessionData: Record<string, SessionData>
  },
): SessionDataEventTargets | undefined {
  if (!isSessionDataEvent(event)) return
  const sessionIDs = sessionDataEventSessionIDs(event, {
    currentSessionID: context.route.name === "session" ? context.route.sessionID : undefined,
    activeViewSessionIDs: context.route.name === "views" ? context.activeViewSessions.map((session) => session.id) : [],
    loadedSessionID: context.loadedSessionID,
    loadedSessionData: context.loadedSessionData,
    viewSessionData: context.viewSessionData,
  })

  return {
    selectedSessionID:
      context.route.name === "session" && context.route.sessionID && sessionIDs.has(context.route.sessionID)
        ? context.route.sessionID
        : undefined,
    visibleSessionIDs:
      context.route.name === "views"
        ? context.activeViewSessions.filter((session) => sessionIDs.has(session.id)).map((session) => session.id)
        : [],
  }
}

export function sessionDataEventSessionIDs(event: GlobalEvent, context: SessionDataEventRouteContext) {
  const sessionID = eventSessionID(event)
  if (sessionID) return new Set([sessionID])

  const aggregateID = eventAggregateID(event)
  if (aggregateID && (context.currentSessionID === aggregateID || context.activeViewSessionIDs?.includes(aggregateID)))
    return new Set([aggregateID])

  const messageID = eventMessageID(event)
  if (!messageID) return new Set<string>()

  return new Set([
    ...(context.loadedSessionID &&
    context.loadedSessionData &&
    sessionDataHasMessage(context.loadedSessionData, messageID)
      ? [context.loadedSessionID]
      : []),
    ...Object.entries(context.viewSessionData).flatMap(([viewSessionID, data]) =>
      sessionDataHasMessage(data, messageID) ? [viewSessionID] : [],
    ),
  ])
}

export function patchSessionData(
  data: SessionData,
  event: GlobalEvent,
  options: SessionDataPatchOptions = {},
): SessionData {
  const properties = eventData(event)
  if (!properties) return data
  switch (eventKind(event)) {
    case "message.updated":
      return { ...data, messages: upsertMessage(data.messages, (properties as { info: Message }).info, options) }
    case "message.removed": {
      forgetPendingMessageParts((properties as { messageID: string }).messageID)
      return {
        ...data,
        messages: data.messages.filter((bundle) => bundle.info.id !== (properties as { messageID: string }).messageID),
      }
    }
    case "message.part.updated":
      return {
        ...data,
        messages: upsertPart(data.messages, normalizeLivePart((properties as { part: Part }).part), options),
      }
    case "message.part.removed": {
      const removed = properties as { messageID: string; partID: string }
      forgetPendingPart(removed.messageID, removed.partID)
      return { ...data, messages: removePart(data.messages, removed.messageID, removed.partID) }
    }
    case "message.part.delta": {
      const delta = properties as { messageID: string; partID: string; field: string; delta: string }
      return {
        ...data,
        messages: applyPartDelta(data.messages, delta.messageID, delta.partID, delta.field, delta.delta, options),
      }
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

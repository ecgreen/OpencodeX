import type { GlobalEvent, OpencodeXSessionState } from "@opencode-ai/sdk/v2/client"
import { eventKind, globalEventSessionState, globalEventSessionStatus } from "./live-session-event"
import type { GuiSnapshot, SessionCardSnapshot } from "./session-api"
export { mergeLiveSessionData } from "./live-session-merge"
export { globalEventID, globalEventPayload } from "./live-session-event"

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

/**
 * Projects the catalog the SDK just selected onto the live GUI snapshot, keeping
 * every array and record reference the renderer already holds whenever the
 * contents are unchanged.
 *
 * `selectClientStateSyncSnapshot` rebuilds each catalog array on every call, so
 * an `Object.is` fast path never fires and this runs on every catalog batch -
 * which is every streaming batch, since applying a session snapshot always
 * returns a fresh `state.sessions` wrapper. Deep-comparing the rebuilt arrays
 * there walks every field of every session. It is also unnecessary: the SDK
 * reconciles its entity records, so the rebuilt arrays hold the *same element
 * objects* whenever nothing changed, and per-element identity answers the
 * question exactly. Every compare below is therefore stricter than a deep one -
 * the worst case is one redundant render, never a stale card.
 *
 * Note for future edits: `stateRevision` (the SDK state digest) cannot be used
 * as a short-circuit key here. It only advances on a full catalog snapshot,
 * while session records are merged into the catalog by session-detail updates
 * that leave the digest untouched - keying on it would freeze session titles and
 * ordering until the next full snapshot.
 */
export function mergeSessionCardSnapshot(snapshot: GuiSnapshot, next: SessionCardSnapshot): GuiSnapshot {
  const merged = {
    ...snapshot,
    projects: stableGroups(snapshot.projects, next.projects),
    sessions: stableItems(snapshot.sessions, next.sessions),
    terminalSessions: stableItems(snapshot.terminalSessions, next.terminalSessions),
    views: stableGroups(snapshot.views, next.views),
    sessionStatus: stableRecord(snapshot.sessionStatus, next.sessionStatus),
    sessionUiState: stableRecord(snapshot.sessionUiState, next.sessionUiState),
    permissions: stableItems(snapshot.permissions, next.permissions),
    questions: stableItems(snapshot.questions, next.questions),
    stateRevision: next.stateRevision,
  }
  return snapshot.projects === merged.projects &&
    snapshot.sessions === merged.sessions &&
    snapshot.terminalSessions === merged.terminalSessions &&
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

export function isCapabilityRefreshEvent(event: GlobalEvent) {
  const kind = eventKind(event)
  return kind === "plugin.added" || kind === "lsp.updated" || kind === "mcp.tools.changed" || kind === "server.instance.disposed"
}

/**
 * Classifies a live event for the authoritative controller. Only `refresh` needs
 * client-side handling; everything else is projected from shared sync state.
 */
export function globalEventAction(event: GlobalEvent): GlobalEventAction {
  const statusEvent = globalEventSessionStatus(event)
  if (statusEvent) return { type: "status", ...statusEvent }
  const stateEvent = globalEventSessionState(event)
  if (stateEvent) return { type: "state", ...stateEvent }
  if (isSessionDataEvent(event)) return { type: "session-data" }
  if (isSnapshotPatchEvent(event)) return { type: "snapshot" }
  if (isCapabilityRefreshEvent(event)) return { type: "refresh", root: eventKind(event) === "server.instance.disposed" }
  return { type: "ignore" }
}

function stableItems<T>(current: T[], next: T[]) {
  return sameItems(current, next) ? current : next
}

function stableRecord<T>(current: Record<string, T>, next: Record<string, T>) {
  const keys = Object.keys(next)
  return keys.length === Object.keys(current).length && keys.every((key) => current[key] === next[key])
    ? current
    : next
}

function stableGroups<T extends object>(current: T[], next: T[]) {
  return current.length === next.length && current.every((item, index) => sameGroup(item, next[index]))
    ? current
    : next
}

function sameItems<T>(current: readonly T[], next: readonly T[]) {
  return current.length === next.length && current.every((item, index) => item === next[index])
}

/**
 * Projects and views are re-spread by the selector with freshly built `sessions`
 * and `terminalSessions` arrays, so whole-object identity never matches. Every
 * other field is copied straight off the SDK's reconciled record, so a shallow
 * compare that falls back to per-element identity for array fields is exact -
 * and it never descends into a session the way a deep compare would.
 */
function sameGroup(current: object, next?: object) {
  if (current === next) return true
  if (!next) return false
  const source = new Map<string, unknown>(Object.entries(current))
  const entries = Object.entries(next)
  if (entries.length !== source.size) return false
  return entries.every(([key, right]) => {
    if (!source.has(key)) return false
    const left = source.get(key)
    if (left === right) return true
    return Array.isArray(left) && Array.isArray(right) && sameItems(left, right)
  })
}

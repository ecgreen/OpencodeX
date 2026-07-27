import type { OpencodeXTerminalSession, OpencodeXViewMember, Session } from "@opencode-ai/sdk/v2/client"
import type { ClientCatalogView } from "@opencode-ai/sdk/v2/client-sync"

const PENDING_SESSION_ID = "pending:new-session"

export type PendingViewSession = {
  id: string
  projectID?: string
  projectLabel?: string
  directory?: string
}

export type ViewItem =
  | { kind: "session"; session: Session }
  | { kind: "terminal"; terminalSession: OpencodeXTerminalSession }
  | { kind: "pending"; slot: PendingViewSession }
export type ViewPaneOrderItem = { kind: "session" | "terminal" | "pending"; id: string }

export function pendingSession(directory: string): Session {
  const now = Date.now()
  return {
    id: PENDING_SESSION_ID,
    slug: PENDING_SESSION_ID,
    projectID: "",
    directory,
    title: "New session",
    version: "pending",
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: now, updated: now },
  }
}

export function viewItemSession(item: Exclude<ViewItem, { kind: "terminal" }>, fallbackDirectory?: string): Session {
  if (item.kind === "session") return item.session
  return pendingSession(item.slot.directory ?? fallbackDirectory ?? "")
}

export function pendingViewSessions(view?: Pick<ClientCatalogView, "metadata">): PendingViewSession[] {
  const opencodex = view?.metadata?.opencodex
  if (!isRecord(opencodex) || !Array.isArray(opencodex.pendingSessions)) return []
  return opencodex.pendingSessions.flatMap((item): PendingViewSession[] => {
    if (!isRecord(item) || typeof item.id !== "string") return []
    return [{
      id: item.id,
      ...(typeof item.projectID === "string" ? { projectID: item.projectID } : {}),
      ...(typeof item.projectLabel === "string" ? { projectLabel: item.projectLabel } : {}),
      ...(typeof item.directory === "string" ? { directory: item.directory } : {}),
    }]
  })
}

export function viewPaneOrder(view?: Pick<ClientCatalogView, "metadata">): ViewPaneOrderItem[] {
  const opencodex = view?.metadata?.opencodex
  if (!isRecord(opencodex) || !Array.isArray(opencodex.paneOrder)) return []
  return opencodex.paneOrder.flatMap((item): ViewPaneOrderItem[] =>
    isRecord(item) && (item.kind === "session" || item.kind === "terminal" || item.kind === "pending") && typeof item.id === "string" ? [{ kind: item.kind, id: item.id }] : [],
  )
}

export function metadataWithPendingSessions(metadata: Record<string, unknown> | undefined, pending: PendingViewSession[]) {
  const next = { ...(metadata ?? {}) }
  const opencodex = isRecord(next.opencodex) ? { ...next.opencodex } : {}
  if (pending.length > 0) {
    opencodex.pendingSessions = pending
    next.opencodex = opencodex
    return next
  }
  delete opencodex.pendingSessions
  if (Object.keys(opencodex).length > 0) next.opencodex = opencodex
  else delete next.opencodex
  return next
}

export function metadataWithViewPaneOrder(metadata: Record<string, unknown> | undefined, order: ViewPaneOrderItem[]) {
  const next = { ...(metadata ?? {}) }
  const opencodex = isRecord(next.opencodex) ? { ...next.opencodex } : {}
  if (order.length > 0) {
    opencodex.paneOrder = order
    next.opencodex = opencodex
    return next
  }
  delete opencodex.paneOrder
  if (Object.keys(opencodex).length > 0) next.opencodex = opencodex
  else delete next.opencodex
  return next
}

export function orderedViewItems(view: ClientCatalogView | undefined, sessions: Session[]) {
  const items: ViewItem[] = [
    ...sessions.map((session): ViewItem => ({ kind: "session", session })),
    ...(view?.terminalSessions ?? []).map((terminalSession): ViewItem => ({ kind: "terminal", terminalSession })),
    ...pendingViewSessions(view).map((slot): ViewItem => ({ kind: "pending", slot })),
  ]
  const byKey = new Map(items.map((item) => [`${item.kind}:${viewItemID(item)}`, item]))
  const persisted = viewPaneOrder(view)
  const order = persisted.length > 0
    ? persisted
    : [
        ...persistedViewMembers(view),
        ...pendingViewSessions(view).map((slot): ViewPaneOrderItem => ({ kind: "pending", id: slot.id })),
      ]
  const ordered = order.flatMap((item) => byKey.get(`${item.kind}:${item.id}`) ?? [])
  const included = new Set(ordered.map(viewItemID))
  return [...ordered, ...items.filter((item) => !included.has(viewItemID(item)))].slice(0, 8)
}

export function replacePendingViewPane(view: ClientCatalogView, pendingID: string, sessionID: string, pending: PendingViewSession[]) {
  const persisted = viewPaneOrder(view)
  const current = persisted.length > 0 ? persisted : [
    ...persistedViewMembers(view),
    ...pendingViewSessions(view).map((slot): ViewPaneOrderItem => ({ kind: "pending", id: slot.id })),
  ]
  const order = current.map((item): ViewPaneOrderItem => item.kind === "pending" && item.id === pendingID ? { kind: "session", id: sessionID } : item)
  const members = order.filter((item): item is OpencodeXViewMember => item.kind !== "pending")
  // A stale pane order (written by another client) must never shrink the view:
  // append any persisted member the order does not mention, mirroring the
  // tolerance in orderedViewItems.
  const known = new Set(members.map((member) => `${member.kind}:${member.id}`))
  for (const member of persistedViewMembers(view)) {
    const key = `${member.kind}:${member.id}`
    if (known.has(key)) continue
    known.add(key)
    members.push(member)
  }
  return {
    members,
    metadata: metadataWithViewPaneOrder(metadataWithPendingSessions(view.metadata, pending), order),
  }
}

export function viewItemID(item: ViewItem) {
  if (item.kind === "session") return item.session.id
  if (item.kind === "terminal") return item.terminalSession.id
  return item.slot.id
}

export function viewItemsMembershipKey(viewID: string | undefined, items: ViewItem[]) {
  if (!viewID) return ""
  return [viewID, ...items.map((item) => viewItemID(item))].join("\n")
}

export function viewSessionsSyncKey(viewID: string | undefined, sessions: Session[]) {
  if (!viewID) return ""
  return [viewID, ...sessions.map((session) => `${session.id}:${session.directory ?? ""}:${session.time.updated}`)].join("\n")
}

function persistedViewMembers(view?: ClientCatalogView): OpencodeXViewMember[] {
  return view?.members ?? (view?.sessionIDs ?? []).map((id) => ({ kind: "session", id }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"

const PENDING_SESSION_ID = "pending:new-session"

export type PendingViewSession = {
  id: string
  projectID?: string
  projectLabel?: string
  directory?: string
}

export type ViewItem = { kind: "session"; session: Session } | { kind: "pending"; slot: PendingViewSession }

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

export function viewItemSession(item: ViewItem, fallbackDirectory?: string): Session {
  if (item.kind === "session") return item.session
  return pendingSession(item.slot.directory ?? fallbackDirectory ?? "")
}

export function pendingViewSessions(view?: Pick<OpencodeXView, "metadata">): PendingViewSession[] {
  const opencodex = view?.metadata?.opencodex
  if (!isRecord(opencodex) || !Array.isArray(opencodex.pendingSessions)) return []
  return opencodex.pendingSessions.flatMap((item): PendingViewSession[] => {
    if (!isRecord(item) || typeof item.id !== "string") return []
    return [{
      id: item.id,
      projectID: typeof item.projectID === "string" ? item.projectID : undefined,
      projectLabel: typeof item.projectLabel === "string" ? item.projectLabel : undefined,
      directory: typeof item.directory === "string" ? item.directory : undefined,
    }]
  })
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

export function viewItemID(item: ViewItem) {
  return item.kind === "session" ? item.session.id : item.slot.id
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

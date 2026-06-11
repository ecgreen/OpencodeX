import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import { pendingViewSessions, type PendingViewSession } from "./view-items"

export type ViewSelection = { kind: "existing"; sessionID: string } | { kind: "pending"; slot: PendingViewSession }

export function initialViewSelection(view?: OpencodeXView): ViewSelection[] {
  return [
    ...(view?.sessionIDs ?? []).map((sessionID): ViewSelection => ({ kind: "existing", sessionID })),
    ...pendingViewSessions(view).map((slot): ViewSelection => ({ kind: "pending", slot })),
  ].slice(0, 8)
}

export function selectedViewSessionIDs(selection: ViewSelection[]) {
  return selection
    .filter((item): item is { kind: "existing"; sessionID: string } => item.kind === "existing")
    .map((item) => item.sessionID)
}

export function selectedPendingViewSessions(selection: ViewSelection[]) {
  return selection
    .filter((item): item is { kind: "pending"; slot: PendingViewSession } => item.kind === "pending")
    .map((item) => item.slot)
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

export function viewTitle(input: { title: string; selection: ViewSelection[]; sessions: Session[] }) {
  const trimmed = input.title.trim()
  if (trimmed) return trimmed
  const sessionIDs = selectedViewSessionIDs(input.selection)
  const first = input.sessions.find((session) => session.id === sessionIDs[0])
  if (first && input.selection.length === 1) return first.title
  return `${input.selection.length} session view`
}

export function addPendingViewSessions(input: {
  selection: ViewSelection[]
  count: number
  projectID?: string
  projectLabel?: string
  directory?: string
  now?: number
}) {
  const available = Math.max(0, 8 - input.selection.length)
  const count = Math.min(Math.max(0, input.count), available)
  const stamp = input.now ?? Date.now()
  return [
    ...input.selection,
    ...Array.from({ length: count }, (_, index): ViewSelection => ({
      kind: "pending",
      slot: {
        id: `new:${input.projectID ?? "none"}:${stamp}:${index}`,
        projectID: input.projectID,
        projectLabel: input.projectLabel,
        directory: input.directory,
      },
    })),
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

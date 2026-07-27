import { SessionID } from "@/session/schema"
import { Schema } from "effect"

export const Member = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("session"), id: SessionID }),
  Schema.Struct({ kind: Schema.Literal("terminal"), id: Schema.String }),
]).annotate({ identifier: "OpencodeXViewMember" })
export type Member = Schema.Schema.Type<typeof Member>

export function normalizeMembers(members: readonly Member[]) {
  const seen = new Set<string>()
  return members.filter((member) => {
    const key = `${member.kind}:${member.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function sessionMembers(sessionIDs: readonly SessionID[]) {
  return [...new Set(sessionIDs)].map((id) => ({ kind: "session" as const, id }))
}

export function replaceLegacySessionSlots(members: readonly Member[], sessionIDs: readonly SessionID[]) {
  const requested = sessionMembers(sessionIDs)
  const retained = members
    .map((member) => (member.kind === "terminal" ? member : requested.shift()))
    .filter((member): member is Member => member !== undefined)
  return [...retained, ...requested]
}

export function pendingMemberCount(metadata: Record<string, unknown> | undefined) {
  const opencodex = metadata?.opencodex
  if (typeof opencodex !== "object" || opencodex === null || Array.isArray(opencodex)) return 0
  const pending = "pendingSessions" in opencodex ? opencodex.pendingSessions : undefined
  return Array.isArray(pending) ? pending.length : 0
}

export function memberValidationMessage(members: readonly Member[], metadata: Record<string, unknown> | undefined) {
  const pending = pendingMemberCount(metadata)
  if (members.length === 0 && pending === 0) return "A view needs at least one member."
  if (members.length + pending > 8) return "A view can include at most eight persisted and pending members."
  return undefined
}

export function resolveFocus(
  members: readonly Member[],
  requestedItemID?: string,
  requestedSessionID?: SessionID,
) {
  const focused =
    members.find((member) => member.id === requestedItemID) ??
    members.find((member) => member.kind === "session" && member.id === requestedSessionID) ??
    members[0]
  const firstSession = members.find((member) => member.kind === "session")
  return {
    focusedItemID: focused?.id,
    focusedSessionID: focused?.kind === "session" ? focused.id : firstSession?.id,
  }
}

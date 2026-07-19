import type { Session } from "@opencode-ai/sdk/v2/client"
import { isRenderableSession } from "./session-filter"

export const MRU_SESSIONS_STORAGE_KEY = "opencodex.gui.mru-sessions"
export const MRU_SESSIONS_LIMIT = 20

export function touchMruSession(list: readonly string[], sessionID: string, limit = MRU_SESSIONS_LIMIT) {
  return [sessionID, ...list.filter((id) => id !== sessionID)].slice(0, limit)
}

export function pruneMruSessions(list: readonly string[], validIDs: ReadonlySet<string>) {
  const pruned = list.filter((id) => validIDs.has(id))
  return pruned.length === list.length ? list : pruned
}

export function mruSessionCandidates(list: readonly string[], sessions: readonly Session[]) {
  const available = sessions.filter(isRenderableSession)
  const byID = new Map(available.map((session) => [session.id, session]))
  const recent = list.flatMap((sessionID) => {
    const session = byID.get(sessionID)
    return session ? [session] : []
  })
  const included = new Set(recent.map((session) => session.id))
  return [...recent, ...available.filter((session) => !included.has(session.id))]
}

export function moveMruCursor(cursor: number, direction: 1 | -1, count: number) {
  if (count <= 0) return 0
  return (cursor + direction + count) % count
}

// Cursor when the switcher first opens: the entry after the current session,
// or the most recent entry when the current route is not a listed session.
export function initialMruCursor(currentSessionID: string | undefined, sessionIDs: readonly string[], direction: 1 | -1) {
  if (sessionIDs.length === 0) return 0
  const currentIndex = currentSessionID ? sessionIDs.indexOf(currentSessionID) : -1
  if (currentIndex < 0) return direction === 1 ? 0 : sessionIDs.length - 1
  return moveMruCursor(currentIndex, direction, sessionIDs.length)
}

export function loadMruSessions(storageKey = MRU_SESSIONS_STORAGE_KEY): string[] {
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === "string")
  } catch {
    return []
  }
}

export function saveMruSessions(list: readonly string[], storageKey = MRU_SESSIONS_STORAGE_KEY) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(storageKey, JSON.stringify(list))
  } catch {
    return
  }
}

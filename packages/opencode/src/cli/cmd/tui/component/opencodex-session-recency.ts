const RECENT_SESSION_WINDOW_MS = 4 * 60 * 60 * 1000
export const PROJECT_RECENT_SESSION_LIMIT = 4

export function isRecentSessionUpdate(timeUpdated: number, now = Date.now()) {
  return timeUpdated >= now - RECENT_SESSION_WINDOW_MS
}

export function recentProjectItems<T>(items: T[], timeUpdated: (item: T) => number, now = Date.now()) {
  const sorted = items.toSorted((a, b) => timeUpdated(b) - timeUpdated(a))
  const recent = sorted.filter((item) => isRecentSessionUpdate(timeUpdated(item), now))
  if (recent.length >= PROJECT_RECENT_SESSION_LIMIT) return recent
  return sorted.slice(0, PROJECT_RECENT_SESSION_LIMIT)
}

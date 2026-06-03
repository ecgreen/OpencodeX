const RECENT_SESSION_WINDOW_MS = 4 * 60 * 60 * 1000

export function isRecentSessionUpdate(timeUpdated: number, now = Date.now()) {
  return timeUpdated >= now - RECENT_SESSION_WINDOW_MS
}

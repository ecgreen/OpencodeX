export async function syncViewSessionsInParallel<T extends { id: string }>(
  sessions: readonly T[],
  focusedSessionID: string,
  syncSession: (session: T) => Promise<void>,
) {
  await Promise.all(orderViewSessionsForSync(sessions, focusedSessionID).map((session) => syncSession(session)))
}

export function orderViewSessionsForSync<T extends { id: string }>(sessions: readonly T[], focusedSessionID: string) {
  const focused = sessions.find((session) => session.id === focusedSessionID)
  if (!focused) return [...sessions]
  return [focused, ...sessions.filter((session) => session.id !== focused.id)]
}

export function viewSessionsInOrder<T extends { id: string }>(view?: { sessionIDs: readonly string[]; sessions: readonly T[] }) {
  if (!view) return []
  const byID = new Map(view.sessions.map((session) => [session.id, session]))
  return view.sessionIDs
    .map((sessionID) => byID.get(sessionID))
    .filter((session): session is T => session !== undefined)
}

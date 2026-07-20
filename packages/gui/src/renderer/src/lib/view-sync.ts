export async function syncViewSessionsInParallel<T extends { id: string }>(
  sessions: readonly T[],
  focusedSessionID: string,
  syncSession: (session: T) => Promise<void>,
  signal?: AbortSignal,
) {
  const failures = new Array<{ sessionID: string; cause: unknown }>()
  const ordered = orderViewSessionsForSync(sessions, focusedSessionID)
  const focused = ordered[0]?.id === focusedSessionID ? ordered[0] : undefined
  if (focused) {
    if (signal?.aborted) return failures
    try {
      await syncSession(focused)
    } catch (cause) {
      if (!signal?.aborted && !(cause instanceof Error && cause.name === "AbortError"))
        failures.push({ sessionID: focused.id, cause })
    }
  }

  const queued = focused ? ordered.slice(1) : ordered
  let next = 0
  async function worker(): Promise<void> {
    if (signal?.aborted) return
    const session = queued[next]
    next += 1
    if (!session) return
    try {
      await syncSession(session)
    } catch (cause) {
      if (!signal?.aborted && !(cause instanceof Error && cause.name === "AbortError"))
        failures.push({ sessionID: session.id, cause })
    }
    await worker()
  }

  await Promise.all(Array.from({ length: Math.min(2, queued.length) }, worker))
  return failures
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

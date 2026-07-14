export type SessionPresentationController = {
  setVisible: (sessionIDs: readonly string[]) => string[]
  remember: (sessionID: string) => string[]
  touch: (sessionID: string) => void
  reconcile: (scope: string, availableSessionIDs: ReadonlySet<string>) => string[]
  load: <T>(sessionID: string, key: string, loader: () => Promise<T>) => Promise<T>
  cachedSessionIDs: () => string[]
  visibleSessionIDs: () => string[]
}

export function createSessionPresentationController(
  options: { inactiveLimit?: number } = {},
): SessionPresentationController {
  const inactiveLimit = Math.max(0, options.inactiveLimit ?? 16)
  const visible = new Set<string>()
  const access = new Map<string, number>()
  const loads = new Map<string, Promise<unknown>>()
  let scope = ""
  let clock = 0

  const evict = () => {
    const inactive = [...access]
      .filter(([sessionID]) => !visible.has(sessionID))
      .sort((a, b) => a[1] - b[1])
    const evicted = inactive.slice(0, Math.max(0, inactive.length - inactiveLimit)).map(([sessionID]) => sessionID)
    evicted.forEach((sessionID) => access.delete(sessionID))
    return evicted
  }

  return {
    setVisible(sessionIDs) {
      visible.clear()
      sessionIDs.forEach((sessionID) => {
        visible.add(sessionID)
        if (access.has(sessionID)) access.set(sessionID, ++clock)
      })
      return evict()
    },
    remember(sessionID) {
      access.set(sessionID, ++clock)
      return evict()
    },
    touch(sessionID) {
      if (access.has(sessionID)) access.set(sessionID, ++clock)
    },
    reconcile(nextScope, availableSessionIDs) {
      if (scope !== nextScope) {
        const evicted = [...access.keys()]
        scope = nextScope
        visible.clear()
        access.clear()
        loads.clear()
        return evicted
      }
      const evicted = [...access.keys()].filter((sessionID) => !availableSessionIDs.has(sessionID))
      evicted.forEach((sessionID) => {
        visible.delete(sessionID)
        access.delete(sessionID)
      })
      ;[...loads.keys()]
        .filter((key) => !availableSessionIDs.has(key.slice(0, key.indexOf("\n"))))
        .forEach((key) => loads.delete(key))
      return evicted
    },
    load(sessionID, key, loader) {
      const loadKey = `${sessionID}\n${key}`
      const existing = loads.get(loadKey) as Promise<Awaited<ReturnType<typeof loader>>> | undefined
      if (existing) return existing
      const promise = loader().finally(() => {
        if (loads.get(loadKey) === promise) loads.delete(loadKey)
      })
      loads.set(loadKey, promise)
      return promise
    },
    cachedSessionIDs: () => [...access.keys()],
    visibleSessionIDs: () => [...visible],
  }
}

export type SessionPresentationController = {
  setVisible: (sessionIDs: readonly string[]) => string[]
  remember: (sessionID: string) => string[]
  touch: (sessionID: string) => void
  reconcile: (scope: string, availableSessionIDs: ReadonlySet<string>) => string[]
  load: <T>(sessionID: string, key: string, loader: (signal: AbortSignal) => Promise<T>) => Promise<T>
  cachedSessionIDs: () => string[]
  visibleSessionIDs: () => string[]
}

export function createSessionPresentationController(
  options: { inactiveLimit?: number } = {},
): SessionPresentationController {
  const inactiveLimit = Math.max(0, options.inactiveLimit ?? 16)
  const visible = new Set<string>()
  const access = new Map<string, number>()
  const loads = new Map<string, { sessionID: string; controller: AbortController; promise: Promise<unknown> }>()
  let scope = ""
  let clock = 0

  const evict = () => {
    const inactive = [...access]
      .filter(([sessionID]) => !visible.has(sessionID))
      .sort((a, b) => a[1] - b[1])
    const evicted = inactive.slice(0, Math.max(0, inactive.length - inactiveLimit)).map(([sessionID]) => sessionID)
    evicted.forEach((sessionID) => {
      access.delete(sessionID)
      abortLoads(sessionID)
    })
    return evicted
  }

  const abortLoads = (sessionID?: string) => {
    loads.forEach((load, key) => {
      if (sessionID !== undefined && load.sessionID !== sessionID) return
      load.controller.abort()
      loads.delete(key)
    })
  }

  return {
    setVisible(sessionIDs) {
      const next = new Set(sessionIDs)
      visible.forEach((sessionID) => {
        if (!next.has(sessionID)) abortLoads(sessionID)
      })
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
        const evicted = [...new Set([...access.keys(), ...visible])]
        scope = nextScope
        visible.clear()
        access.clear()
        abortLoads()
        return evicted
      }
      const evicted = [...new Set([...access.keys(), ...visible])].filter(
        (sessionID) => !availableSessionIDs.has(sessionID),
      )
      evicted.forEach((sessionID) => {
        visible.delete(sessionID)
        access.delete(sessionID)
        abortLoads(sessionID)
      })
      return evicted
    },
    load(sessionID, key, loader) {
      const loadKey = `${sessionID}\n${key}`
      const existing = loads.get(loadKey)
      if (existing) return existing.promise as Promise<Awaited<ReturnType<typeof loader>>>
      const controller = new AbortController()
      const promise = loader(controller.signal).then((result) => {
        if (controller.signal.aborted) throw abortError(controller.signal)
        return result
      }).finally(() => {
        if (loads.get(loadKey)?.promise === promise) loads.delete(loadKey)
      })
      loads.set(loadKey, { sessionID, controller, promise })
      return promise
    },
    cachedSessionIDs: () => [...access.keys()],
    visibleSessionIDs: () => [...visible],
  }
}

export function createDeferredSessionRelease(input: {
  release: (sessionID: string) => void
  retained: (sessionID: string) => boolean
}) {
  const pending = new Set<string>()
  let queued = false
  return (sessionIDs: readonly string[]) => {
    sessionIDs.forEach((sessionID) => pending.add(sessionID))
    if (queued || pending.size === 0) return
    queued = true
    queueMicrotask(() => {
      queued = false
      const sessionIDs = [...pending]
      pending.clear()
      sessionIDs.forEach((sessionID) => {
        if (!input.retained(sessionID)) input.release(sessionID)
      })
    })
  }
}

function abortError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error("Session presentation load was aborted")
  error.name = "AbortError"
  return error
}

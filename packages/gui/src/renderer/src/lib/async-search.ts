import { createDebouncedTask, type DeferredTimer } from "./deferred-work"

export function createExpiringLruCache<K, V>(input: {
  maxEntries?: number
  ttlMs?: number
  now?: () => number
} = {}) {
  const values = new Map<K, { value: V; expires: number }>()
  const maxEntries = input.maxEntries ?? 64
  const ttlMs = input.ttlMs ?? 30_000
  const now = input.now ?? Date.now

  return {
    get(key: K) {
      const entry = values.get(key)
      if (!entry) return
      if (entry.expires <= now()) {
        values.delete(key)
        return
      }
      values.delete(key)
      values.set(key, entry)
      return entry.value
    },
    set(key: K, value: V) {
      values.delete(key)
      values.set(key, { value, expires: now() + ttlMs })
      while (values.size > maxEntries) values.delete(values.keys().next().value as K)
    },
    clear() {
      values.clear()
    },
    size: () => values.size,
  }
}

export function createDebouncedSearch<TQuery, TValue>(input: {
  key: (query: TQuery) => string
  load: (query: TQuery, signal: AbortSignal) => Promise<TValue>
  success: (value: TValue, query: TQuery) => void
  loading?: (query: TQuery) => void
  error?: (cause: unknown, query: TQuery) => void
  delayMs?: number
  maxEntries?: number
  ttlMs?: number
  now?: () => number
  timer?: DeferredTimer
}) {
  const cache = createExpiringLruCache<string, TValue>({
    maxEntries: input.maxEntries,
    ttlMs: input.ttlMs,
    now: input.now,
  })
  let generation = 0
  let active: { key: string; controller: AbortController } | undefined

  const debounce = createDebouncedTask<TQuery>((query) => {
    const key = input.key(query)
    const controller = new AbortController()
    const request = { key, controller }
    const currentGeneration = generation
    active = request
    void input.load(query, controller.signal).then(
      (value) => {
        if (active === request) active = undefined
        if (controller.signal.aborted || currentGeneration !== generation) return
        cache.set(key, value)
        input.success(value, query)
      },
      (cause) => {
        if (active === request) active = undefined
        if (controller.signal.aborted || currentGeneration !== generation) return
        input.error?.(cause, query)
      },
    )
  }, input.delayMs ?? 120, input.timer)

  function clear() {
    generation++
    debounce.cancel()
    active?.controller.abort()
    active = undefined
  }

  return {
    search(query: TQuery) {
      const key = input.key(query)
      const cached = cache.get(key)
      if (cached !== undefined) {
        clear()
        input.success(cached, query)
        return
      }
      if (active?.key === key) return
      generation++
      active?.controller.abort()
      active = undefined
      input.loading?.(query)
      debounce.schedule(query)
    },
    clear,
    dispose() {
      clear()
      cache.clear()
    },
    cacheSize: cache.size,
  }
}

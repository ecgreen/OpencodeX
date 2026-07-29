export type ClientSeenIdRing = {
  /** Records an id. Returns false when the id was already present. */
  remember: (id: string) => boolean
  has: (id: string) => boolean
  clear: () => void
  readonly size: number
}

/**
 * Bounded "have I already seen this id" set.
 *
 * A `Set` plus a plain array degrades badly at capacity: `Array.shift()` is
 * O(n) and runs on every event once the window is full. This keeps the same
 * eviction order with a fixed circular buffer, so both insert and evict are
 * O(1) and no allocation happens in the steady state.
 */
export function createClientSeenIdRing(capacity: number): ClientSeenIdRing {
  const limit = Math.max(1, Math.floor(capacity))
  const slots = new Array<string | undefined>(limit).fill(undefined)
  const seen = new Set<string>()
  let cursor = 0
  return {
    remember(id: string) {
      if (seen.has(id)) return false
      const stale = slots[cursor]
      if (stale !== undefined) seen.delete(stale)
      slots[cursor] = id
      cursor = (cursor + 1) % limit
      seen.add(id)
      return true
    },
    has(id: string) {
      return seen.has(id)
    },
    clear() {
      seen.clear()
      slots.fill(undefined)
      cursor = 0
    },
    get size() {
      return seen.size
    },
  }
}

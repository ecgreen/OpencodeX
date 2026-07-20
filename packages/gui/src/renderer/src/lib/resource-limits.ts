export function touchBoundedLRU<Key>(
  order: readonly Key[],
  key: Key,
  limit: number,
  protectedKeys: ReadonlySet<Key> = new Set(),
) {
  const touched = [...order.filter((item) => item !== key), key]
  const evicted = touched
    .filter((item) => !protectedKeys.has(item))
    .slice(0, Math.max(0, touched.length - limit))
  const removed = new Set(evicted)
  return { order: touched.filter((item) => !removed.has(item)), evicted }
}

export function updateBoundedLRUEntries<Key, Value>(
  entries: readonly (readonly [Key, Value])[],
  key: Key,
  value: Value,
  limit: number,
) {
  const next = [...entries.filter(([item]) => item !== key), [key, value] as const]
  const evicted = next.slice(0, Math.max(0, next.length - limit))
  return { entries: next.slice(evicted.length), evicted }
}

export function updateWeightedLRUEntries<Key, Value>(input: {
  entries: readonly (readonly [Key, Value])[]
  key: Key
  value: Value
  maxEntries: number
  maxWeight: number
  weight: (value: Value) => number
}) {
  const entries = [...input.entries.filter(([key]) => key !== input.key), [input.key, input.value] as const]
  const evicted: Array<readonly [Key, Value]> = []
  let weight = entries.reduce((total, entry) => total + input.weight(entry[1]), 0)
  while (entries.length > input.maxEntries || weight > input.maxWeight) {
    const entry = entries.shift()
    if (!entry) break
    evicted.push(entry)
    weight -= input.weight(entry[1])
  }
  return { entries, evicted, weight }
}

export function reserveOpenTabSlot<T>(input: {
  tabs: readonly T[]
  active: T | undefined
  clean: (tab: T) => boolean
  limit: number
}) {
  const removeCount = Math.max(0, input.tabs.length - input.limit + 1)
  const evicted = input.tabs.filter((tab) => tab !== input.active && input.clean(tab)).slice(0, removeCount)
  const removed = new Set(evicted)
  return {
    tabs: input.tabs.filter((tab) => !removed.has(tab)),
    evicted,
    available: evicted.length === removeCount,
  }
}

export function sessionReplacementCleanupTabs<T>(tabs: readonly T[], transfer: boolean) {
  return transfer ? [] : [...tabs]
}

export function updateBoundedExplorerCache<T>(input: {
  cache: Readonly<Record<string, T[]>>
  order: readonly string[]
  path: string
  nodes: readonly T[]
  maxFolders: number
  maxNodes: number
  protectedPaths?: ReadonlySet<string>
}) {
  const cache: Record<string, T[]> = { ...input.cache, [input.path]: input.nodes.slice(0, input.maxNodes) }
  const order = [...input.order.filter((path) => path !== input.path), input.path]
  const count = () => Object.values(cache).reduce((total, nodes) => total + nodes.length, 0)
  const evicted: string[] = []
  while (order.length > input.maxFolders || count() > input.maxNodes) {
    const index = order.findIndex((path) => path !== input.path && !input.protectedPaths?.has(path))
    if (index < 0) break
    const [path] = order.splice(index, 1)
    delete cache[path]
    evicted.push(path)
  }
  return { cache, order, evicted }
}

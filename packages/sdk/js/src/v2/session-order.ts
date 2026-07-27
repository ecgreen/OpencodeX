export type ClientSessionOrderBucket = "input_needed" | "ready_for_review" | "in_progress" | "inactive"

export type ClientSessionOrderInput = {
  id: string
  bucket: ClientSessionOrderBucket
  timeUpdated: number
  timeCreated?: number
}

export type ClientSessionOrderState = {
  entries: Record<string, ClientSessionOrderEntry>
  nextOrder: number
}

export type ClientSessionOrderEntry = {
  bucket: ClientSessionOrderBucket
  order: number
}

export const CLIENT_RECENT_SESSION_WINDOW_MS = 4 * 60 * 60 * 1000
export const CLIENT_PROJECT_RECENT_SESSION_LIMIT = 4

export function emptyClientSessionOrderState(): ClientSessionOrderState {
  return { entries: {}, nextOrder: 0 }
}

export function clientSessionOrderBucketForStatus(status: string | undefined): ClientSessionOrderBucket {
  if (status === "input_needed") return "input_needed"
  if (status === "ready_for_review" || status === "needs_review" || status === "review_ready" || status === "unviewed")
    return "ready_for_review"
  if (status === "in_progress") return "in_progress"
  return "inactive"
}

export function reconcileClientSessionOrderState(
  state: ClientSessionOrderState,
  items: readonly ClientSessionOrderInput[],
): ClientSessionOrderState {
  const active = items.filter((item) => item.bucket !== "inactive")
  const entrants = active.filter((item) => state.entries[item.id]?.bucket !== item.bucket)
  const baseOrder = state.nextOrder - entrants.length
  let entrantIndex = 0
  return {
    entries: Object.fromEntries(
      active.map((item) => {
        const current = state.entries[item.id]
        if (current?.bucket === item.bucket) return [item.id, current]
        const entry = { bucket: item.bucket, order: baseOrder + entrantIndex }
        entrantIndex += 1
        return [item.id, entry]
      }),
    ),
    nextOrder: baseOrder,
  }
}

export function orderClientSessionItems<T extends ClientSessionOrderInput>(
  items: readonly T[],
  state: ClientSessionOrderState,
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const bucket = clientSessionOrderBucketRank(left.item.bucket) - clientSessionOrderBucketRank(right.item.bucket)
      if (bucket !== 0) return bucket
      if (left.item.bucket === "inactive")
        return compareClientSessionTimeDesc(left.item, right.item) || left.index - right.index
      const order =
        clientSessionOrderEntryOrder(state, left.item, left.index) -
        clientSessionOrderEntryOrder(state, right.item, right.index)
      return order || left.index - right.index
    })
    .map((entry) => entry.item)
}

export function recentClientSessionItems<T extends ClientSessionOrderInput>(
  items: readonly T[],
  state: ClientSessionOrderState,
  now = Date.now(),
): T[] {
  return orderClientSessionItems(
    items.filter((item) => item.bucket !== "inactive" || isRecentClientSessionUpdate(item.timeUpdated, now)),
    state,
  )
}

export function priorClientSessionItems<T extends ClientSessionOrderInput>(
  items: readonly T[],
  state: ClientSessionOrderState,
  now = Date.now(),
): T[] {
  return orderClientSessionItems(
    items.filter((item) => item.bucket === "inactive" && !isRecentClientSessionUpdate(item.timeUpdated, now)),
    state,
  )
}

export function projectClientSessionItems<T extends ClientSessionOrderInput>(
  items: readonly T[],
  state: ClientSessionOrderState,
  now = Date.now(),
  limit = CLIENT_PROJECT_RECENT_SESSION_LIMIT,
): T[] {
  const ordered = orderClientSessionItems(items, state)
  const recent = ordered.filter(
    (item) => item.bucket !== "inactive" || isRecentClientSessionUpdate(item.timeUpdated, now),
  )
  return recent.length >= limit ? recent : ordered.slice(0, limit)
}

export function recentClientSessionModels<T>(
  items: readonly T[],
  modelValue: (item: T) => string | undefined,
  timeUpdated: (item: T) => number,
  limit = 10,
) {
  return Array.from(
    new Set(
      items
        .filter((item) => modelValue(item))
        .sort((left, right) => timeUpdated(right) - timeUpdated(left))
        .map((item) => modelValue(item))
        .filter((item): item is string => Boolean(item)),
    ),
  ).slice(0, limit)
}

export function isRecentClientSessionUpdate(timeUpdated: number, now = Date.now()) {
  return timeUpdated >= now - CLIENT_RECENT_SESSION_WINDOW_MS
}

function clientSessionOrderEntryOrder(state: ClientSessionOrderState, item: ClientSessionOrderInput, fallback: number) {
  const entry = state.entries[item.id]
  return entry?.bucket === item.bucket ? entry.order : fallback
}

function clientSessionOrderBucketRank(bucket: ClientSessionOrderBucket) {
  if (bucket === "input_needed") return 0
  if (bucket === "ready_for_review") return 1
  if (bucket === "in_progress") return 2
  return 3
}

function compareClientSessionTimeDesc(a: ClientSessionOrderInput, b: ClientSessionOrderInput) {
  return b.timeUpdated - a.timeUpdated || (b.timeCreated ?? 0) - (a.timeCreated ?? 0) || a.id.localeCompare(b.id)
}

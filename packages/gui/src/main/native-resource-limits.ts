export const NATIVE_RESOURCE_HARD_LIMIT = 8

export function ownerHasResourceCapacity(
  resources: Iterable<{ ownerID: number }>,
  ownerID: number,
  limit = NATIVE_RESOURCE_HARD_LIMIT,
) {
  return Array.from(resources).filter((resource) => resource.ownerID === ownerID).length < limit
}

export function createKeyedSingleFlight<Key, Value>() {
  const requests = new Map<Key, Promise<Value>>()

  function run(key: Key, load: () => Promise<Value>) {
    const existing = requests.get(key)
    if (existing) return existing
    const request = Promise.resolve().then(load).finally(() => {
      if (requests.get(key) === request) requests.delete(key)
    })
    requests.set(key, request)
    return request
  }

  return { run, size: () => requests.size }
}

import { describe, expect, test } from "bun:test"
import { createDebouncedSearch, createExpiringLruCache } from "../src/renderer/src/lib/async-search"
import { createAnimationFrameTask, createDebouncedTask, type DeferredTimer } from "../src/renderer/src/lib/deferred-work"
import { createResizeSession } from "../src/renderer/src/lib/resize-session"

describe("GUI deferred input work", () => {
  test("debounces values and supports explicit flush and cancellation", () => {
    const timer = manualTimer()
    const values: string[] = []
    const task = createDebouncedTask((value: string) => values.push(value), 250, timer)

    task.schedule("first")
    task.schedule("latest")
    expect(values).toEqual([])
    expect(timer.size()).toBe(1)

    task.flush()
    expect(values).toEqual(["latest"])
    expect(timer.size()).toBe(0)

    task.schedule("discarded")
    task.cancel()
    timer.runAll()
    expect(values).toEqual(["latest"])
  })

  test("coalesces repeated layout work into one animation frame", () => {
    const callbacks = new Map<number, () => void>()
    let nextID = 0
    let runs = 0
    const task = createAnimationFrameTask(() => runs++, {
      request: (run) => {
        callbacks.set(++nextID, run)
        return nextID
      },
      cancel: (handle) => callbacks.delete(handle as number),
    })

    task.schedule()
    task.schedule()
    task.schedule()
    expect(callbacks.size).toBe(1)
    callbacks.values().next().value?.()
    expect(runs).toBe(1)
  })
})

describe("GUI async search", () => {
  test("debounces queries, aborts stale requests, and preserves result order", async () => {
    const timer = manualTimer()
    const signals: AbortSignal[] = []
    const calls: string[] = []
    const results: string[][] = []
    const search = createDebouncedSearch<string, string[]>({
      key: (query) => query,
      timer,
      load: (query, signal) => {
        calls.push(query)
        signals.push(signal)
        if (query === "first") return new Promise<string[]>(() => undefined)
        return Promise.resolve([`${query}-2`, `${query}-1`])
      },
      success: (value) => results.push(value),
    })

    search.search("ignored")
    search.search("first")
    expect(timer.size()).toBe(1)
    timer.runAll()
    expect(calls).toEqual(["first"])

    search.search("second")
    expect(signals[0]?.aborted).toBe(true)
    timer.runAll()
    await Promise.resolve()

    expect(calls).toEqual(["first", "second"])
    expect(results).toEqual([["second-2", "second-1"]])
    search.dispose()
  })

  test("deduplicates active and fulfilled queries with a bounded expiring LRU", async () => {
    const timer = manualTimer()
    const releases: Array<(value: string[]) => void> = []
    const results: string[][] = []
    let calls = 0
    const search = createDebouncedSearch<string, string[]>({
      key: (query) => query,
      timer,
      load: () => {
        calls++
        return new Promise((resolve) => releases.push(resolve))
      },
      success: (value) => results.push(value),
    })

    search.search("same")
    timer.runAll()
    search.search("same")
    expect(calls).toBe(1)

    releases[0]?.(["z", "a"])
    await Promise.resolve()
    search.search("same")
    expect(calls).toBe(1)
    expect(results).toEqual([["z", "a"], ["z", "a"]])

    let now = 0
    const cache = createExpiringLruCache<number, string>({ maxEntries: 64, ttlMs: 30_000, now: () => now })
    Array.from({ length: 65 }, (_, index) => cache.set(index, String(index)))
    expect(cache.size()).toBe(64)
    expect(cache.get(0)).toBeUndefined()
    expect(cache.get(1)).toBe("1")
    now = 30_001
    expect(cache.get(1)).toBeUndefined()
    search.dispose()
  })

  test("does not reuse autocomplete results across workspace identities", async () => {
    const timer = manualTimer()
    const calls: string[] = []
    const results: string[] = []
    const search = createDebouncedSearch<{ workspace: string; query: string }, string[]>({
      key: (value) => `${value.workspace}\n${value.query}`,
      timer,
      load: async (value) => {
        calls.push(value.workspace)
        return [`${value.workspace}/${value.query}`]
      },
      success: (value) => results.push(value[0]!),
    })

    search.search({ workspace: "workspace-a", query: "src" })
    timer.runAll()
    await Promise.resolve()
    search.search({ workspace: "workspace-b", query: "src" })
    timer.runAll()
    await Promise.resolve()

    expect(calls).toEqual(["workspace-a", "workspace-b"])
    expect(results).toEqual(["workspace-a/src", "workspace-b/src"])
    search.dispose()
  })
})

test("resize sessions preview every move and persist the final value once", () => {
  const previews: number[] = []
  const writes: number[] = []
  const resize = createResizeSession(300, {
    preview: (value) => previews.push(value),
    persist: (value) => writes.push(value),
  })

  resize.update(320)
  resize.update(340)
  resize.finish()
  resize.finish()
  resize.update(360)

  expect(previews).toEqual([320, 340])
  expect(writes).toEqual([340])
})

function manualTimer(): DeferredTimer & { runAll: () => void; size: () => number } {
  const callbacks = new Map<number, () => void>()
  let nextID = 0
  return {
    schedule(run) {
      callbacks.set(++nextID, run)
      return nextID
    },
    cancel(handle) {
      callbacks.delete(handle as number)
    },
    runAll() {
      const pending = [...callbacks.values()]
      callbacks.clear()
      pending.forEach((run) => run())
    },
    size: () => callbacks.size,
  }
}

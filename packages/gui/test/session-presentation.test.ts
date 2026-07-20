import { describe, expect, test } from "bun:test"
import type { OpencodeXSessionSnapshot, OpencodeXStateSnapshot, Session } from "@opencode-ai/sdk/v2/client"
import { createClientStateSync, type ClientStateSyncTransport } from "@opencode-ai/sdk/v2/client-sync"
import { createDeferredSessionRelease, createSessionPresentationController } from "../src/renderer/src/lib/session-presentation"

describe("GUI session presentation controller", () => {
  test("pins visible sessions and retains only the most recent inactive entries", () => {
    const controller = createSessionPresentationController({ inactiveLimit: 2 })
    controller.setVisible(["visible"])
    controller.remember("visible")
    controller.remember("oldest")
    controller.remember("middle")

    expect(controller.remember("newest")).toEqual(["oldest"])
    expect(controller.cachedSessionIDs()).toEqual(["visible", "middle", "newest"])
  })

  test("touch updates inactive recency before eviction", () => {
    const controller = createSessionPresentationController({ inactiveLimit: 2 })
    controller.remember("first")
    controller.remember("second")
    controller.touch("first")

    expect(controller.remember("third")).toEqual(["second"])
    expect(controller.cachedSessionIDs()).toEqual(["first", "third"])
  })

  test("deduplicates matching in-flight loads but not distinct pages", async () => {
    const controller = createSessionPresentationController()
    const first = Promise.withResolvers<string>()
    const state = { loads: 0 }
    const load = () => {
      state.loads += 1
      return first.promise
    }

    const one = controller.load("session-1", "tail", load)
    const duplicate = controller.load("session-1", "tail", load)
    const older = controller.load("session-1", "older:message-1", async () => "older")
    expect(one).toBe(duplicate)
    expect(state.loads).toBe(1)
    first.resolve("tail")
    await expect(one).resolves.toBe("tail")
    await expect(older).resolves.toBe("older")
  })

  test("aborts loads when visibility leaves without discarding completed cache", async () => {
    const controller = createSessionPresentationController()
    const pending = Promise.withResolvers<string>()
    let signal: AbortSignal | undefined
    controller.setVisible(["session-1"])
    controller.remember("session-1")
    const result = controller.load("session-1", "tail", (loadSignal) => {
      signal = loadSignal
      return pending.promise
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    controller.setVisible([])
    expect(signal?.aborted).toBe(true)
    expect(controller.cachedSessionIDs()).toEqual(["session-1"])
    pending.resolve("stale")
    expect(await result).toMatchObject({ name: "AbortError" })
  })

  test("evicts deleted sessions and clears all presentation data on scope changes", () => {
    const controller = createSessionPresentationController()
    controller.reconcile("epoch-1:scope-a", new Set(["session-1", "session-2"]))
    controller.remember("session-1")
    controller.remember("session-2")
    controller.setVisible(["session-2"])

    expect(controller.reconcile("epoch-1:scope-a", new Set(["session-2"]))).toEqual(["session-1"])
    expect(controller.visibleSessionIDs()).toEqual(["session-2"])
    expect(controller.reconcile("epoch-2:scope-b", new Set(["session-2"]))).toEqual(["session-2"])
    expect(controller.cachedSessionIDs()).toEqual([])
    expect(controller.visibleSessionIDs()).toEqual([])
  })

  test("defers release and rechecks retained presentation state before applying it", async () => {
    const retained = new Set<string>()
    const released: string[] = []
    const release = createDeferredSessionRelease({
      release: (sessionID) => released.push(sessionID),
      retained: (sessionID) => retained.has(sessionID),
    })

    release(["session-1"])
    retained.add("session-1")
    await Promise.resolve()
    expect(released).toEqual([])

    retained.delete("session-1")
    release(["session-1"])
    await Promise.resolve()
    expect(released).toEqual(["session-1"])
  })

  test("opens and releases 500 sessions without retaining more than visible plus 16 canonical details", async () => {
    const sessions = Array.from({ length: 500 }, (_, index) => performanceSession(index))
    const pending = Promise.withResolvers<OpencodeXSessionSnapshot>()
    let pendingSignal: AbortSignal | undefined
    const transport: ClientStateSyncTransport = {
      snapshot: async () => performanceSnapshot(sessions),
      session: async (input) => {
        if (input.limit === 999) {
          pendingSignal = input.signal
          return pending.promise
        }
        return performanceSessionSnapshot(input.sessionID)
      },
      events: async ({ signal }) =>
        (async function* () {
          yield { type: "ready", scope: performanceScope(), epoch: "performance-epoch", cursor: "cursor-0" }
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        })(),
    }
    const state = createClientStateSync({ transport })
    const presentation = createSessionPresentationController({ inactiveLimit: 16 })
    const visible = sessions.slice(0, 8).map((session) => session.id)
    presentation.setVisible(visible)
    await state.start()

    for (const session of sessions) {
      await state.refreshSessionTail(session.id, { limit: 1 })
      presentation.remember(session.id).forEach(state.releaseSession)
      expect(Object.keys(state.getState().sessionDetails).length).toBeLessThanOrEqual(visible.length + 16)
    }
    expect(Object.keys(state.getState().sessionDetails)).toHaveLength(visible.length + 16)
    expect(state.getMetrics()).toMatchObject({
      retainedSessionDetails: visible.length + 16,
      retainedSessionLoads: visible.length + 16,
      sessionTailOptions: visible.length + 16,
      activeSessionRequests: 0,
      sessionRefreshTimers: 0,
    })

    presentation.cachedSessionIDs().forEach((sessionID, index) => {
      state.applyEvent({
        id: `buffered-${index}`,
        type: "message.part.delta",
        properties: {
          sessionID,
          messageID: "msg_performance",
          partID: "prt_performance_pending",
          field: "text",
          delta: "buffered",
        },
      })
    })
    expect(state.getMetrics().bufferedSessionEvents).toBe(visible.length + 16)

    const loading = state.refreshSessionTail(visible[0], { limit: 999 }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(state.getMetrics().activeSessionRequests).toBe(1)
    state.releaseSession(visible[0])
    expect(pendingSignal?.aborted).toBe(true)
    expect(state.getMetrics().activeSessionRequests).toBe(0)

    presentation.reconcile("performance-scope-reset", new Set()).forEach(state.releaseSession)
    pending.resolve(performanceSessionSnapshot(visible[0]))
    expect(await loading).toMatchObject({ name: "AbortError" })
    expect(state.getMetrics()).toMatchObject({
      retainedSessionDetails: 0,
      retainedSessionLoads: 0,
      sessionTailOptions: 0,
      activeSessionRequests: 0,
      activeCardRequests: 0,
      sessionRefreshTimers: 0,
      bufferedSessionEvents: 0,
      queuedFrames: 0,
    })
    state.stop()
  })
})

function performanceScope() {
  return { projectID: "performance-project", directory: "C:/performance" }
}

function performanceSession(index: number): Session {
  const id = `ses_performance_${String(index).padStart(4, "0")}`
  return {
    id,
    slug: id,
    projectID: "performance-project",
    directory: "C:/performance",
    title: id,
    version: "performance",
    time: { created: index, updated: index },
  }
}

function performanceSnapshot(sessions: Session[]): OpencodeXStateSnapshot {
  return {
    scope: performanceScope(),
    epoch: "performance-epoch",
    cursor: "cursor-0",
    digest: "performance-root",
    domains: {
      catalog: { revision: "performance-root", digest: "performance-root" },
      operations: { revision: "performance-root", digest: "performance-root" },
    },
    payloads: {
      catalog: {
        projects: [],
        sessionCards: { items: sessions, hasMore: false, missing: [], sessionUiState: {} },
        views: [],
        sessionStatus: {},
        permissions: [],
        questions: [],
        sessionUiState: {},
      },
      operations: { jobs: [], swarms: [] },
    },
  }
}

function performanceSessionSnapshot(sessionID: string): OpencodeXSessionSnapshot {
  const session = performanceSession(Number(sessionID.slice(-4)))
  return {
    scope: performanceScope(),
    epoch: "performance-epoch",
    cursor: `cursor-${sessionID}`,
    digest: `detail-${sessionID}`,
    session,
    messages: {
      items: [],
      coverage: {},
      boundary: { hasMore: false },
    },
    todos: [],
    diff: [],
    pendingInteractions: { permissions: [], questions: [] },
  }
}

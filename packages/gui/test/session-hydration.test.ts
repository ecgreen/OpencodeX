import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { runSelectedSessionSync } from "../src/renderer/src/lib/session-hydration"
import { sessionLoadedTime, shouldApplySessionSyncResult, shouldClearSessionSyncLoading, shouldHandleSessionSyncFailure, shouldShowSelectedSessionLoading, shouldShowViewSessionLoading, shouldSkipSessionSync, shouldSkipViewSessionSync, viewSessionLoadKey } from "../src/renderer/src/lib/session-hydration-policy"
import { syncColdLinkedSession } from "../src/renderer/src/controllers/session-selection-controller"
import type { SessionData } from "../src/renderer/src/lib/store"

describe("GUI session sync decisions", () => {
  test("skips selected session sync only when the loaded data is fresh for that session", () => {
    expect(shouldSkipSessionSync({ sessionID: "s1", loadedSessionID: "s1", loadedTime: 10, session: session("s1", 10) })).toBe(true)
    expect(shouldSkipSessionSync({ sessionID: "s1", loadedSessionID: "s2", loadedTime: 10, session: session("s1", 10) })).toBe(false)
    expect(shouldSkipSessionSync({ sessionID: "s1", loadedSessionID: "s1", loadedTime: 9, session: session("s1", 10) })).toBe(false)
    expect(shouldSkipSessionSync({ force: true, sessionID: "s1", loadedSessionID: "s1", loadedTime: 10, session: session("s1", 10) })).toBe(false)
  })

  test("skips view session sync when cached pane data matches the session update time", () => {
    expect(shouldSkipViewSessionSync({ session: session("s1", 10), data: data(), loadedTime: 10 })).toBe(true)
    expect(shouldSkipViewSessionSync({ session: session("s1", 10), data: data(), loadedTime: 9 })).toBe(false)
    expect(shouldSkipViewSessionSync({ session: session("s1", 10), loadedTime: 10 })).toBe(false)
    expect(shouldSkipViewSessionSync({ force: true, session: session("s1", 10), data: data(), loadedTime: 10 })).toBe(false)
  })

  test("shows view loading only before a pane has loaded data", () => {
    expect(shouldShowViewSessionLoading()).toBe(true)
    expect(shouldShowViewSessionLoading(data())).toBe(false)
  })

  test("shows selected session loading only when no selected cache can cover it", () => {
    expect(shouldShowSelectedSessionLoading({
      sessionID: "s1",
      loadedSessionID: "s2",
    })).toBe(true)
    expect(shouldShowSelectedSessionLoading({
      sessionID: "s1",
      loadedSessionID: "s2",
      cachedData: data(),
    })).toBe(false)
    expect(shouldShowSelectedSessionLoading({
      sessionID: "s1",
      loadedSessionID: "s1",
    })).toBe(false)
    expect(shouldShowSelectedSessionLoading({
      sessionID: "s1",
      materializingSessionID: "s1",
      loadedSessionID: "",
    })).toBe(false)
  })

  test("keys concurrent view loads by session identity, directory, and update time", () => {
    expect(viewSessionLoadKey(session("s1", 10))).toBe("s1\nC:\\Work\\OpencodeX\n10")
    expect(viewSessionLoadKey({ ...session("s1", 10), directory: undefined })).toBe("s1\n\n10")
  })

  test("applies selected session sync results only for the latest matching route", () => {
    expect(shouldApplySessionSyncResult({ requestID: 2, latestRequestID: 2, route: { name: "session", sessionID: "s1" }, sessionID: "s1" })).toBe(true)
    expect(shouldApplySessionSyncResult({ requestID: 1, latestRequestID: 2, route: { name: "session", sessionID: "s1" }, sessionID: "s1" })).toBe(false)
    expect(shouldApplySessionSyncResult({ requestID: 2, latestRequestID: 2, route: { name: "dashboard" }, sessionID: "s1" })).toBe(false)
    expect(shouldApplySessionSyncResult({ requestID: 2, latestRequestID: 2, route: { name: "session", sessionID: "s2" }, sessionID: "s1" })).toBe(false)
  })

  test("handles failures and loading state only for the latest selected session request", () => {
    expect(shouldHandleSessionSyncFailure({ requestID: 2, latestRequestID: 2 })).toBe(true)
    expect(shouldHandleSessionSyncFailure({ requestID: 1, latestRequestID: 2 })).toBe(false)
    expect(shouldClearSessionSyncLoading({ requestID: 2, latestRequestID: 2, loadingSessionID: "s1", sessionID: "s1" })).toBe(true)
    expect(shouldClearSessionSyncLoading({ requestID: 2, latestRequestID: 2, loadingSessionID: "s2", sessionID: "s1" })).toBe(false)
    expect(shouldClearSessionSyncLoading({ requestID: 1, latestRequestID: 2, loadingSessionID: "s1", sessionID: "s1" })).toBe(false)
  })

  test("runs selected session sync through skip, loading, apply, and clear phases", async () => {
    const events: string[] = []
    let latestRequestID = 0
    let loadingSessionID = ""
    let applied: { data: SessionData; loadedTime: number } | undefined

    await runSelectedSessionSync({
      sessionID: "s1",
      session: session("s1", 10),
      loadedSessionID: "",
      loadedTime: 0,
      nextRequestID: () => {
        latestRequestID = 1
        return latestRequestID
      },
      latestRequestID: () => latestRequestID,
      route: () => ({ name: "session", sessionID: "s1" }),
      loadingSessionID: () => loadingSessionID,
      setLoadingSessionID: (sessionID) => {
        events.push(`loading:${sessionID}`)
        loadingSessionID = sessionID
      },
      clearLoadingSessionID: () => {
        events.push("clear")
        loadingSessionID = ""
      },
      loadData: async () => {
        events.push("load")
        return data()
      },
      applyData: (data, loadedTime) => {
        applied = { data, loadedTime }
      },
      applyFailure: (cause) => events.push(`failure:${String(cause)}`),
    })

    expect(events).toEqual(["loading:s1", "load", "clear"])
    expect(applied).toEqual({ data: data(), loadedTime: 10 })
  })

  test("uses the maximum returned canonical update time for session freshness", async () => {
    let loadedTime = 0
    await runSelectedSessionSync({
      sessionID: "s1",
      session: session("s1", 10),
      loadedSessionID: "",
      loadedTime: 12,
      nextRequestID: () => 1,
      latestRequestID: () => 1,
      route: () => ({ name: "session", sessionID: "s1" }),
      loadingSessionID: () => "s1",
      setLoadingSessionID: () => undefined,
      clearLoadingSessionID: () => undefined,
      loadData: async () => data(),
      canonicalUpdatedTime: () => 20,
      applyData: (_data, time) => (loadedTime = time),
      applyFailure: () => undefined,
    })

    expect(loadedTime).toBe(20)
    expect(sessionLoadedTime(30, 10, 20)).toBe(30)
  })

  test("skips selected session sync without starting a request when loaded data is fresh", async () => {
    const events: string[] = []

    await runSelectedSessionSync({
      sessionID: "s1",
      session: session("s1", 10),
      loadedSessionID: "s1",
      loadedTime: 10,
      nextRequestID: () => {
        events.push("request")
        return 1
      },
      latestRequestID: () => 1,
      route: () => ({ name: "session", sessionID: "s1" }),
      loadingSessionID: () => "",
      setLoadingSessionID: (sessionID) => events.push(`loading:${sessionID}`),
      clearLoadingSessionID: () => events.push("clear"),
      loadData: async () => {
        events.push("load")
        return data()
      },
      applyData: () => events.push("apply"),
      applyFailure: () => events.push("failure"),
    })

    expect(events).toEqual([])
  })

  test("ignores stale selected session sync results", async () => {
    const events: string[] = []

    await runSelectedSessionSync({
      sessionID: "s1",
      session: session("s1", 10),
      loadedSessionID: "",
      loadedTime: 0,
      nextRequestID: () => 1,
      latestRequestID: () => 2,
      route: () => ({ name: "session", sessionID: "s1" }),
      loadingSessionID: () => "s1",
      setLoadingSessionID: (sessionID) => events.push(`loading:${sessionID}`),
      clearLoadingSessionID: () => events.push("clear"),
      loadData: async () => {
        events.push("load")
        return data()
      },
      applyData: () => events.push("apply"),
      applyFailure: () => events.push("failure"),
    })

    expect(events).toEqual(["loading:s1", "load"])
  })

  test("applies selected session sync failures only for the latest request", async () => {
    const events: string[] = []

    await runSelectedSessionSync({
      sessionID: "s1",
      loadedSessionID: "",
      loadedTime: 0,
      nextRequestID: () => 1,
      latestRequestID: () => 1,
      route: () => ({ name: "session", sessionID: "s1" }),
      loadingSessionID: () => "s1",
      setLoadingSessionID: (sessionID) => events.push(`loading:${sessionID}`),
      clearLoadingSessionID: () => events.push("clear"),
      loadData: async () => {
        throw new Error("boom")
      },
      applyData: () => events.push("apply"),
      applyFailure: (cause) => events.push(cause instanceof Error ? cause.message : String(cause)),
      now: () => 20,
    })

    expect(events).toEqual(["loading:s1", "boom", "clear"])
  })

  test("waits for authoritative readiness before resolving and hydrating a cold deep link", async () => {
    const events: string[] = []
    const input = {
      sessionID: "cold-session",
      ensureSessionCards: async (sessionIDs: readonly string[]) => {
        events.push(`ensure:${sessionIDs.join(",")}`)
        return { missing: [] }
      },
      syncSession: async (sessionID: string) => {
        events.push(`hydrate:${sessionID}`)
      },
      isCurrent: () => true,
    }

    expect(await syncColdLinkedSession({ ...input, ready: false })).toBe(false)
    expect(events).toEqual([])
    expect(await syncColdLinkedSession({ ...input, ready: true })).toBe(true)
    expect(events).toEqual(["ensure:cold-session", "hydrate:cold-session"])
  })

  test("does not hydrate a cold deep link after navigation changes", async () => {
    const resolution = Promise.withResolvers<{ missing: readonly string[] }>()
    const events: string[] = []
    let current = true
    const pending = syncColdLinkedSession({
      ready: true,
      sessionID: "cold-session",
      ensureSessionCards: () => resolution.promise,
      syncSession: async (sessionID) => {
        events.push(`hydrate:${sessionID}`)
      },
      isCurrent: () => current,
    })

    current = false
    resolution.resolve({ missing: [] })

    expect(await pending).toBe(false)
    expect(events).toEqual([])
  })
})

function session(id: string, updated: number): Session {
  return { id, directory: "C:\\Work\\OpencodeX", time: { updated } } as Session
}

function data(): SessionData {
  return { messages: [], todos: [], diffs: [] }
}

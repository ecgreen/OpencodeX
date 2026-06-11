import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { runSelectedSessionSync, shouldApplySessionSyncResult, shouldClearSessionSyncLoading, shouldHandleSessionSyncFailure, shouldShowViewSessionLoading, shouldSkipSessionSync, shouldSkipViewSessionSync, viewSessionLoadKey } from "../src/renderer/src/lib/session-sync"
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
})

function session(id: string, updated: number): Session {
  return { id, directory: "C:\\Work\\OpencodeX", time: { updated } } as Session
}

function data(): SessionData {
  return { messages: [], todos: [], diffs: [] }
}

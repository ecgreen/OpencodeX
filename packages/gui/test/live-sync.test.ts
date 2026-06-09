import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot, MessageBundle, SessionData } from "../src/renderer/src/lib/store"
import { liveServerSyncPlan, shouldPollSelectedSession, shouldRefreshSnapshotCards, viewSessionsToPoll, visibleSessionSyncTarget } from "../src/renderer/src/lib/live-sync"

describe("GUI live sync decisions", () => {
  test("polls the selected session only when it follows the live tail", () => {
    expect(shouldPollSelectedSession({ followingBottom: false })).toBe(false)
    expect(shouldPollSelectedSession({ followingBottom: true })).toBe(true)
    expect(shouldPollSelectedSession({ followingBottom: true, session: session("s1", 100), status: { type: "busy" } })).toBe(true)
    expect(shouldPollSelectedSession({ followingBottom: true, session: session("s1", 1), data: data([assistant("m1", 1, [textPart("p1")])]) })).toBe(false)
  })

  test("selects only followed view sessions that need polling", () => {
    const sessions = [session("busy", 100), session("stale", 1), session("paused", 100)]

    expect(viewSessionsToPoll({
      sessions,
      followingBottom: (sessionID) => sessionID !== "paused",
      sessionStatus: { busy: { type: "busy" } },
      sessionData: {
        stale: data([assistant("stale", 1, [textPart("text")])]),
        paused: data([assistant("paused", 100, [textPart("text")])]),
      },
    }).map((item) => item.id)).toEqual(["busy"])
  })

  test("refreshes snapshot cards on the configured interval", () => {
    expect(shouldRefreshSnapshotCards(10_000, 5_000, 5_000)).toBe(true)
    expect(shouldRefreshSnapshotCards(9_999, 5_000, 5_000)).toBe(false)
  })

  test("selects visible session sync targets for route-aware event refreshes", () => {
    const view = session("view-session", 100)

    expect(visibleSessionSyncTarget({
      route: { name: "session", sessionID: "selected" },
      sessionID: "selected",
      viewSessions: [view],
      followingBottom: () => true,
    })).toEqual({ type: "session", sessionID: "selected" })
    expect(visibleSessionSyncTarget({
      route: { name: "views" },
      sessionID: "view-session",
      viewSessions: [view],
      followingBottom: () => true,
    })).toEqual({ type: "view", session: view })
    expect(visibleSessionSyncTarget({
      route: { name: "views" },
      sessionID: "missing",
      viewSessions: [view],
      followingBottom: () => true,
    })).toBeUndefined()
    expect(visibleSessionSyncTarget({
      route: { name: "session", sessionID: "selected" },
      sessionID: "selected",
      viewSessions: [view],
      followingBottom: () => false,
    })).toBeUndefined()
  })

  test("plans selected session polling and snapshot refreshes", () => {
    const selected = session("selected", 100)
    const plan = liveServerSyncPlan({
      now: 10_000,
      route: { name: "session", sessionID: "selected" },
      snapshot: snapshot({ sessions: [selected], sessionStatus: { selected: { type: "busy" } } }),
      loadedSessionID: "selected",
      loadedSessionData: data([]),
      activeViewSessions: [],
      followingBottom: () => true,
      viewSessionData: {},
      lastSnapshotSync: 5_000,
      snapshotSyncInterval: 5_000,
    })

    expect(plan).toEqual({ selectedSessionID: "selected", viewSessions: [], refreshSnapshot: true })
  })

  test("plans followed view session polling without selected-session work", () => {
    const busy = session("busy", 100)
    const stale = session("stale", 1)
    const plan = liveServerSyncPlan({
      now: 9_999,
      route: { name: "views" },
      snapshot: snapshot({ sessionStatus: { busy: { type: "busy" } } }),
      loadedSessionID: "",
      loadedSessionData: data([]),
      activeViewSessions: [busy, stale],
      followingBottom: (sessionID) => sessionID !== "stale",
      viewSessionData: { stale: data([assistant("stale", 1, [textPart("text")])]) },
      lastSnapshotSync: 5_000,
      snapshotSyncInterval: 5_000,
    })

    expect(plan.selectedSessionID).toBeUndefined()
    expect(plan.viewSessions.map((item) => item.id)).toEqual(["busy"])
    expect(plan.refreshSnapshot).toBe(false)
  })
})

function session(id: string, updated: number): Session {
  return { id, directory: "C:\\Work\\OpencodeX", time: { updated } } as Session
}

function data(messages: MessageBundle[]): SessionData {
  return { messages, todos: [], diffs: [] }
}

function snapshot(overrides: Partial<GuiSnapshot>): GuiSnapshot {
  return {
    projects: [],
    sessions: [],
    sessionStatus: {},
    sessionUiState: {},
    permissions: [],
    questions: [],
    providers: [],
    agents: [],
    swarms: [],
    jobs: [],
    views: [],
    ...overrides,
  }
}

function assistant(id: string, created: number, parts: MessageBundle["parts"]): MessageBundle {
  return {
    info: { id, sessionID: id, role: "assistant", time: { created } } as MessageBundle["info"],
    parts,
  }
}

function textPart(id: string): MessageBundle["parts"][number] {
  return { id, sessionID: "session", messageID: "message", type: "text", text: "Working" } as MessageBundle["parts"][number]
}

import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { visibleSessionSyncTarget } from "../src/renderer/src/lib/live-sync"

describe("GUI live sync decisions", () => {
  test("selects visible session sync targets for route-aware event refreshes", () => {
    const view = session("view-session", 100)

    expect(
      visibleSessionSyncTarget({
        route: { name: "session", sessionID: "selected" },
        sessionID: "selected",
        viewSessions: [view],
      }),
    ).toEqual({ type: "session", sessionID: "selected" })
    expect(
      visibleSessionSyncTarget({
        route: { name: "views" },
        sessionID: "view-session",
        viewSessions: [view],
      }),
    ).toEqual({ type: "view", session: view })
    expect(
      visibleSessionSyncTarget({
        route: { name: "views" },
        sessionID: "missing",
        viewSessions: [view],
      }),
    ).toBeUndefined()
  })
})

function session(id: string, updated: number): Session {
  return { id, directory: "C:\\Work\\OpencodeX", time: { updated } } as Session
}

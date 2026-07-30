/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../../../fixture/fixture"
import { directory, json, mount } from "./sync-fixture"
import {
  TUI_SESSION_RENDER_CAP,
  tuiMessageCursorBefore,
} from "../../../../src/cli/cmd/tui/context/sync-transcript"

const sessionID = "ses_window"
const session = {
  id: sessionID,
  title: "window",
  time: { created: 0, updated: 1 },
  version: "1.15.13",
  directory,
  projectID: "proj_test",
}

describe("tui transcript window", () => {
  test("caps the rendered transcript and pages older history back in on demand", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")

    const tail = messageIDs(200, 200 + TUI_SESSION_RENDER_CAP + 40)
    const older = messageIDs(100, 200)
    const { app, sync } = await mount((url) => {
      if (url.pathname === "/experimental/opencodex/state")
        return stateSnapshot("window", [session])
      if (url.pathname !== `/experimental/opencodex/state/session/${sessionID}`) return undefined
      if (url.searchParams.get("before")) return sessionSnapshot(older, { hasMore: false })
      return sessionSnapshot(tail, { hasMore: false })
    })

    try {
      const release = sync.session.retain(sessionID)
      await sync.session.sync(sessionID)

      // The server returned more than the cap; only the newest slice is mounted.
      expect(tail.length).toBeGreaterThan(TUI_SESSION_RENDER_CAP)
      expect(sync.data.message[sessionID]?.length).toBe(TUI_SESSION_RENDER_CAP)
      expect(sync.data.message[sessionID]?.[0]?.id).toBe(tail[40])
      expect(sync.data.message[sessionID]?.at(-1)?.id).toBe(tail.at(-1))

      // Parts for the messages the cap dropped are not held either.
      expect(sync.data.part[tail[0]!]).toBeUndefined()
      expect(sync.data.part[tail[40]!]?.length).toBe(1)

      const window = sync.session.transcript(sessionID)
      expect(window).toMatchObject({ hasOlder: true, trimmed: true, expanded: false })
      expect(window.olderCursor).toBe(tuiMessageCursorBefore({ id: tail[40]!, time: { created: 40 } }))

      expect(await sync.session.loadOlder(sessionID)).toBe(true)

      // Expanding suspends the cap: the reader keeps what they asked for plus
      // everything that was already loaded.
      expect(sync.session.transcript(sessionID)).toMatchObject({ expanded: true, trimmed: false, hasOlder: false })
      expect(sync.data.message[sessionID]?.length).toBe(older.length + tail.length)
      expect(sync.data.message[sessionID]?.[0]?.id).toBe(older[0])
      release()
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })
})

function messageIDs(from: number, to: number) {
  return Array.from({ length: to - from }, (_, index) => `message-${String(from + index).padStart(5, "0")}`)
}

function stateSnapshot(revision: string, sessions: Record<string, unknown>[]) {
  return json({
    scope: { projectID: "proj_test", directory },
    epoch: "test-epoch",
    cursor: "test-cursor",
    digest: revision,
    domains: {
      catalog: { revision, digest: revision },
      operations: { revision, digest: revision },
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
  })
}

function sessionSnapshot(ids: string[], boundary: { hasMore: boolean; next?: string }) {
  return json({
    scope: { projectID: "proj_test", directory },
    epoch: "test-epoch",
    cursor: "test-cursor",
    digest: `${ids[0]}:${ids.at(-1)}`,
    session,
    messages: {
      items: ids.map((id, index) => ({
        info: {
          id,
          sessionID,
          role: "user",
          time: { created: index },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
        },
        parts: [{ id: `part-${id}`, sessionID, messageID: id, type: "text", text: id }],
      })),
      coverage: { firstMessageID: ids[0], lastMessageID: ids.at(-1) },
      boundary,
    },
    todos: [],
    diff: [],
    pendingInteractions: { permissions: [], questions: [] },
  })
}

import { describe, expect, test } from "bun:test"
import type { Message, OpencodeXSessionSnapshot, Part, Session } from "@opencode-ai/sdk/v2/client"
import type { ClientStateSyncController } from "@opencode-ai/sdk/v2/client-sync"
import { loadClientStateSessionTranscript } from "../src/renderer/src/lib/client-session-loader"
import { clipToCurrentWindow, sessionDataFromSnapshot } from "../src/renderer/src/lib/session-data-projection"
import type { MessageBundle, SessionData } from "../src/renderer/src/lib/store-types"

describe("GUI standalone session projection", () => {
  test("normalizes message parts projected directly from a snapshot", () => {
    const snapshot = pageSnapshot([bundle(1, JSON.stringify({ final: "hello" }))])
    const data = sessionDataFromSnapshot(snapshot)

    expect(data.messages[0]?.parts[0]).toMatchObject({ type: "text", text: "hello" })
    expect(data.todos).toBe(snapshot.todos)
    expect(data.diffs).toBe(snapshot.diff)
  })

  test("reads every transcript page without consulting or mutating canonical presentation state", async () => {
    const pages = new Map<string | undefined, OpencodeXSessionSnapshot>([
      [undefined, pageSnapshot(bundles(10_000, 10_005), true, "cursor-1")],
      ["cursor-1", pageSnapshot(bundles(5_000, 10_000), true, "cursor-2")],
      ["cursor-2", pageSnapshot(bundles(0, 5_000))],
    ])
    const cursors: Array<string | undefined> = []
    let stateReads = 0
    const selected = { value: "selected" }
    const views = { value: "views" }
    const presentation = { value: "presentation" }
    const controller = {
      getState() {
        stateReads += 1
        throw new Error("read-only pagination must not read accumulated SDK state")
      },
      async fetchSessionPage(_sessionID: string, input: { before?: string }) {
        cursors.push(input.before)
        const page = pages.get(input.before)
        if (!page) throw new Error(`Unexpected cursor ${input.before}`)
        return page
      },
    } as unknown as ClientStateSyncController

    const data = await loadClientStateSessionTranscript(controller, "session-1")

    expect(data.messages).toHaveLength(10_005)
    expect(data.messages[0]?.info.id).toBe("message-0")
    expect(data.messages.at(-1)?.info.id).toBe("message-10004")
    expect(cursors).toEqual([undefined, "cursor-1", "cursor-2"])
    expect(stateReads).toBe(0)
    expect(selected).toEqual({ value: "selected" })
    expect(views).toEqual({ value: "views" })
    expect(presentation).toEqual({ value: "presentation" })
  })
})

describe("GUI session projection window clipping", () => {
  const windowed = (messages: MessageBundle[], expanded = false): SessionData =>
    ({ messages, todos: [], diffs: [], ...(expanded ? { messageWindowExpanded: true } : {}) }) as unknown as SessionData

  test("drops history older than the visible window so prompting never prepends content", () => {
    // The session opened showing 3..4; the sync state knows 1..5.
    const projected = bundles(1, 6)
    const result = clipToCurrentWindow(projected, windowed(bundles(3, 5)))
    expect(result.clipped).toBe(true)
    expect(result.messages.map((item) => item.info.id)).toEqual(["message-3", "message-4", "message-5"])
  })

  test("keeps everything once the reader expanded the window with Load more", () => {
    const result = clipToCurrentWindow(bundles(1, 4), windowed(bundles(2, 4), true))
    expect(result.clipped).toBe(false)
    expect(result.messages).toHaveLength(3)
  })

  test("keeps everything when there is no current window to preserve", () => {
    expect(clipToCurrentWindow(bundles(1, 3), undefined).clipped).toBe(false)
    expect(clipToCurrentWindow(bundles(1, 3), windowed([])).clipped).toBe(false)
  })

  test("keeps everything when the current head already leads the projection", () => {
    const result = clipToCurrentWindow(bundles(3, 6), windowed(bundles(3, 5)))
    expect(result.clipped).toBe(false)
    expect(result.messages).toHaveLength(3)
  })
})

function pageSnapshot(
  items: OpencodeXSessionSnapshot["messages"]["items"],
  hasMore = false,
  next?: string,
): OpencodeXSessionSnapshot {
  return {
    scope: { projectID: "project-1", directory: "C:/Work/OpencodeX" },
    epoch: "epoch-1",
    cursor: "state-cursor",
    digest: next ?? "complete",
    session: session(),
    messages: {
      items,
      coverage: {
        firstMessageID: items[0]?.info.id,
        lastMessageID: items.at(-1)?.info.id,
      },
      boundary: { hasMore, ...(next ? { next } : {}) },
    },
    todos: [],
    diff: [],
    pendingInteractions: { permissions: [], questions: [] },
  }
}

function bundles(start: number, end: number) {
  return Array.from({ length: end - start }, (_, index) => bundle(start + index, `text-${start + index}`))
}

function bundle(index: number, text: string) {
  const id = `message-${index}`
  return {
    info: {
      id,
      sessionID: "session-1",
      role: "user",
      time: { created: index },
      agent: "build",
      model: { providerID: "test", modelID: "test" },
    } as Message,
    parts: [{ id: `part-${index}`, sessionID: "session-1", messageID: id, type: "text", text } as Part],
  }
}

function session(): Session {
  return {
    id: "session-1",
    slug: "session-1",
    projectID: "project-1",
    directory: "C:/Work/OpencodeX",
    title: "Session",
    version: "test",
    time: { created: 1, updated: 1 },
  }
}

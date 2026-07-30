import { describe, expect, test } from "bun:test"
import {
  EMPTY_TUI_TRANSCRIPT_WINDOW,
  TUI_SESSION_RENDER_CAP,
  TUI_SESSION_WARM_LIMIT,
  sameTuiTranscriptWindow,
  tuiMessageCursorBefore,
  tuiTranscriptAfterOlderPage,
  tuiTranscriptFromTail,
  tuiTranscriptTrim,
  tuiWarmSessions,
  tuiWarmSessionsWithout,
  type TuiTranscriptWindow,
} from "../../../../src/cli/cmd/tui/context/sync-transcript"

const message = (index: number) => ({ id: `message-${index}`, time: { created: index } })
const messages = (count: number) => Array.from({ length: count }, (_, index) => message(index))
const lookup = (items: ReturnType<typeof messages>) => {
  const byID = new Map(items.map((item) => [item.id, item]))
  return (id: string) => byID.get(id)
}

describe("tui transcript boundary tracking", () => {
  test("a tail with more history offers a cursor to page back from", () => {
    const window = tuiTranscriptFromTail({ hasMore: true, next: "cursor-1" })
    expect(window).toEqual({ hasOlder: true, olderCursor: "cursor-1", loadingOlder: false, expanded: false, trimmed: false })
  })

  test("a complete tail reports no older history and no cursor", () => {
    expect(tuiTranscriptFromTail({ hasMore: false })).toEqual(EMPTY_TUI_TRANSCRIPT_WINDOW)
    expect(tuiTranscriptFromTail({ hasMore: true })).toEqual({ ...EMPTY_TUI_TRANSCRIPT_WINDOW, hasOlder: true })
  })

  test("re-tailing an expanded window keeps it expanded so the cap stays off", () => {
    const expanded: TuiTranscriptWindow = {
      hasOlder: true,
      olderCursor: "cursor-9",
      loadingOlder: true,
      expanded: true,
      trimmed: false,
    }
    expect(tuiTranscriptFromTail({ hasMore: true, next: "cursor-1" }, expanded)).toEqual({
      ...expanded,
      loadingOlder: false,
    })
  })

  test("re-tailing a trimmed window keeps the cap's nearer boundary", () => {
    const trimmed: TuiTranscriptWindow = {
      hasOlder: true,
      olderCursor: "cap-cursor",
      loadingOlder: false,
      expanded: false,
      trimmed: true,
    }
    // The server reports no more history, but the cap is hiding loaded
    // messages, so "load older" must still resume from the cap's cursor.
    expect(tuiTranscriptFromTail({ hasMore: false }, trimmed)).toEqual(trimmed)
  })

  test("an older page advances the cursor and marks the window expanded", () => {
    const first = tuiTranscriptFromTail({ hasMore: true, next: "cursor-1" })
    const second = tuiTranscriptAfterOlderPage(first, { hasMore: true, next: "cursor-2" })
    expect(second).toEqual({
      hasOlder: true,
      olderCursor: "cursor-2",
      loadingOlder: false,
      expanded: true,
      trimmed: false,
    })
    const last = tuiTranscriptAfterOlderPage(second, { hasMore: false })
    expect(last.hasOlder).toBe(false)
    expect(last.olderCursor).toBeUndefined()
    expect(last.expanded).toBe(true)
  })

})

describe("tui transcript render cap", () => {
  test("keeps everything below the cap and leaves the window untouched", () => {
    const items = messages(TUI_SESSION_RENDER_CAP)
    const window = tuiTranscriptFromTail({ hasMore: false })
    const result = tuiTranscriptTrim(
      items.map((item) => item.id),
      lookup(items),
      window,
    )
    expect(result.ids.length).toBe(TUI_SESSION_RENDER_CAP)
    expect(result.window).toBe(window)
  })

  test("drops the oldest messages past the cap and repoints the older cursor", () => {
    const items = messages(TUI_SESSION_RENDER_CAP + 40)
    const result = tuiTranscriptTrim(
      items.map((item) => item.id),
      lookup(items),
      EMPTY_TUI_TRANSCRIPT_WINDOW,
    )
    expect(result.ids.length).toBe(TUI_SESSION_RENDER_CAP)
    expect(result.ids[0]).toBe("message-40")
    expect(result.ids.at(-1)).toBe(`message-${TUI_SESSION_RENDER_CAP + 39}`)
    expect(result.window.hasOlder).toBe(true)
    expect(result.window.trimmed).toBe(true)
    expect(result.window.olderCursor).toBe(tuiMessageCursorBefore(message(40)))
  })

  test("an expanded window is never trimmed, so load-older is not undone", () => {
    const items = messages(TUI_SESSION_RENDER_CAP * 2)
    const expanded = tuiTranscriptAfterOlderPage(EMPTY_TUI_TRANSCRIPT_WINDOW, { hasMore: true, next: "cursor-1" })
    const result = tuiTranscriptTrim(
      items.map((item) => item.id),
      lookup(items),
      expanded,
    )
    expect(result.ids.length).toBe(items.length)
    expect(result.window).toBe(expanded)
  })

  test("falling back under the cap clears the trimmed flag", () => {
    const items = messages(4)
    const trimmed: TuiTranscriptWindow = { ...EMPTY_TUI_TRANSCRIPT_WINDOW, hasOlder: true, trimmed: true }
    const result = tuiTranscriptTrim(
      items.map((item) => item.id),
      lookup(items),
      trimmed,
    )
    expect(result.window.trimmed).toBe(false)
    expect(result.window.hasOlder).toBe(true)
  })
})

describe("tui transcript cursor encoding", () => {
  test("matches the server's base64url cursor for a message", () => {
    const cursor = tuiMessageCursorBefore({ id: "msg_01", time: { created: 1730000000000 } })
    expect(cursor).toBe(Buffer.from(JSON.stringify({ id: "msg_01", time: 1730000000000 })).toString("base64url"))
    expect(JSON.parse(Buffer.from(cursor!, "base64url").toString("utf8"))).toEqual({
      id: "msg_01",
      time: 1730000000000,
    })
  })

  test("is undefined without a creation time", () => {
    expect(tuiMessageCursorBefore(undefined)).toBeUndefined()
    expect(tuiMessageCursorBefore({ id: "msg_01" } as never)).toBeUndefined()
  })
})

describe("tui warm session lru", () => {
  test("promotes to the front without duplicating", () => {
    const first = tuiWarmSessions([], "a")
    expect(first).toEqual({ warm: ["a"], evicted: [] })
    const second = tuiWarmSessions(["b", "a", "c"], "a")
    expect(second).toEqual({ warm: ["a", "b", "c"], evicted: [] })
  })

  test("evicts past the limit so the tail becomes releasable", () => {
    const filled = ["s4", "s3", "s2", "s1"]
    expect(filled.length).toBe(TUI_SESSION_WARM_LIMIT)
    const result = tuiWarmSessions(filled, "s5")
    expect(result.warm).toEqual(["s5", "s4", "s3", "s2"])
    expect(result.evicted).toEqual(["s1"])
  })

  test("removal is identity stable for absent sessions", () => {
    const current = ["a", "b"]
    expect(tuiWarmSessionsWithout(current, "c")).toBe(current)
    expect(tuiWarmSessionsWithout(current, "a")).toEqual(["b"])
  })
})

describe("tui transcript window equality", () => {
  test("compares every field and rejects undefined", () => {
    const window = tuiTranscriptFromTail({ hasMore: true, next: "cursor-1" })
    expect(sameTuiTranscriptWindow(undefined, window)).toBe(false)
    expect(sameTuiTranscriptWindow({ ...window }, window)).toBe(true)
    expect(sameTuiTranscriptWindow({ ...window, olderCursor: "cursor-2" }, window)).toBe(false)
    expect(sameTuiTranscriptWindow({ ...window, trimmed: true }, window)).toBe(false)
  })
})

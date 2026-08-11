import { describe, expect, test } from "bun:test"
import type { MessageBundle, SessionData } from "../src/renderer/src/lib/session-api"
import {
  EXPANDED_MESSAGE_WINDOW,
  collapseMessageWindow,
  prependOlderMessages,
  trimToLiveTail,
} from "../src/renderer/src/lib/message-window"
import { SESSION_MESSAGE_WINDOW, VIEW_MESSAGE_WINDOW } from "../src/renderer/src/lib/session-hydration"

describe("message window helpers", () => {
  test("prepends older pages without reordering messages", () => {
    const result = prependOlderMessages(
      sessionData([bundle("m3", 3), bundle("m4", 4)]),
      { messages: [bundle("m1", 1), bundle("m2", 2)], cursor: "older" },
    )

    expect(messageIDs(result)).toEqual(["m1", "m2", "m3", "m4"])
    expect(result.messageCursor).toBe("older")
    expect(result.messageWindowExpanded).toBe(true)
  })

  test("prepends older pages without trimming newer messages", () => {
    const result = prependOlderMessages(
      sessionData([bundle("m3", 3), bundle("m4", 4)]),
      { messages: [bundle("m1", 1), bundle("m2", 2)], cursor: "older" },
    )

    expect(messageIDs(result)).toEqual(["m1", "m2", "m3", "m4"])
    expect(result.messageCursor).toBe("older")
  })

  test("prepends only page messages while preserving current side data", () => {
    const todos = [{ content: "current", status: "pending", priority: "medium" }] as SessionData["todos"]
    const diffs = [{ file: "current.ts", additions: 1, deletions: 0 }] as SessionData["diffs"]
    const result = prependOlderMessages(
      { ...sessionData([bundle("m2", 2)]), todos, diffs },
      { messages: [bundle("m1", 1)], cursor: undefined },
    )

    expect(messageIDs(result)).toEqual(["m1", "m2"])
    expect(result.todos).toBe(todos)
    expect(result.diffs).toBe(diffs)
  })

  test("prepends older pages without detaching from latest", () => {
    const result = prependOlderMessages(
      sessionData([bundle("m3", 3, "x".repeat(1_800)), bundle("m4", 4)]),
      { messages: [bundle("m1", 1), bundle("m2", 2)], cursor: "older" },
    )

    expect(messageIDs(result)).toEqual(["m1", "m2", "m3", "m4"])
  })

  test("trims older messages when following the live tail", () => {
    const result = trimToLiveTail(
      sessionData([bundle("m1", 1), bundle("m2", 2), bundle("m3", 3), bundle("m4", 4)]),
      2,
    )

    expect(messageIDs(result)).toEqual(["m3", "m4"])
    expect(result.messageCursor).toBeTruthy()
  })

  test("keeps manually expanded windows during live tail trimming", () => {
    const result = trimToLiveTail(
      sessionData([bundle("m1", 1), bundle("m2", 2), bundle("m3", 3), bundle("m4", 4)], { messageWindowExpanded: true }),
      2,
    )

    expect(messageIDs(result)).toEqual(["m1", "m2", "m3", "m4"])
    expect(result.messageWindowExpanded).toBe(true)
  })

  test("trims expanded windows at the expanded message cap instead of never trimming", () => {
    const messages = Array.from({ length: EXPANDED_MESSAGE_WINDOW.count + 16 }, (_, index) =>
      bundle(`m${index}`, index + 1),
    )
    const result = trimToLiveTail(sessionData(messages, { messageWindowExpanded: true }), 2)

    expect(result.messages.length).toBe(EXPANDED_MESSAGE_WINDOW.count)
    expect(result.messages.at(-1)?.info.id).toBe(`m${EXPANDED_MESSAGE_WINDOW.count + 15}`)
    expect(result.messages[0]?.info.id).toBe("m16")
    expect(result.messageWindowExpanded).toBe(true)
    expect(result.messageCursor).toBeTruthy()
  })

  test("trims expanded windows at the expanded content budget", () => {
    // Each message weighs 600 plus its text, so 8_000 apiece: the 300_000 byte
    // expanded budget stops after 37 of them - above the minimum window floor,
    // so this exercises the budget cut alone.
    const messages = Array.from({ length: 60 }, (_, index) => bundle(`m${index}`, index + 1, "x".repeat(7_400)))
    const result = trimToLiveTail(sessionData(messages, { messageWindowExpanded: true }), 2)

    expect(result.messages.length).toBe(37)
    expect(result.messages.at(-1)?.info.id).toBe("m59")
  })

  test("collapses an expanded window back onto the live tail budget", () => {
    const result = collapseMessageWindow(
      sessionData([bundle("m1", 1), bundle("m2", 2), bundle("m3", 3), bundle("m4", 4)], {
        messageCursor: "older",
        messageWindowExpanded: true,
      }),
      2,
    )

    expect(messageIDs(result)).toEqual(["m3", "m4"])
    expect(result.messageWindowExpanded).toBeUndefined()
    expect(result.messageCursor).toBeTruthy()
    expect(result.messageCursor).not.toBe("older")
  })

  test("leaves a window that was never expanded untouched when collapsing", () => {
    const data = sessionData([bundle("m1", 1), bundle("m2", 2)])

    expect(collapseMessageWindow(data, 1)).toBe(data)
  })

  test("keeps the newest heavy message when following the live content budget", () => {
    const result = trimToLiveTail(
      sessionData([bundle("m1", 1), bundle("m2", 2), bundle("m3", 3), bundle("m4", 4, "x".repeat(1_800))]),
      { count: 10, budget: 1_400, minCount: 1 },
    )

    expect(messageIDs(result)).toEqual(["m4"])
    expect(result.messageCursor).toBeTruthy()
  })

  test("keeps the minimum window when heavy messages exceed the budget", () => {
    // Every message is over the whole budget by itself. Without a floor the
    // window collapses to the single newest message and the transcript renders
    // one message plus "Load more" - the reader must always keep scroll context.
    const messages = Array.from({ length: 8 }, (_, index) => bundle(`m${index + 1}`, index + 1, "x".repeat(1_800)))
    const result = trimToLiveTail(sessionData(messages), { count: 10, budget: 1_400, minCount: 4 })

    expect(messageIDs(result)).toEqual(["m5", "m6", "m7", "m8"])
    expect(result.messageCursor).toBeTruthy()
  })

  test("collapsing an expanded window never trims below the minimum count", () => {
    const messages = Array.from({ length: 8 }, (_, index) => bundle(`m${index + 1}`, index + 1, "x".repeat(1_800)))
    const result = collapseMessageWindow(
      sessionData(messages, { messageCursor: "older", messageWindowExpanded: true }),
      { count: 10, budget: 1_400, minCount: 4 },
    )

    expect(messageIDs(result)).toEqual(["m5", "m6", "m7", "m8"])
    expect(result.messageWindowExpanded).toBeUndefined()
  })

  test("live tail windows guarantee multiple messages even when every message is heavy", () => {
    // Regression: a logger-style session where each assistant turn alone
    // outweighs the byte budget must never trim to a single message.
    const messages = Array.from({ length: 64 }, (_, index) => bundle(`m${index + 1}`, index + 1, "x".repeat(20_000)))
    const session = trimToLiveTail(sessionData(messages), SESSION_MESSAGE_WINDOW)
    const view = trimToLiveTail(sessionData(messages), VIEW_MESSAGE_WINDOW)
    const expanded = trimToLiveTail(sessionData(messages, { messageWindowExpanded: true }), SESSION_MESSAGE_WINDOW)

    expect(session.messages.length).toBeGreaterThanOrEqual(SESSION_MESSAGE_WINDOW.minCount)
    expect(SESSION_MESSAGE_WINDOW.minCount).toBeGreaterThanOrEqual(8)
    expect(view.messages.length).toBeGreaterThanOrEqual(VIEW_MESSAGE_WINDOW.minCount)
    expect(VIEW_MESSAGE_WINDOW.minCount).toBeGreaterThanOrEqual(8)
    expect(expanded.messages.length).toBeGreaterThanOrEqual(EXPANDED_MESSAGE_WINDOW.minCount)
    expect(EXPANDED_MESSAGE_WINDOW.minCount).toBeGreaterThanOrEqual(8)
  })
})

function sessionData(messages: MessageBundle[], input: Partial<SessionData> = {}): SessionData {
  return { messages, todos: [], diffs: [], ...input }
}

function bundle(id: string, created: number, text = ""): MessageBundle {
  return {
    info: { id, sessionID: "session", role: "user", time: { created } } as MessageBundle["info"],
    parts: text
      ? [{ id: `${id}-text`, sessionID: "session", messageID: id, type: "text", text }] as MessageBundle["parts"]
      : [],
  }
}

function messageIDs(data: SessionData) {
  return data.messages.map((message) => message.info.id)
}

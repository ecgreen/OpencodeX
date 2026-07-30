import { describe, expect, test } from "bun:test"
import type { MessageBundle, SessionData } from "../src/renderer/src/lib/session-api"
import {
  EXPANDED_MESSAGE_WINDOW,
  collapseMessageWindow,
  prependOlderMessages,
  trimToLiveTail,
} from "../src/renderer/src/lib/message-window"

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
    // Each message weighs 600 plus its text, so 9_600 apiece: the 300_000 byte
    // expanded budget stops after 31 of them.
    const messages = Array.from({ length: 60 }, (_, index) => bundle(`m${index}`, index + 1, "x".repeat(9_000)))
    const result = trimToLiveTail(sessionData(messages, { messageWindowExpanded: true }), 2)

    expect(result.messages.length).toBe(31)
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
      { count: 10, budget: 1_400 },
    )

    expect(messageIDs(result)).toEqual(["m4"])
    expect(result.messageCursor).toBeTruthy()
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

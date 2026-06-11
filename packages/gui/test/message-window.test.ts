import { describe, expect, test } from "bun:test"
import type { MessageBundle, SessionData } from "../src/renderer/src/lib/store"
import { prependOlderMessages, trimToLiveTail } from "../src/renderer/src/lib/message-window"

describe("message window helpers", () => {
  test("prepends older pages without reordering messages", () => {
    const result = prependOlderMessages(
      sessionData([bundle("m3", 3), bundle("m4", 4)]),
      { messages: [bundle("m1", 1), bundle("m2", 2)], cursor: "older" },
    )

    expect(messageIDs(result)).toEqual(["m1", "m2", "m3", "m4"])
    expect(result.messageCursor).toBe("older")
  })

  test("prepends older pages without trimming newer messages", () => {
    const result = prependOlderMessages(
      sessionData([bundle("m3", 3), bundle("m4", 4)]),
      { messages: [bundle("m1", 1), bundle("m2", 2)], cursor: "older" },
    )

    expect(messageIDs(result)).toEqual(["m1", "m2", "m3", "m4"])
    expect(result.messageCursor).toBe("older")
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

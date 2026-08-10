import { describe, expect, test } from "bun:test"
import { claudeTurnMessage } from "../../src/session/prompt-swarm"

const messages = [
  { info: { id: "msg_1", role: "user" } },
  { info: { id: "msg_2", role: "assistant" } },
  { info: { id: "msg_3", role: "user" } }, // queued while a turn ran
  { info: { id: "msg_4", role: "user" } }, // queued later; the "last" one
]

describe("claudeTurnMessage", () => {
  test("returns the command's own message when a messageID is given", () => {
    expect(claudeTurnMessage(messages, "msg_3")?.info.id).toBe("msg_3")
  })

  test("falls back to the last user message without a messageID", () => {
    expect(claudeTurnMessage(messages, undefined)?.info.id).toBe("msg_4")
  })

  test("returns undefined for an unknown id or a non-user id", () => {
    expect(claudeTurnMessage(messages, "msg_nope")).toBeUndefined()
    expect(claudeTurnMessage(messages, "msg_2")).toBeUndefined()
  })
})

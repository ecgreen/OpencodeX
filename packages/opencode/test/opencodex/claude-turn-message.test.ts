import { describe, expect, test } from "bun:test"
import path from "node:path"
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

/**
 * `claudeTurnMessage` pins the selection *function's* semantics, but nothing
 * exercises PromptSwarm.claudeCodeTurn or PromptClaim end to end (constructing
 * PromptSwarm.make needs a stubbed db/sessions/skills/claudeDriver/prompt,
 * which is impractical here). Instead, pin the wiring at the source-text level
 * - the same style test/browser-ipc.test.ts uses - so that if a future edit
 * reverts `claudeCodeTurn`/`loop` back to always using `lastUserMessage`
 * (2026-08-10 spec, problem 2b: a queued message's own text getting resent N
 * times instead of each queued message being delivered), these tests fail.
 */
describe("§2b message threading is wired end to end (source-level pin)", () => {
  test("prompt-claim.ts threads the command's own message_id into the loop", async () => {
    const source = await Bun.file(
      path.join(import.meta.dirname, "../../src/session/prompt-claim.ts"),
    ).text()
    expect(source).toContain("messageID: command.message_id")
  })

  test("prompt.ts threads a turn's messageID into claudeCodeTurn's selection", async () => {
    const source = await Bun.file(path.join(import.meta.dirname, "../../src/session/prompt.ts")).text()
    expect(source).toContain("claudeCodeTurn(input.sessionID, input.messageID)")
  })

  test("prompt-swarm.ts' claudeCodeTurn picks the message by id when given one, else the last user message", async () => {
    const source = await Bun.file(path.join(import.meta.dirname, "../../src/session/prompt-swarm.ts")).text()
    expect(source).toContain("messageID ? yield* userMessage(sessionID, messageID) : yield* lastUserMessage(sessionID)")
  })
})

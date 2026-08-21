import { describe, expect, test } from "bun:test"
import { nextClaudeEvent } from "../../src/opencodex/claude-driver"
import { classifyClaudeError } from "../../src/opencodex/claude-auth-error"

describe("claude driver delivery failure", () => {
  test("keeps a rejection as data instead of throwing", async () => {
    const iterator = {
      next: () => Promise.reject(new Error("Failed to authenticate: OAuth session expired and could not be refreshed")),
    }
    const result = await nextClaudeEvent(iterator as never)
    expect("failure" in result).toBe(true)
  })

  test("an SDK auth throw classifies the same as a result-event auth error", async () => {
    const iterator = {
      next: () => Promise.reject(new Error("Failed to authenticate: OAuth session expired and could not be refreshed")),
    }
    const result = await nextClaudeEvent(iterator as never)
    const failure = "failure" in result ? result.failure : undefined
    const message = failure instanceof Error ? failure.message : String(failure)
    expect(classifyClaudeError(message)?.kind).toBe("auth-expired")
  })
})

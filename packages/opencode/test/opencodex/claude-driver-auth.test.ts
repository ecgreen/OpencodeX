import { describe, expect, test } from "bun:test"
import { nextClaudeEvent } from "../../src/opencodex/claude-driver"

describe("claude driver delivery failure", () => {
  test("keeps a rejection as data instead of throwing", async () => {
    const iterator = {
      next: () => Promise.reject(new Error("Failed to authenticate: OAuth session expired and could not be refreshed")),
    }
    const result = await nextClaudeEvent(iterator as never)
    expect("failure" in result).toBe(true)
  })
})

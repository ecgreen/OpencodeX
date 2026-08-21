import { describe, expect, test } from "bun:test"
import { claudeSessionAuthState } from "../src/renderer/src/lib/claude-session-auth"

describe("claude session auth state", () => {
  test("reads the metadata key the server actually writes", () => {
    expect(claudeSessionAuthState({ claudeCode: { launched: true, authState: "needs-login" } })).toBe("needs-login")
    expect(claudeSessionAuthState({ claudeCode: { launched: true, authState: "ready" } })).toBe("ready")
  })

  test("accepts a conversation that has an id but was never relaunched", () => {
    expect(claudeSessionAuthState({ claudeCode: { conversationID: "abc", authState: "needs-login" } })).toBe("needs-login")
  })

  test("returns undefined for anything that is not a launched claude conversation", () => {
    // The previous reader looked for `claudeDriver`, which nothing writes.
    expect(claudeSessionAuthState({ claudeDriver: { driver: "claude-code", authState: "needs-login" } })).toBeUndefined()
    expect(claudeSessionAuthState({ claudeCode: { launched: false } })).toBeUndefined()
    expect(claudeSessionAuthState({ claudeCode: { launched: true } })).toBeUndefined()
    expect(claudeSessionAuthState({ claudeCode: { launched: true, authState: "wat" } })).toBeUndefined()
    expect(claudeSessionAuthState({})).toBeUndefined()
    expect(claudeSessionAuthState(undefined)).toBeUndefined()
    expect(claudeSessionAuthState("nope")).toBeUndefined()
  })
})

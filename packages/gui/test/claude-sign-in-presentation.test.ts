import { describe, expect, test } from "bun:test"
import { claudeSignInBusy, claudeSignInLabel } from "../src/renderer/src/lib/claude-sign-in-presentation"

describe("claude sign-in button presentation", () => {
  test("names what the button will do at each phase", () => {
    expect(claudeSignInLabel("idle")).toBe("Sign in")
    expect(claudeSignInLabel("failed")).toBe("Try again")
    expect(claudeSignInLabel("signing-in")).toBe("Signing in...")
    expect(claudeSignInLabel("checking")).toBe("Checking...")
    expect(claudeSignInLabel("signed-in")).toBe("Sign in")
  })

  test("blocks a second attempt only while one is genuinely in flight", () => {
    expect(claudeSignInBusy("signing-in")).toBe(true)
    expect(claudeSignInBusy("checking")).toBe(true)
    expect(claudeSignInBusy("idle")).toBe(false)
    // A failed attempt must be retryable, or the banner becomes another dead end.
    expect(claudeSignInBusy("failed")).toBe(false)
    expect(claudeSignInBusy("signed-in")).toBe(false)
  })
})

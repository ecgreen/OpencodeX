import { describe, expect, test } from "bun:test"
import { classifyClaudeError } from "../../src/opencodex/claude-auth-error"

describe("claude auth error classification", () => {
  test("recognizes the expired-OAuth failure the CLI actually emits", () => {
    const result = classifyClaudeError("Failed to authenticate: OAuth session expired and could not be refreshed")
    expect(result?.kind).toBe("auth-expired")
    expect(result?.message).toContain("sign-in has expired")
    expect(result?.message).toContain("claude auth login")
  })

  test("keeps the raw CLI text so the reason is not lost", () => {
    const result = classifyClaudeError("Failed to authenticate: OAuth session expired and could not be refreshed")
    expect(result?.message).toContain("OAuth session expired and could not be refreshed")
  })

  test("still recognizes the failures the previous regex caught", () => {
    expect(classifyClaudeError("Not logged in. Please run /login")?.kind).toBe("auth-missing")
    expect(classifyClaudeError("Invalid API key · Please run /login")?.kind).toBe("auth-missing")
    expect(classifyClaudeError("Unauthorized: your API key is invalid")?.kind).toBe("auth-missing")
  })

  test("separates a revoked credential from one that was never there", () => {
    expect(classifyClaudeError("Your OAuth token has been revoked")?.kind).toBe("auth-expired")
    expect(classifyClaudeError("Your credentials expired")?.kind).toBe("auth-expired")
    expect(classifyClaudeError("Not logged in")?.kind).toBe("auth-missing")
  })

  test("ignores failures that merely mention an auth word", () => {
    expect(classifyClaudeError("Claude Code stopped: error_during_execution")).toBeUndefined()
    expect(classifyClaudeError("The build expired the cache and restarted")).toBeUndefined()
    expect(classifyClaudeError("I checked whether the session was still open.")).toBeUndefined()
    expect(classifyClaudeError("")).toBeUndefined()
    expect(classifyClaudeError("   ")).toBeUndefined()
  })

  test("recognizes the real 401 shape the CLI emits for a bad API key", () => {
    const result = classifyClaudeError('API Error: 401 {"type":"authentication_error","message":"invalid x-api-key"}')
    expect(result?.kind).toBe("auth-missing")
  })

  test("recognizes the CLI's backticked login instruction", () => {
    expect(classifyClaudeError("Please run `/login` to continue.")?.kind).toBe("auth-missing")
    // The un-backticked form the old pattern already caught keeps working.
    expect(classifyClaudeError("Please run /login")?.kind).toBe("auth-missing")
  })

  test("weakTierAllowed:false suppresses the weak credential+failure-word tier but not the strong patterns", () => {
    expect(
      classifyClaudeError("...the api key is invalid in the fixture", { weakTierAllowed: false }),
    ).toBeUndefined()
    expect(
      classifyClaudeError("...the api key is invalid in the fixture", { weakTierAllowed: true }),
    ).toBeDefined()
    // Unambiguous CLI text still classifies even with the weak tier off.
    expect(
      classifyClaudeError("Failed to authenticate: OAuth session expired and could not be refreshed", {
        weakTierAllowed: false,
      })?.kind,
    ).toBe("auth-expired")
  })
})

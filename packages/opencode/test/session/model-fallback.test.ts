import { describe, expect, test } from "bun:test"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { isModelFallbackError, shouldAdvanceModelFallback } from "../../src/session/model-fallback"

describe("model fallback error classification", () => {
  test.each([
    "insufficient_quota",
    "quota_exceeded",
    "usage_limit_reached",
    "usage_not_included",
    "billing_hard_limit_reached",
  ])("accepts recursive structured exhaustion code: %s", (code) => {
    expect(isModelFallbackError(apiError({ responseBody: JSON.stringify({ outer: [{ error: { code } }] }) }))).toBe(
      true,
    )
    expect(isModelFallbackError(apiError({ responseBody: JSON.stringify({ error: { type: code } }) }))).toBe(true)
  })

  test.each([
    apiError({ message: "insufficient_quota" }),
    apiError({ responseBody: "insufficient_quota" }),
    apiError({ responseBody: '{"message":"insufficient_quota"}' }),
    apiError({ responseBody: '{"code":"rate_limit_exceeded"}', statusCode: 429, isRetryable: true }),
    apiError({ responseBody: '{"type":"server_overloaded"}', statusCode: 503, isRetryable: true }),
    apiError({ metadata: { code: "quota_exceeded" } }),
    new SessionLegacy.AuthError({ providerID: "test", message: "quota_exceeded" }),
    new SessionLegacy.ContextOverflowError({ message: "usage_limit_reached" }),
    new SessionLegacy.AbortedError({ message: "cancelled" }),
    {
      name: "UnknownError",
      data: { message: "unknown", responseBody: '{"code":"quota_exceeded"}' },
    } as unknown as SessionLegacy.Assistant["error"],
  ])("rejects non-structured or non-usage errors", (error) => {
    expect(isModelFallbackError(error)).toBe(false)
  })
})

describe("model fallback turn safety", () => {
  test("advances only for the latest eligible empty assistant result", () => {
    expect(shouldAdvanceModelFallback([user(), assistant([], exhaustion())], "msg_user")).toBe(true)
    expect(
      shouldAdvanceModelFallback(
        [
          user(),
          assistant([], exhaustion()),
          assistant([], apiError({ responseBody: '{"code":"rate_limit_exceeded"}' })),
        ],
        "msg_user",
      ),
    ).toBe(false)
  })

  test("prior visible or side-effecting assistant parts permanently block advancement", () => {
    const latest = assistant([], exhaustion(), "msg_latest")
    expect(
      shouldAdvanceModelFallback(
        [user(), assistant([{ type: "text", text: "partial", synthetic: false }], exhaustion(), "msg_prior"), latest],
        "msg_user",
      ),
    ).toBe(false)
    expect(
      shouldAdvanceModelFallback(
        [user(), assistant([{ type: "tool", state: { status: "completed" } }], exhaustion(), "msg_prior"), latest],
        "msg_user",
      ),
    ).toBe(false)
    expect(
      shouldAdvanceModelFallback(
        [user(), assistant([{ type: "reasoning", text: "partial reasoning" }], exhaustion(), "msg_prior"), latest],
        "msg_user",
      ),
    ).toBe(false)
    expect(
      shouldAdvanceModelFallback(
        [
          user(),
          assistant([{ type: "file", mime: "text/plain", url: "data:text/plain,output" }], exhaustion(), "msg_prior"),
          latest,
        ],
        "msg_user",
      ),
    ).toBe(false)
  })

  test("allows internal step bookkeeping before an exhaustion failure", () => {
    expect(
      shouldAdvanceModelFallback(
        [user(), assistant([{ type: "step-start" }, { type: "step-finish" }], exhaustion())],
        "msg_user",
      ),
    ).toBe(true)
  })

  test("ignores unrelated assistant messages from another user turn", () => {
    expect(
      shouldAdvanceModelFallback(
        [user(), assistant([{ type: "tool" }], exhaustion(), "msg_other", "other_user"), assistant([], exhaustion())],
        "msg_user",
      ),
    ).toBe(true)
  })
})

function exhaustion() {
  return apiError({ responseBody: '{"error":{"code":"insufficient_quota"}}' })
}

function apiError(input: Partial<SessionLegacy.APIError["data"]>) {
  return new SessionLegacy.APIError({ message: "request failed", isRetryable: false, ...input })
}

function user(): SessionLegacy.WithParts {
  return { info: { id: "msg_user", role: "user" }, parts: [] } as unknown as SessionLegacy.WithParts
}

function assistant(
  parts: Array<Record<string, unknown>>,
  error: SessionLegacy.Assistant["error"],
  id = "msg_assistant",
  parentID = "msg_user",
): SessionLegacy.WithParts {
  return { info: { id, role: "assistant", parentID, error }, parts } as unknown as SessionLegacy.WithParts
}

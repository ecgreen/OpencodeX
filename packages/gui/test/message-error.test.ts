import type { GlobalEvent } from "@opencode-ai/sdk/v2/client"
import { describe, expect, test } from "bun:test"
import {
  messageErrorDetail,
  messageErrorProviderID,
  messageErrorStatusCode,
  messageErrorTitle,
  sessionErrorNotice,
  type MessageError,
} from "../src/renderer/src/lib/message-error"
import { visibleTranscriptMessageIDs, visibleTranscriptMessages } from "../src/renderer/src/lib/transcript-visibility"
import type { MessageBundle } from "../src/renderer/src/lib/store-types"

const authError: MessageError = {
  name: "ProviderAuthError",
  data: { providerID: "anthropic", message: "" },
}

function assistantBundle(error?: MessageError, parts: MessageBundle["parts"] = []): MessageBundle {
  return {
    info: {
      id: "msg_1",
      sessionID: "ses_1",
      role: "assistant",
      time: { created: 1 },
      error,
      parentID: "msg_0",
    },
    parts,
  } as unknown as MessageBundle
}

describe("message error copy", () => {
  test("names the failure instead of leaking the tag", () => {
    expect(messageErrorTitle(authError)).toBe("Provider not connected")
    expect(messageErrorTitle({ name: "APIError", data: { message: "bad", isRetryable: false } })).toBe("Provider request failed")
    expect(messageErrorTitle({ name: "SomethingNew", data: {} } as unknown as MessageError)).toBe("Something went wrong")
  })

  test("falls back to an actionable detail when the server sends none", () => {
    expect(messageErrorDetail(authError)).toBe("Add credentials for anthropic to use this model.")
    expect(messageErrorDetail({ ...authError, data: { providerID: "anthropic", message: "key rejected" } })).toBe("key rejected")
  })

  test("exposes the provider and status code the recovery UI needs", () => {
    expect(messageErrorProviderID(authError)).toBe("anthropic")
    expect(messageErrorProviderID({ name: "UnknownError", data: { message: "x" } })).toBeUndefined()
    expect(messageErrorStatusCode({ name: "APIError", data: { message: "x", isRetryable: false, statusCode: 401 } })).toBe(401)
  })
})

describe("sessionErrorNotice", () => {
  const event = (error?: MessageError) =>
    ({ directory: "/repo", payload: { id: "evt", type: "session.error", properties: { sessionID: "ses_1", error } } }) as unknown as GlobalEvent

  test("surfaces a turn that failed before any message existed", () => {
    expect(sessionErrorNotice(event(authError))).toBe("Provider not connected: Add credentials for anthropic to use this model.")
  })

  test("ignores aborts and unrelated events", () => {
    expect(sessionErrorNotice(event({ name: "MessageAbortedError", data: { message: "stopped" } }))).toBeUndefined()
    expect(sessionErrorNotice(event(undefined))).toBeUndefined()
    expect(sessionErrorNotice({ directory: "/repo", payload: { id: "evt", type: "session.idle", properties: {} } } as unknown as GlobalEvent)).toBeUndefined()
  })
})

describe("transcript visibility", () => {
  test("keeps a failed turn that produced no parts", () => {
    const messages = [assistantBundle(authError)]
    expect(visibleTranscriptMessages(messages)).toHaveLength(1)
    expect(visibleTranscriptMessageIDs(messages)).toEqual(["msg_1"])
  })

  test("still drops an empty turn that simply had nothing to say", () => {
    const messages = [assistantBundle(undefined)]
    expect(visibleTranscriptMessages(messages)).toHaveLength(0)
    expect(visibleTranscriptMessageIDs(messages)).toEqual([])
  })

  test("does not resurrect an interrupted turn", () => {
    const messages = [assistantBundle({ name: "MessageAbortedError", data: { message: "stopped" } })]
    expect(visibleTranscriptMessages(messages)).toHaveLength(0)
  })
})

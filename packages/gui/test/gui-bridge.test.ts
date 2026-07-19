import { describe, expect, test } from "bun:test"
import type { GlobalEvent } from "@opencode-ai/sdk/v2/client"
import { guiBridgeRequestFromEvent, guiBridgeScopes } from "../src/renderer/src/lib/gui-bridge"

describe("GUI bridge event validation", () => {
  test("deduplicates registration scopes across open directories and workspaces", () => {
    const scopes = guiBridgeScopes("C:/repo", [
      { directory: "C:/repo" },
      { directory: "D:/other", workspaceID: "wrk_one" },
      { directory: "D:/other", workspaceID: "wrk_one" },
      { directory: "D:/other", workspaceID: "wrk_two" },
      { directory: "" },
    ])

    expect(scopes).toHaveLength(3)
    expect(scopes).toContainEqual({ directory: "C:/repo", workspace: undefined })
    expect(scopes).toContainEqual({ directory: "D:/other", workspace: "wrk_one" })
    expect(scopes).toContainEqual({ directory: "D:/other", workspace: "wrk_two" })
  })

  test("accepts only correlated bridge requests with operation-specific input", () => {
    expect(guiBridgeRequestFromEvent(requestEvent({ clientID: "gui-1", operation: "browser.navigate", input: { url: "https://example.com/" } }), "gui-1")).toEqual({
      clientID: "gui-1",
      directory: "C:/repo",
      workspace: undefined,
      requestID: "gbr_1",
      sessionID: "ses_1",
      operation: "browser.navigate",
      input: { url: "https://example.com/" },
    })
    expect(guiBridgeRequestFromEvent(requestEvent({ clientID: "gui-other", operation: "browser.navigate", input: { url: "https://example.com/" } }), "gui-1")).toBeUndefined()
    expect(guiBridgeRequestFromEvent(requestEvent({ clientID: "gui-1", operation: "browser.snapshot", input: {} }), "gui-1")).toBeUndefined()
  })
})

function requestEvent(input: { clientID: string; operation: string; input: unknown }) {
  return {
    directory: "C:/repo",
    payload: {
      id: "evt_1",
      type: "opencodex.gui_bridge.request",
      properties: {
        requestID: "gbr_1",
        clientID: input.clientID,
        sessionID: "ses_1",
        operation: input.operation,
        input: input.input,
      },
    },
  } as unknown as GlobalEvent
}

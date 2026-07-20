import { describe, expect, test } from "bun:test"
import type { GlobalEvent } from "@opencode-ai/sdk/v2/client"
import {
  createGuiBridgeLease,
  GUI_BRIDGE_MAX_SCOPES,
  guiBridgeDesiredState,
  guiBridgeRequestMatchesSession,
  guiBridgeRequestFromEvent,
  guiBridgeScopes,
} from "../src/renderer/src/lib/gui-bridge"

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
    expect(scopes).toContainEqual({ directory: "C:/repo", workspaceID: undefined })
    expect(scopes).toContainEqual({ directory: "D:/other", workspaceID: "wrk_one" })
    expect(scopes).toContainEqual({ directory: "D:/other", workspaceID: "wrk_two" })
  })

  test("builds one bounded desired-state payload", () => {
    const actionable = {
      directory: `C:/repo-${GUI_BRIDGE_MAX_SCOPES + 19}`,
      workspaceID: `wrk_${GUI_BRIDGE_MAX_SCOPES + 19}`,
    }
    const desired = guiBridgeDesiredState({
      clientID: "gui-1",
      token: "a".repeat(32),
      capabilities: ["workspace.open", "workspace.open", "browser.state"],
      directory: "Z:/primary",
      sessions: Array.from({ length: GUI_BRIDGE_MAX_SCOPES + 20 }, (_, index) => ({
        directory: `C:/repo-${index}`,
        workspaceID: `wrk_${index}`,
      })),
      prioritySessions: [actionable],
    })

    expect(desired.clientID).toBe("gui-1")
    expect(desired.capabilities).toEqual(["workspace.open", "browser.state"])
    expect(desired.scopes).toHaveLength(GUI_BRIDGE_MAX_SCOPES)
    expect(desired.scopes).toContainEqual({ directory: "Z:/primary", workspaceID: undefined })
    expect(desired.scopes).toContainEqual(actionable)
    expect(desired.scopes).not.toContainEqual({ directory: "C:/repo-511", workspaceID: "wrk_511" })
    expect(new Set(desired.scopes.map((scope) => `${scope.directory}\n${scope.workspaceID ?? ""}`)).size).toBe(
      GUI_BRIDGE_MAX_SCOPES,
    )
  })

  test("renews unchanged desired state with one sync request", async () => {
    const syncs: unknown[] = []
    const unregisters: unknown[] = []
    const lease = createGuiBridgeLease({
      sync: async (desired) => {
        syncs.push(desired)
        return { generation: `gbl_${syncs.length}` }
      },
      unregister: async (input) => {
        unregisters.push(input)
      },
      onError: () => undefined,
    })
    const desired = guiBridgeDesiredState({
      clientID: "gui-1",
      token: "a".repeat(32),
      capabilities: ["workspace.open"],
      directory: "C:/repo",
      sessions: [],
    })

    await lease.update(desired)
    await lease.update(structuredClone(desired))
    expect(syncs).toHaveLength(1)
    await lease.renew()
    expect(syncs).toHaveLength(2)
    await lease.dispose()
    expect(unregisters).toEqual([{ clientID: "gui-1", token: "a".repeat(32), generation: "gbl_2" }])
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

  test("requires bridge event scope to match the resolved session", () => {
    const request = guiBridgeRequestFromEvent(
      requestEvent({ clientID: "gui-1", operation: "browser.state", input: {} }),
      "gui-1",
    )
    if (!request) throw new Error("Expected a valid request fixture")

    expect(guiBridgeRequestMatchesSession(request, { directory: "C:/repo" })).toBe(true)
    expect(guiBridgeRequestMatchesSession(request, { directory: "D:/other" })).toBe(false)
    expect(guiBridgeRequestMatchesSession({ ...request, workspace: "wrk_other" }, {
      directory: "C:/repo",
      workspaceID: "wrk_expected",
    })).toBe(false)
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

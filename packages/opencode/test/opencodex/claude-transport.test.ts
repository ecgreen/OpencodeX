import { describe, expect, test } from "bun:test"
import {
  DELEGATE_SERVER,
  DELEGATE_TOOL,
  delegateServer,
  resolveToolPermission,
  type TransportOptions,
} from "../../src/opencodex/claude-transport"

function fakeSdk() {
  const calls: { tool?: { name: string; description: string; extras?: Record<string, unknown> }; server?: Record<string, unknown> } = {}
  return {
    calls,
    sdk: {
      tool: (name: string, description: string, _schema: unknown, _handler: unknown, extras?: Record<string, unknown>) => {
        calls.tool = { name, description, extras }
        return { name, description }
      },
      createSdkMcpServer: (input: Record<string, unknown>) => {
        calls.server = input
        return input
      },
    } as unknown as typeof import("@anthropic-ai/claude-agent-sdk"),
  }
}

describe("delegateServer", () => {
  test("registers the delegate tool on the swarm server", () => {
    const { sdk, calls } = fakeSdk()
    delegateServer(sdk, { roles: [{ name: "Researcher 1" }], run: async () => "ok" })
    expect(calls.server?.name).toBe(DELEGATE_SERVER)
    expect(calls.tool?.name).toBe(DELEGATE_TOOL)
    expect(calls.tool?.description).toContain("Researcher 1")
  })

  test("marks the delegate tool concurrency-safe so parallel role calls actually run in parallel", () => {
    // The CLI executes in-process MCP tools serially unless the tool's
    // annotations mark it read-only: `isConcurrencySafe()` is
    // `annotations?.readOnlyHint ?? false`. Without this, an orchestrator
    // fanning two ten-minute roles out "in parallel" runs them back to back -
    // the second role never starts until the first returns.
    const { sdk, calls } = fakeSdk()
    delegateServer(sdk, { roles: [{ name: "Researcher 1" }], run: async () => "ok" })
    expect(calls.tool?.extras).toMatchObject({ annotations: { readOnlyHint: true } })
  })
})

describe("resolveToolPermission", () => {
  test("forwards the SDK control-request signal to the permission callback", async () => {
    const controller = new AbortController()
    const seen: { toolUseID?: string; signal?: AbortSignal } = {}
    const options = {
      cwd: "/tmp",
      canUseTool: async (_toolName, _input, toolUseID, signal) => {
        seen.toolUseID = toolUseID
        seen.signal = signal
        return { allow: true as const, input: { path: "approved" } }
      },
    } satisfies TransportOptions

    const result = await resolveToolPermission(options, "Read", { path: "original" }, {
      toolUseID: "tool-1",
      signal: controller.signal,
    })

    expect(seen).toEqual({ toolUseID: "tool-1", signal: controller.signal })
    expect(result).toEqual({ behavior: "allow", updatedInput: { path: "approved" } })
  })

  test("maps a denied permission callback without rewriting its message", async () => {
    const options = {
      cwd: "/tmp",
      canUseTool: async () => ({ allow: false as const, message: "Denied by policy." }),
    } satisfies TransportOptions

    expect(await resolveToolPermission(options, "Bash", { command: "pwd" })).toEqual({
      behavior: "deny",
      message: "Denied by policy.",
    })
  })
})

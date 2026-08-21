import { describe, expect, test } from "bun:test"
import { DELEGATE_SERVER, DELEGATE_TOOL, delegateServer, sdkPrompt } from "../../src/opencodex/claude-transport"

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

describe("sdkPrompt", () => {
  test("leaves text-only prompts unchanged", () => {
    expect(sdkPrompt("hello")).toBe("hello")
  })

  test("wraps native image content in an SDK user message", async () => {
    const prompt = sdkPrompt([
      { type: "text", text: "describe this" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "AAA=" },
      },
    ])
    expect(typeof prompt).not.toBe("string")
    const messages = []
    if (typeof prompt !== "string") for await (const message of prompt) messages.push(message)
    expect(messages).toEqual([
      {
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "text", text: "describe this" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA=" } },
          ],
        },
        parent_tool_use_id: null,
      },
    ])
  })
})

import { describe, expect, test } from "bun:test"
import {
  createDelegateCorrelator,
  DELEGATE_SERVER,
  DELEGATE_TOOL,
  delegateServer,
  sdkPrompt,
} from "../../src/opencodex/claude-transport"

type ToolHandler = (args: { role: string; prompt: string }) => Promise<unknown>

function fakeSdk() {
  const calls: {
    tool?: { name: string; description: string; extras?: Record<string, unknown>; handler: ToolHandler }
    server?: Record<string, unknown>
  } = {}
  return {
    calls,
    sdk: {
      tool: (name: string, description: string, _schema: unknown, handler: unknown, extras?: Record<string, unknown>) => {
        calls.tool = { name, description, extras, handler: handler as ToolHandler }
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

  test("hands the delegated run the tool call id the permission gate recorded", async () => {
    // Without the id the delegation has nothing to stamp the child session
    // onto, so the orchestrator's transcript row cannot drill down into it.
    const { sdk, calls } = fakeSdk()
    const correlator = createDelegateCorrelator()
    const delegated: Array<{ role: string; prompt: string; toolUseID?: string }> = []
    delegateServer(
      sdk,
      {
        roles: [{ name: "Coder" }],
        run: async (input) => {
          delegated.push(input)
          return "ok"
        },
      },
      correlator,
    )

    correlator.record({ role: "Coder", prompt: "Ship it" }, "toolu_1")
    await calls.tool?.handler({ role: "Coder", prompt: "Ship it" })

    expect(delegated).toEqual([{ role: "Coder", prompt: "Ship it", toolUseID: "toolu_1" }])
  })

  test("runs the delegation anyway when no id was recorded", async () => {
    const { sdk, calls } = fakeSdk()
    const delegated: Array<{ role: string; prompt: string; toolUseID?: string }> = []
    delegateServer(
      sdk,
      {
        roles: [{ name: "Coder" }],
        run: async (input) => {
          delegated.push(input)
          return "ok"
        },
      },
      createDelegateCorrelator(),
    )

    await calls.tool?.handler({ role: "Coder", prompt: "Ship it" })

    expect(delegated).toEqual([{ role: "Coder", prompt: "Ship it" }])
  })
})

describe("delegate correlator", () => {
  test("gives two identical calls in one turn distinct ids", () => {
    // An orchestrator fanning the same role and prompt out twice would
    // otherwise point both transcript rows at the first child session.
    const correlator = createDelegateCorrelator()
    correlator.record({ role: "Coder", prompt: "Ship it" }, "toolu_1")
    correlator.record({ role: "Coder", prompt: "Ship it" }, "toolu_2")

    expect(correlator.claim({ role: "Coder", prompt: "Ship it" })).toBe("toolu_1")
    expect(correlator.claim({ role: "Coder", prompt: "Ship it" })).toBe("toolu_2")
    expect(correlator.claim({ role: "Coder", prompt: "Ship it" })).toBeUndefined()
  })

  test("ignores a call it cannot key and never crosses roles", () => {
    const correlator = createDelegateCorrelator()
    correlator.record({ role: "Coder", prompt: "Ship it" }, undefined)
    correlator.record({ role: "Coder" }, "toolu_1")
    correlator.record({ role: "Reviewer", prompt: "Review it" }, "toolu_2")

    expect(correlator.claim({ role: "Coder", prompt: "Ship it" })).toBeUndefined()
    expect(correlator.claim({ role: "Reviewer", prompt: "Review it" })).toBe("toolu_2")
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

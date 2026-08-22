import { describe, expect, test } from "bun:test"
import { Deferred, Effect } from "effect"
import { EffectBridge } from "../../src/effect/bridge"
import { ClaudeDelegate } from "../../src/opencodex/claude-delegate"
import {
  createDelegateCorrelator,
  DELEGATE_SERVER,
  DELEGATE_TOOL,
  delegateServer,
  resolveToolPermission,
  sdkPrompt,
  type TransportOptions,
} from "../../src/opencodex/claude-transport"

function fakeSdk() {
  const calls: {
    tool?: {
      name: string
      description: string
      handler: (args: { role: string; prompt: string }, extra: unknown) => Promise<{
        isError?: boolean
        content: Array<{ type: "text"; text: string }>
      }>
      extras?: Record<string, unknown>
    }
    server?: Record<string, unknown>
  } = {}
  return {
    calls,
    sdk: {
      tool: (
        name: string,
        description: string,
        _schema: unknown,
        handler: (args: { role: string; prompt: string }, extra: unknown) => Promise<{
          isError?: boolean
          content: Array<{ type: "text"; text: string }>
        }>,
        extras?: Record<string, unknown>,
      ) => {
        calls.tool = { name, description, handler, extras }
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
    delegateServer(sdk, { roles: [{ name: "Researcher 1" }], run: async () => ({ ok: true, text: "ok" }) })
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
    delegateServer(sdk, { roles: [{ name: "Researcher 1" }], run: async () => ({ ok: true, text: "ok" }) })
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
          return { ok: true as const, text: "ok" }
        },
      },
      correlator,
    )

    correlator.record({ role: "Coder", prompt: "Ship it" }, "toolu_1")
    await calls.tool?.handler({ role: "Coder", prompt: "Ship it" }, {})

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
          return { ok: true as const, text: "ok" }
        },
      },
      createDelegateCorrelator(),
    )

    await calls.tool?.handler({ role: "Coder", prompt: "Ship it" }, {})

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

describe("delegateServer results", () => {
  test("returns a completed delegate report as ordinary MCP content", async () => {
    const { sdk, calls } = fakeSdk()
    delegateServer(sdk, {
      roles: [{ name: "Researcher" }],
      run: async () => ({ ok: true, text: "verified report" }),
    })

    expect(await calls.tool?.handler({ role: "Researcher", prompt: "Check it." }, {})).toEqual({
      content: [{ type: "text", text: "verified report" }],
    })
  })

  test("forwards the MCP signal and waits for interrupted delegate finalization", async () => {
    const { sdk, calls } = fakeSdk()
    const bridge = await Effect.runPromise(EffectBridge.make())
    const started = await Effect.runPromise(Deferred.make<void>())
    const controller = new AbortController()
    const events: string[] = []
    delegateServer(
      sdk,
      ClaudeDelegate.capability(bridge, {
        roles: [{ name: "Researcher" }],
        run: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined)
            return yield* Effect.never
          }).pipe(Effect.ensuring(Effect.sync(() => events.push("finalized")))),
      }),
    )

    const callback = calls.tool!.handler(
      { role: "Researcher", prompt: "Check it." },
      { signal: controller.signal },
    )
    await Effect.runPromise(Deferred.await(started))
    controller.abort()

    expect(await callback).toEqual({
      isError: true,
      content: [{ type: "text", text: "The delegated role was cancelled before it completed." }],
    })
    expect(events).toEqual(["finalized"])
  })

  test("does not start delegate work for a pre-aborted MCP request", async () => {
    const { sdk, calls } = fakeSdk()
    const bridge = await Effect.runPromise(EffectBridge.make())
    const controller = new AbortController()
    const events: string[] = []
    controller.abort()
    delegateServer(
      sdk,
      ClaudeDelegate.capability(bridge, {
        roles: [{ name: "Researcher" }],
        run: () => {
          events.push("created")
          return Effect.sync(() => events.push("started")).pipe(
            Effect.as({ ok: true as const, text: "unexpected" }),
            Effect.ensuring(Effect.sync(() => events.push("finalized"))),
          )
        },
      }),
    )

    expect(
      await calls.tool!.handler(
        { role: "Researcher", prompt: "Check it." },
        { signal: controller.signal },
      ),
    ).toEqual({
      isError: true,
      content: [{ type: "text", text: "The delegated role was cancelled before it completed." }],
    })
    expect(events).toEqual([])
  })

  test.each([
    ["cancelled", "The delegated role was cancelled before it completed."],
    ["errored", "The delegated role failed."],
    ["empty-output", "The delegated role completed without a usable report."],
    ["rejected", "The delegation request was rejected."],
  ] as const)("returns structured %s termination with its generic MCP error", async (reason, message) => {
    const { sdk, calls } = fakeSdk()
    delegateServer(sdk, {
      roles: [{ name: "Researcher" }],
      run: async () => ({ ok: false, reason }),
    })

    expect(await calls.tool?.handler({ role: "Researcher", prompt: "Check it." }, {})).toEqual({
      isError: true,
      content: [{ type: "text", text: message }],
    })
  })

  test("ignores an invalid MCP request signal", async () => {
    const { sdk, calls } = fakeSdk()
    let received: AbortSignal | undefined
    delegateServer(sdk, {
      roles: [{ name: "Researcher" }],
      run: async (input) => {
        received = input.signal
        return { ok: true, text: "ok" }
      },
    })

    await calls.tool?.handler({ role: "Researcher", prompt: "Check it." }, { signal: "not-a-signal" })
    expect(received).toBeUndefined()
  })

  test("does not expose unexpected delegate rejection messages", async () => {
    const { sdk, calls } = fakeSdk()
    const bridge = await Effect.runPromise(EffectBridge.make())
    const secret = "sk-live-delegate-secret"
    delegateServer(
      sdk,
      ClaudeDelegate.capability(bridge, {
        roles: [{ name: "Researcher" }],
        run: () => Effect.fail(new Error(`provider failed with ${secret}`)),
      }),
    )

    const result = await calls.tool?.handler({ role: "Researcher", prompt: "Check it." }, {})
    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "The delegated role failed." }],
    })
    expect(result?.content[0]?.text).not.toContain(secret)
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

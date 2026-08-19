import { describe, expect, test } from "bun:test"
import { Deferred, Effect } from "effect"
import { EffectBridge } from "../../src/effect/bridge"
import { ClaudeDelegate } from "../../src/opencodex/claude-delegate"
import {
  DELEGATE_SERVER,
  DELEGATE_TOOL,
  delegateServer,
  resolveToolPermission,
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

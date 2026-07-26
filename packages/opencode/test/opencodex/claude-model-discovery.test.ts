import { afterEach, describe, expect, mock, test } from "bun:test"
import * as transport from "../../src/opencodex/claude-transport"

const listSupportedModels = mock(async () => [{ value: "sonnet", displayName: "Sonnet" }])

// `mock.module` is process-wide, so the real module has to be preserved:
// replacing it wholesale strips exports other suites in the same run depend on
// (the driver's executable resolution, for one).
mock.module("../../src/opencodex/claude-transport", () => ({
  ...transport,
  ClaudeTransport: {
    ...transport.ClaudeTransport,
    listSupportedModels: (...args: unknown[]) => listSupportedModels(...(args as [])),
  },
}))

const { refreshClaudeCodeModels, resetClaudeCodeModels } = await import("../../src/provider/claude-code-provider")

afterEach(() => {
  resetClaudeCodeModels()
  listSupportedModels.mockClear()
})

describe("claude code model discovery", () => {
  test("spawns the CLI once per TTL, not once per provider refresh", async () => {
    expect((await refreshClaudeCodeModels(1_000)).map((model) => model.value)).toEqual(["sonnet"])
    await refreshClaudeCodeModels(2_000)
    await refreshClaudeCodeModels(60_000)
    expect(listSupportedModels).toHaveBeenCalledTimes(1)
  })

  test("re-discovers once the cached menu has aged out", async () => {
    await refreshClaudeCodeModels(1_000)
    await refreshClaudeCodeModels(1_000 + 5 * 60_000)
    expect(listSupportedModels).toHaveBeenCalledTimes(2)
  })

  test("a machine without the CLI backs off instead of probing every refresh", async () => {
    listSupportedModels.mockImplementationOnce(async () => {
      throw new Error("Claude Code is not installed.")
    })
    const models = await refreshClaudeCodeModels(1_000)
    // The picker still offers the stable tier aliases.
    expect(models.map((model) => model.value)).toContain("sonnet")
    expect(models.map((model) => model.value)).toContain("default")
    await refreshClaudeCodeModels(2_000)
    expect(listSupportedModels).toHaveBeenCalledTimes(1)
    // ...but retries sooner than a successful discovery would.
    await refreshClaudeCodeModels(1_000 + 60_000)
    expect(listSupportedModels).toHaveBeenCalledTimes(2)
  })

  test("an empty menu never replaces the fallback rows", async () => {
    listSupportedModels.mockImplementationOnce(async () => [])
    expect((await refreshClaudeCodeModels(1_000)).length).toBeGreaterThan(0)
  })
})

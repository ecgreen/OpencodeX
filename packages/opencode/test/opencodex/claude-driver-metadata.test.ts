import { describe, expect, test } from "bun:test"
import { ClaudeDriverMetadata } from "../../src/opencodex/claude-driver-metadata"
import { permissionPatterns } from "../../src/opencodex/claude-permission"
import { CLAUDE_CODE_DEFAULT_MODEL_ID, isClaudeCodeProvider, claudeCodeModelName, claudeCodeProviderInfo } from "../../src/provider/claude-code-provider"

describe("claude conversation metadata", () => {
  test("round-trips the conversation through free-form session metadata", () => {
    const metadata = ClaudeDriverMetadata.withConversation(
      { existing: true },
      { conversationID: "11111111-1111-4111-8111-111111111111", launched: true, modelID: "claude-fable-5" },
    )
    expect(metadata.existing).toBe(true)
    expect(ClaudeDriverMetadata.readConversation(metadata)).toEqual({
      conversationID: "11111111-1111-4111-8111-111111111111",
      launched: true,
      modelID: "claude-fable-5",
    })
  })

  test("reports no conversation for ordinary sessions", () => {
    expect(ClaudeDriverMetadata.readConversation(undefined)).toBeUndefined()
    expect(ClaudeDriverMetadata.readConversation({})).toBeUndefined()
  })

  test("carries billing forward so per-turn cost stays a delta", () => {
    const billed = { cost: 0.25, input: 10, output: 20, cacheRead: 1, cacheWrite: 2 }
    const metadata = ClaudeDriverMetadata.withConversation(undefined, {
      conversationID: "c",
      launched: true,
      billed,
    })
    expect(ClaudeDriverMetadata.readConversation(metadata)?.billed).toEqual(billed)
    // A malformed billing record is dropped rather than corrupting the delta.
    expect(ClaudeDriverMetadata.readConversation({ claudeCode: { conversationID: "c", billed: { cost: "x" } } })?.billed).toBeUndefined()
  })

  test("survives a first turn that has not been given a conversation id yet", () => {
    // Only Claude can mint a resumable id, so the record exists before it does.
    const metadata = ClaudeDriverMetadata.withConversation(undefined, { launched: true })
    expect(ClaudeDriverMetadata.readConversation(metadata)?.conversationID).toBeUndefined()
    expect(ClaudeDriverMetadata.readConversation(metadata)?.launched).toBe(true)
  })

  test("ignores a record with neither an id nor a launch", () => {
    expect(ClaudeDriverMetadata.readConversation({ claudeCode: { modelID: "sonnet" } })).toBeUndefined()
  })

  test("surfaces the auth state the session banner keys off", () => {
    const metadata = ClaudeDriverMetadata.withConversation(undefined, {
      conversationID: "c",
      launched: true,
      authState: "needs-login",
    })
    expect(ClaudeDriverMetadata.authState(metadata)).toBe("needs-login")
    expect(ClaudeDriverMetadata.authState({ claudeCode: { conversationID: "c", authState: "bogus" } })).toBeUndefined()
  })
})

describe("claude subscription provider", () => {
  test("falls back to tier aliases before the CLI has been asked", () => {
    const info = claudeCodeProviderInfo()
    expect(isClaudeCodeProvider(info.id)).toBe(true)
    expect(info.name).toBe("Claude Subscription")
    const models = Object.values(info.models)
    // defaultModelIDs() throws on a provider with no models.
    expect(models.length).toBeGreaterThan(0)
    expect(Object.keys(info.models)).toContain(CLAUDE_CODE_DEFAULT_MODEL_ID)
    // Compaction reads limit.context; Claude Code manages its own window.
    expect(models[0].limit.context).toBeGreaterThan(0)
    expect(models.every((model) => model.status === "active")).toBe(true)
  })

  test("labels models with the generation, not a bare tier name", () => {
    // The CLI's displayName is just "Fable"; its description carries the version.
    expect(claudeCodeModelName({ value: "claude-fable-5[1m]", displayName: "Fable", description: "Fable 5 · Most capable" })).toBe("Fable 5")
    expect(claudeCodeModelName({ value: "haiku", displayName: "Haiku", description: "Haiku 4.5 · Fastest" })).toBe("Haiku 4.5")
    expect(claudeCodeModelName({ value: "default", displayName: "Default (recommended)", description: "Opus 5 with 1M context · Best" })).toBe("Default (Opus 5 with 1M context)")
    expect(claudeCodeModelName({ value: "opus", displayName: "Opus" })).toBe("Opus")
    expect(claudeCodeModelName({ value: "mystery" })).toBe("mystery")
  })

  test("exposes effort levels as variants so the composer chip works", () => {
    const info = claudeCodeProviderInfo([
      { value: "sonnet", supportsEffort: true, supportedEffortLevels: ["low", "high", "bogus"] },
      { value: "haiku" },
      { value: "opus", supportsEffort: true },
    ])
    expect(Object.keys(info.models["sonnet"].variants)).toEqual(["low", "high"])
    // A model without effort support must not offer the chip at all.
    expect(Object.keys(info.models["haiku"].variants)).toEqual([])
    // Missing levels fall back to the full set rather than none.
    expect(Object.keys(info.models["opus"].variants)).toEqual(["low", "medium", "high", "xhigh", "max"])
  })

  test("keys models by the value the CLI accepts for --model", () => {
    const info = claudeCodeProviderInfo([
      { value: "claude-fable-5[1m]", displayName: "Fable", description: "Most capable" },
      { value: "sonnet", displayName: "Sonnet" },
    ])
    expect(Object.keys(info.models)).toEqual(["claude-fable-5[1m]", "sonnet"])
    expect(info.models["claude-fable-5[1m]"]).toMatchObject({ name: "Fable", api: { id: "claude-fable-5[1m]" } })
    // A row without a display name still has to render as something.
    expect(claudeCodeProviderInfo([{ value: "opus" }]).models["opus"].name).toBe("opus")
  })

  test("never publishes an empty menu", () => {
    expect(Object.keys(claudeCodeProviderInfo([]).models).length).toBeGreaterThan(0)
  })

  test("does not claim to be another provider", () => {
    expect(isClaudeCodeProvider("anthropic")).toBe(false)
    expect(isClaudeCodeProvider("openai")).toBe(false)
  })
})

describe("claude permission patterns", () => {
  test("describes the action rather than the single invocation", () => {
    // "Always allow" stores these, so a bash pattern is the program, not the
    // whole command line.
    expect(permissionPatterns("bash", { command: "git status --short" })).toEqual(["git"])
    expect(permissionPatterns("edit", { file_path: "src/app.ts" })).toEqual(["src/app.ts"])
    expect(permissionPatterns("webfetch", { url: "https://docs.example.com/a/b" })).toEqual(["docs.example.com"])
    expect(permissionPatterns("websearch", { query: "solid signals" })).toEqual(["solid signals"])
  })

  test("falls back to the tool name when the input has nothing to key on", () => {
    expect(permissionPatterns("bash", {})).toEqual(["bash"])
    expect(permissionPatterns("edit", {})).toEqual(["edit"])
    expect(permissionPatterns("mcp__github__create_issue", { repo: "x" })).toEqual(["mcp__github__create_issue"])
  })
})

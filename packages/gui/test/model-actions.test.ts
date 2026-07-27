import { describe, expect, test } from "bun:test"
import type { Agent, Provider } from "@opencode-ai/sdk/v2/client"
import { runCycleVariantAction, runSwitchAgentAction, runSwitchModelAction, runSwitchVariantAction } from "../src/renderer/src/lib/model-actions"

describe("GUI model actions", () => {
  test("switches model and resets variant when a model is chosen", async () => {
    const events: string[] = []
    let promptOptions: string[] = []

    await runSwitchModelAction({
      providers: [
        provider("anthropic", "Anthropic", { old: model("old", "Old", "deprecated"), claude: model("claude", "Claude") }),
        provider("opencode", "Opencode", { free: { ...model("free", "Free"), cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } }),
      ],
      alert: (message) => events.push(`alert:${message}`),
      askChoice: async (input) => {
        promptOptions = input.options.map((option) => `${option.value}:${option.meta ?? ""}`)
        return "opencode/free"
      },
      setSelectedModel: (value) => events.push(`model:${value}`),
      setSelectedVariant: (value) => events.push(`variant:${value}`),
      rememberModel: (value) => events.push(`remember:${value}`),
    })

    expect(promptOptions).toEqual(["opencode/free:Free", "anthropic/claude:"])
    expect(events).toEqual(["model:opencode/free", "variant:", "remember:opencode/free"])
  })

  test("alerts when there are no selectable models", async () => {
    const events: string[] = []

    await runSwitchModelAction({
      providers: [provider("anthropic", "Anthropic", { old: model("old", "Old", "deprecated") })],
      alert: (message) => events.push(message),
      askChoice: async () => "anthropic/old",
      setSelectedModel: (value) => events.push(value),
      setSelectedVariant: (value) => events.push(value),
      rememberModel: (value) => events.push(value),
    })

    expect(events).toEqual(["No models available."])
  })

  test("switches only visible primary agents", async () => {
    const events: string[] = []
    let promptOptions: string[] = []

    await runSwitchAgentAction({
      agents: [agent("build", "primary"), agent("hidden", "primary", true), agent("review", "subagent")],
      alert: (message) => events.push(`alert:${message}`),
      askChoice: async (input) => {
        promptOptions = input.options.map((option) => option.value)
        return "build"
      },
      setSelectedAgent: (value) => events.push(`agent:${value}`),
    })

    expect(promptOptions).toEqual(["build"])
    expect(events).toEqual(["agent:build"])
  })

  test("allows switching variant back to provider default", async () => {
    const events: string[] = []

    await runSwitchVariantAction({
      providers: [provider("anthropic", "Anthropic", { claude: { ...model("claude", "Claude"), variants: { fast: {}, slow: {} } } })],
      selectedModel: "anthropic/claude",
      alert: (message) => events.push(`alert:${message}`),
      askChoice: async () => "",
      setSelectedVariant: (value) => events.push(`variant:${value}`),
    })

    expect(events).toEqual(["variant:"])
  })

  test("cycles variants and alerts when no variants exist", () => {
    const events: string[] = []
    const providers = [provider("anthropic", "Anthropic", { claude: { ...model("claude", "Claude"), variants: { fast: {}, slow: {} } } })]

    runCycleVariantAction({
      providers,
      selectedModel: "anthropic/claude",
      selectedVariant: "fast",
      alert: (message) => events.push(`alert:${message}`),
      setSelectedVariant: (value) => events.push(`variant:${value}`),
    })

    runCycleVariantAction({
      providers,
      selectedModel: "anthropic/missing",
      selectedVariant: "",
      alert: (message) => events.push(`alert:${message}`),
      setSelectedVariant: (value) => events.push(`variant:${value}`),
    })

    expect(events).toEqual(["variant:slow", "alert:The selected model does not expose variants."])
  })
})

function agent(name: string, mode: string, hidden = false): Agent {
  return { name, mode, hidden, description: `${name} agent` } as Agent
}

function provider(id: string, name: string, models: Provider["models"]): Provider {
  return { id, name, models } as Provider
}

function model(id: string, name: string, status = "available"): Provider["models"][string] {
  return { id, name, status } as Provider["models"][string]
}

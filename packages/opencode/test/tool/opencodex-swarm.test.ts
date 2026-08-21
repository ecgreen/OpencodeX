import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Parameters } from "../../src/tool/opencodex_swarm"

test("swarm create tool accepts ordered role fallback models", () => {
  const input = Schema.decodeUnknownSync(Parameters)({
    prompt: "Build the feature",
    roles: [
      {
        name: "Builder",
        instructions: "Implement it",
        providerID: "anthropic",
        modelID: "claude",
        variant: "high",
        fallbackModels: [
          { providerID: "openai", modelID: "gpt-5", variant: "medium" },
          { providerID: "google", modelID: "gemini-3" },
        ],
      },
    ],
  })
  expect(input.roles?.[0]?.fallbackModels).toEqual([
    { providerID: "openai", modelID: "gpt-5", variant: "medium" },
    { providerID: "google", modelID: "gemini-3" },
  ])
})

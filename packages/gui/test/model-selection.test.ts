import { describe, expect, test } from "bun:test"
import type { Provider, Session } from "@opencode-ai/sdk/v2/client"
import {
  firstAvailableModel,
  modelPickerOptions,
  modelPickerProviders,
  selectedModelVariants,
  sessionModelDefaults,
} from "../src/renderer/src/lib/model-selection"

describe("GUI model selection helpers", () => {
  test("prefers opencode and skips deprecated models for first available selection", () => {
    expect(
      firstAvailableModel([
        provider("anthropic", "Anthropic", { claude: model("claude", "Claude") }),
        provider("opencode", "Opencode", { old: model("old", "Old", "deprecated"), free: model("free", "Free") }),
      ]),
    ).toBe("opencode/free")
  })

  test("keeps alpha catalog models visible while excluding deprecated ones from the picker", () => {
    const options = modelPickerOptions([
      provider("opencode", "Opencode", {
        "x-preview-f-free": model("x-preview-f-free", "Ox Alpha Free", "alpha"),
        old: model("old", "Old", "deprecated"),
      }),
    ])

    expect(options.map((option) => option.model.id)).toEqual(["x-preview-f-free"])
  })

  test("builds session composer defaults from session, recents, and providers", () => {
    expect(
      sessionModelDefaults(
        {
          ...session("s1"),
          agent: "build",
          model: { providerID: "anthropic", id: "claude", variant: "fast" },
        } as Session,
        ["opencode/free"],
        [],
      ),
    ).toEqual({ agent: "build", model: "anthropic/claude", variant: "fast" })

    expect(sessionModelDefaults(session("s2"), ["opencode/free"], [])).toEqual({
      agent: "",
      model: "opencode/free",
      variant: "",
    })
    expect(
      sessionModelDefaults(
        session("s3"),
        [],
        [provider("anthropic", "Anthropic", { claude: model("claude", "Claude") })],
      ),
    ).toEqual({ agent: "", model: "anthropic/claude", variant: "" })
  })

  test("exposes GPT-5.6 Sol max variant from the backend", () => {
    const sol = {
      ...model("gpt-5.6-sol", "GPT-5.6 Sol"),
      variants: { low: {}, medium: {}, high: {}, xhigh: {}, max: {} },
    }

    expect(selectedModelVariants([provider("openai", "OpenAI", { "gpt-5.6-sol": sol })], "openai/gpt-5.6-sol")).toEqual(
      ["low", "medium", "high", "xhigh", "max"],
    )
  })

  test("limits inline model controls to connected providers while preserving saved selections", () => {
    const providers = [
      provider("catalog", "Catalog", { huge: model("huge", "Huge") }),
      provider("anthropic", "Anthropic", { claude: model("claude", "Claude") }),
      provider("opencode", "OpenCode", { free: model("free", "Free") }),
      provider("saved", "Saved", { old: model("old", "Old") }),
    ]

    expect(modelPickerProviders(providers, ["anthropic"], ["saved"]).map((item) => item.id)).toEqual([
      "opencode",
      "anthropic",
      "saved",
    ])
  })
})

function session(id: string): Session {
  return { id, directory: "C:\\Work\\OpencodeX", time: { updated: 1 } } as Session
}

function provider(id: string, name: string, models: Provider["models"]): Provider {
  return { id, name, models } as Provider
}

function model(id: string, name: string, status = "available"): Provider["models"][string] {
  return { id, name, status } as Provider["models"][string]
}

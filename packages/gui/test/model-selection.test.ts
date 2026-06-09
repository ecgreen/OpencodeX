import { describe, expect, test } from "bun:test"
import type { Provider, Session } from "@opencode-ai/sdk/v2/client"
import { firstAvailableModel, sessionModelDefaults } from "../src/renderer/src/lib/model-selection"

describe("GUI model selection helpers", () => {
  test("prefers opencode and skips deprecated models for first available selection", () => {
    expect(firstAvailableModel([
      provider("anthropic", "Anthropic", { claude: model("claude", "Claude") }),
      provider("opencode", "Opencode", { old: model("old", "Old", "deprecated"), free: model("free", "Free") }),
    ])).toBe("opencode/free")
  })

  test("builds session composer defaults from session, recents, and providers", () => {
    expect(sessionModelDefaults({
      ...session("s1"),
      agent: "build",
      model: { providerID: "anthropic", id: "claude", variant: "fast" },
    } as Session, ["opencode/free"], [])).toEqual({ agent: "build", model: "anthropic/claude", variant: "fast" })

    expect(sessionModelDefaults(session("s2"), ["opencode/free"], [])).toEqual({ agent: "", model: "opencode/free", variant: "" })
    expect(sessionModelDefaults(session("s3"), [], [provider("anthropic", "Anthropic", { claude: model("claude", "Claude") })])).toEqual({ agent: "", model: "anthropic/claude", variant: "" })
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

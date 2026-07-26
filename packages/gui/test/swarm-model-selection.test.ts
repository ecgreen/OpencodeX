import type { Provider, Session } from "@opencode-ai/sdk/v2/client"
import { describe, expect, test } from "bun:test"
import {
  SWARM_PROVIDER_ID,
  firstAvailableModel,
  isSwarmModelValue,
  modelPickerProviders,
  swarmModelValue,
} from "../src/renderer/src/lib/model-selection"
import { swarmSessions } from "../src/renderer/src/lib/swarm-actions"

const model = (id: string, providerID: string) =>
  ({ id, providerID, name: id, status: "active", cost: { input: 1 }, models: {} }) as unknown as Provider["models"][string]

const provider = (id: string, models: string[]): Provider =>
  ({ id, name: id, models: Object.fromEntries(models.map((m) => [m, model(m, id)])) }) as unknown as Provider

const providers = [provider("swarm", ["swm_1"]), provider("anthropic", ["claude-fable-5"])]

describe("swarm model selection", () => {
  test("swarm values route through the synthetic provider", () => {
    expect(swarmModelValue("swm_1")).toBe("swarm/swm_1")
    expect(isSwarmModelValue("swarm/swm_1")).toBe(true)
    expect(isSwarmModelValue("anthropic/claude-fable-5")).toBe(false)
  })

  test("a swarm never becomes the accidental default model", () => {
    // Even when the swarm provider sorts first, defaults skip it.
    expect(firstAvailableModel(providers)).toBe("anthropic/claude-fable-5")
  })

  test("swarms are excluded from role/generic provider lists", () => {
    const listed = modelPickerProviders(providers, ["swarm", "anthropic"])
    expect(listed.map((item) => item.id)).toEqual(["anthropic"])
  })
})

describe("swarmSessions", () => {
  const session = (id: string, providerID: string, modelID: string, updated: number, parentID?: string) =>
    ({ id, model: { providerID, id: modelID }, parentID, time: { created: 1, updated } }) as unknown as Session

  test("finds top-level sessions running on the swarm, newest first", () => {
    const sessions = [
      session("ses_old", SWARM_PROVIDER_ID, "swm_1", 10),
      session("ses_new", SWARM_PROVIDER_ID, "swm_1", 20),
      session("ses_other_swarm", SWARM_PROVIDER_ID, "swm_2", 30),
      session("ses_plain", "anthropic", "claude-fable-5", 40),
      // Specialist subagent sessions are children and stay hidden.
      session("ses_child", SWARM_PROVIDER_ID, "swm_1", 50, "ses_new"),
    ]
    expect(swarmSessions(sessions, "swm_1").map((item) => item.id)).toEqual(["ses_new", "ses_old"])
  })
})

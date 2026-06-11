import { describe, expect, test } from "bun:test"
import type { Agent, OpencodeXSwarm, OpencodeXSwarmRun } from "@opencode-ai/sdk/v2/client"
import {
  defaultSwarmRoles,
  isActiveSwarmStatus,
  opencodeXSwarmExecutionMode,
  roleInput,
  swarmDisplayStatus,
  swarmRunSessionID,
} from "../src/renderer/src/lib/swarm-actions"
import type { GuiSnapshot } from "../src/renderer/src/lib/store"

describe("GUI swarm action helpers", () => {
  test("chooses swarm execution mode from the selected agent", () => {
    expect(opencodeXSwarmExecutionMode("plan")).toBe("plan")
    expect(opencodeXSwarmExecutionMode("build")).toBe("build")
    expect(opencodeXSwarmExecutionMode()).toBe("build")
  })

  test("normalizes role payloads without empty optional fields", () => {
    expect(roleInput({ name: "  Lead  ", agent: " ", providerID: "opencode", modelID: " zen ", instructions: "  Coordinate " })).toEqual({
      name: "Lead",
      providerID: "opencode",
      modelID: "zen",
      instructions: "Coordinate",
      agent: undefined,
      skill: undefined,
      modelProfile: undefined,
      metadata: undefined,
    })
  })

  test("builds default orchestrator and specialist roles from primary agents", () => {
    expect(defaultSwarmRoles({
      agents: [
        { name: "orchestrator", mode: "primary", model: { providerID: "p1", modelID: "m1" } } as Agent,
        { name: "build", mode: "all", model: { providerID: "p2", modelID: "m2" } } as Agent,
      ],
    }).map((role) => [role.name, role.agent, role.providerID, role.modelID])).toEqual([
      ["Orchestrator", "orchestrator", "p1", "m1"],
      ["Specialist", "build", "p2", "m2"],
    ])
  })

  test("opens the best available session for a swarm run", () => {
    expect(swarmRunSessionID(run({ resultSessionID: "result", orchestratorSessionID: "lead", agents: [{ sessionID: "agent" }] }))).toBe("result")
    expect(swarmRunSessionID(run({ orchestratorSessionID: "lead", agents: [{ sessionID: "agent" }] }))).toBe("lead")
    expect(swarmRunSessionID(run({ agents: [{ sessionID: "agent" }] }))).toBe("agent")
  })

  test("derives active display status from session state before run state", () => {
    const swarm = { id: "swarm", status: "running", runs: [run({ resultSessionID: "s1", status: "queued" })] } as OpencodeXSwarm
    const snapshot = { sessionStatus: { s1: { type: "in_progress" } } } as GuiSnapshot

    expect(swarmDisplayStatus(swarm, snapshot)).toBe("in_progress")
    expect(isActiveSwarmStatus("in_progress")).toBe(true)
    expect(isActiveSwarmStatus("completed")).toBe(false)
  })
})

function run(input: Partial<OpencodeXSwarmRun>): OpencodeXSwarmRun {
  return {
    id: "run",
    swarmID: "swarm",
    title: "Run",
    prompt: "Prompt",
    status: "running",
    source: "manual",
    agents: [],
    timeCreated: 1,
    timeUpdated: 1,
    ...input,
  }
}

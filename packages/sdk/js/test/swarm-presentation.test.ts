import { describe, expect, test } from "bun:test"
import {
  activeClientSwarmRun,
  clientSwarmDisplayStatus,
  clientSwarmRunSessionID,
  clientSwarmStatusLabel,
  currentClientSwarmRun,
  isActiveSwarmStatus,
  isTerminalSwarmStatus,
} from "../src/v2/swarm-presentation"

describe("swarm presentation", () => {
  test("orders and selects the current and active run consistently", () => {
    const swarm = {
      status: "running",
      runs: [
        { id: "old", status: "completed", timeUpdated: 10, resultSessionID: "result" },
        { id: "new", status: "cancelling", timeUpdated: 20, orchestratorSessionID: "orchestrator" },
      ],
    }

    expect(currentClientSwarmRun(swarm)?.id).toBe("new")
    expect(activeClientSwarmRun(swarm)?.id).toBe("new")
    expect(clientSwarmDisplayStatus(swarm)).toBe("cancelling")
    expect(clientSwarmRunSessionID(swarm.runs[1])).toBe("orchestrator")
  })

  test("classifies lifecycle and partial-result states", () => {
    expect(isActiveSwarmStatus("cancelling")).toBe(true)
    expect(isActiveSwarmStatus("retrying")).toBe(true)
    expect(isTerminalSwarmStatus("partially_failed")).toBe(true)
    expect(isActiveSwarmStatus("partially_failed")).toBe(false)
    expect(clientSwarmStatusLabel("partially_failed")).toBe("Partially failed")
  })
})

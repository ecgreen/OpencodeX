import { describe, expect, test } from "bun:test"
import {
  clientSwarmDisplayStatus,
  clientSwarmStatusLabel,
  isActiveSwarmStatus,
  isTerminalSwarmStatus,
} from "../src/v2/swarm-presentation"

describe("swarm presentation", () => {
  test("displays the swarm's own status", () => {
    expect(clientSwarmDisplayStatus({ status: "cancelling" })).toBe("cancelling")
    expect(clientSwarmDisplayStatus({})).toBe("planned")
  })

  test("classifies lifecycle and partial-result states", () => {
    expect(isActiveSwarmStatus("cancelling")).toBe(true)
    expect(isActiveSwarmStatus("retrying")).toBe(true)
    expect(isTerminalSwarmStatus("partially_failed")).toBe(true)
    expect(isActiveSwarmStatus("partially_failed")).toBe(false)
    expect(clientSwarmStatusLabel("partially_failed")).toBe("Partially failed")
  })
})

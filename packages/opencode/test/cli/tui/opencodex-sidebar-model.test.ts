import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2"
import { sessionSwarmID, sessionSwarmTitle } from "../../../src/cli/cmd/tui/component/opencodex-sidebar-model"

describe("OpencodeX sidebar swarm labels", () => {
  test("resolves a swarm title from the durable session model", () => {
    const value = session({ model: { providerID: "swarm", id: "swm_1" } })

    expect(sessionSwarmID(value)).toBe("swm_1")
    expect(sessionSwarmTitle(value, [{ id: "swm_1", title: "Reliability Team" }])).toBe("Reliability Team")
  })

  test("prefers explicit swarm metadata during migration", () => {
    const value = session({
      metadata: { opencodex: { swarmID: "swm_metadata" } },
      model: { providerID: "swarm", id: "swm_model" },
    })

    expect(sessionSwarmID(value)).toBe("swm_metadata")
  })

  test("does not treat regular models as swarms", () => {
    const value = session({ model: { providerID: "openai", id: "gpt-5" } })

    expect(sessionSwarmID(value)).toBeUndefined()
  })
})

function session(input: Partial<Session>): Session {
  return {
    id: "ses_1",
    slug: "test",
    projectID: "project_1",
    directory: "/tmp",
    title: "Test session",
    version: "test",
    time: { created: 0, updated: 0 },
    ...input,
  }
}

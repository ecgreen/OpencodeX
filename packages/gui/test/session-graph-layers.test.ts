import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { buildSessionGraph, type SessionGraph } from "../src/renderer/src/lib/session-graph"
import { layoutSessionGraph } from "../src/renderer/src/lib/session-graph-layout"

/**
 * A layered workflow, the shape real graph engineering produces: the designer
 * drafts, hands to the senior engineer who builds, who hands back to the
 * designer to validate - and only then does the work consolidate.
 *
 * The single fan-out/fan-in star is the degenerate case, not the model.
 */

const swarmID = "swm_layers"

function session(input: { id: string; title: string; parentID?: string; role?: string; created: number }): Session {
  return {
    id: input.id,
    slug: input.id,
    projectID: "prj",
    directory: "/work",
    title: input.title,
    version: "test",
    time: { created: input.created, updated: input.created + 1 },
    ...(input.parentID ? { parentID: input.parentID } : {}),
    ...(input.parentID
      ? { metadata: { opencodex: { swarmID, swarmRole: input.role, swarmDepth: 1 } } }
      : { model: { id: swarmID, providerID: "swarm" } }),
  } as Session
}

// orchestrator -> Designer(draft) -> Senior Engineer(build) -> Designer(validate)
const chain = [
  session({ id: "root", title: "Ship the login page", created: 1 }),
  session({ id: "draft", title: "Draft the login page", parentID: "root", role: "Designer", created: 2 }),
  session({ id: "build", title: "Build the login page", parentID: "draft", role: "Senior Engineer", created: 3 }),
  session({ id: "validate", title: "Validate the build", parentID: "build", role: "Designer", created: 4 }),
]

const input = (sessions: readonly Session[], sessionStatus?: Record<string, { type?: string }>) => ({
  sessionID: "root",
  workItems: [],
  sessions,
  jobs: [],
  swarms: [],
  ...(sessionStatus ? { sessionStatus } : {}),
})

const node = (graph: SessionGraph, id: string) => graph.nodes.find((item) => item.id === id)

describe("layered swarm workflow", () => {
  test("each hand-off becomes its own layer rather than another branch off the root", () => {
    const graph = buildSessionGraph(input(chain))
    expect(node(graph, "session:root")?.depth).toBe(0)
    expect(node(graph, "session:draft")?.depth).toBe(1)
    expect(node(graph, "session:build")?.depth).toBe(2)
    expect(node(graph, "session:validate")?.depth).toBe(3)
    // The chain is edges between the layers, not three siblings under the root.
    expect(graph.edges.some((edge) => edge.from === "session:draft" && edge.to === "session:build")).toBe(true)
    expect(graph.edges.some((edge) => edge.from === "session:build" && edge.to === "session:validate")).toBe(true)
    expect(graph.edges.some((edge) => edge.from === "session:root" && edge.to === "session:build")).toBe(false)
  })

  test("the role travels with each hand-off, so a layer is attributed to its owner", () => {
    const graph = buildSessionGraph(input(chain))
    expect(node(graph, "session:draft")?.role).toBe("Designer")
    expect(node(graph, "session:build")?.role).toBe("Senior Engineer")
    expect(node(graph, "session:validate")?.role).toBe("Designer")
  })

  test("merges nest inward, so work consolidates layer by layer up to the root", () => {
    const graph = buildSessionGraph(input(chain))
    // Every delegating layer gets its own merge, and each feeds the next.
    for (const [from, to] of [
      ["join:session:build", "join:session:draft"],
      ["join:session:draft", "join:session:root"],
    ])
      expect(graph.edges.some((edge) => edge.from === from && edge.to === to)).toBe(true)
    // The deepest merge is fed by the leaf itself - it delegated to nobody.
    expect(graph.edges.some((edge) => edge.from === "session:validate" && edge.to === "join:session:build")).toBe(true)
    // Merge depth grows with the chain instead of collapsing onto one column.
    expect(node(graph, "join:session:build")?.depth).toBe(4)
    expect(node(graph, "join:session:draft")?.depth).toBe(5)
    expect(node(graph, "join:session:root")?.depth).toBe(6)
  })

  test("a layer still working holds every merge above it open", () => {
    const graph = buildSessionGraph(input(chain, { build: { type: "busy" } }))
    expect(node(graph, "session:build")?.status).toBe("running")
    // The unfinished build keeps its own merge queued, and that propagates up.
    expect(node(graph, "join:session:draft")?.statusLabel).toBe("Waiting on branches")
    expect(node(graph, "join:session:root")?.statusLabel).toBe("Waiting on branches")
  })

  test("once the last layer reports, the whole chain consolidates", () => {
    const graph = buildSessionGraph(input(chain))
    expect(node(graph, "join:session:root")).toMatchObject({ status: "completed", statusLabel: "Merged" })
    expect(graph.counts.total).toBe(4)
    expect(graph.counts.completed).toBe(3)
  })

  test("the canvas lays the chain out left to right, one column per layer", () => {
    const layout = layoutSessionGraph(buildSessionGraph(input(chain)))
    const columns = ["session:root", "session:draft", "session:build", "session:validate"].map(
      (id) => layout.nodes.find((item) => item.node.id === id)?.x ?? -1,
    )
    expect(columns).toEqual([...columns].toSorted((left, right) => left - right))
    expect(new Set(columns).size).toBe(4)
  })

  test("a fan-out inside a layer still fans in to that layer's merge", () => {
    // The designer hands to two engineers at once; both report to the designer.
    const wide = [
      ...chain,
      session({ id: "build-2", title: "Build the header", parentID: "draft", role: "Senior Engineer", created: 5 }),
    ]
    const graph = buildSessionGraph(input(wide))
    const merge = node(graph, "join:session:draft")
    expect(merge?.progress).toEqual({ completed: 2, failed: 0, total: 2 })
    expect(graph.edges.some((edge) => edge.from === "session:build-2" && edge.to === "join:session:draft")).toBe(true)
  })
})

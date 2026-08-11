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
    // Returned branches settle the chain, but nothing verified their outcomes,
    // so the consolidation says exactly that instead of claiming success.
    expect(node(graph, "join:session:root")).toMatchObject({
      status: "completed",
      statusLabel: "Merged - outcomes unverified",
    })
    expect(graph.counts.total).toBe(4)
    expect(graph.counts.returned).toBe(3)
    expect(graph.counts.completed).toBe(0)
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
      // Overlapping the first build: concurrent work, not a later stage.
      { ...session({ id: "build-2", title: "Build the header", parentID: "draft", role: "Senior Engineer", created: 3 }), time: { created: 3, updated: 8 } },
    ]
    const graph = buildSessionGraph(input(wide))
    const merge = node(graph, "join:session:draft")
    expect(merge?.progress).toEqual({ completed: 2, failed: 0, total: 2 })
    expect(graph.edges.some((edge) => edge.from === "session:build-2" && edge.to === "join:session:draft")).toBe(true)
  })
})

/**
 * The shape a real relay produced. Every one of these was delegated by the
 * orchestrator itself - `parentID` is the root for all of them - so parentage
 * alone draws a star with nine spokes. The pipeline is in the timings: three
 * designers overlapping, then a merge step after they stopped, then three
 * engineers, then a merge step.
 *
 * Timings are the ones measured from the session this was built against.
 */
const relay = [
  session({ id: "root", title: "Mock login page build relay workflow", created: 0 }),
  ...[
    { id: "d-solo", title: "Designer: Produce login page design", role: "Designer", created: 36_415, ran: 219_000 },
    { id: "d-a", title: "Designer A: Layout & structure", role: "Designer", created: 744_807, ran: 45_000 },
    { id: "d-b", title: "Designer B: Visual style", role: "Designer", created: 747_639, ran: 63_000 },
    { id: "d-c", title: "Designer C: Behavior & states", role: "Designer", created: 750_929, ran: 48_000 },
    { id: "d-merge", title: "Designer: Merge three design slices", role: "Designer", created: 840_575, ran: 113_000 },
    { id: "e-a", title: "Senior Engineer A: Layout plan", role: "Senior Engineer", created: 968_665, ran: 64_000 },
    { id: "e-b", title: "Senior Engineer B: Theme plan", role: "Senior Engineer", created: 977_820, ran: 85_000 },
    { id: "e-c", title: "Senior Engineer C: Behavior plan", role: "Senior Engineer", created: 987_101, ran: 88_000 },
    { id: "e-merge", title: "Senior Engineer: Merge three plans", role: "Senior Engineer", created: 1_091_205, ran: 82_000 },
  ].map((step) => ({
    ...session({ id: step.id, title: step.title, parentID: "root", role: step.role, created: step.created }),
    time: { created: step.created, updated: step.created + step.ran },
  })),
]

describe("a flat delegation tree with a pipeline inside it", () => {
  const graph = buildSessionGraph(input(relay))
  const columnOf = (id: string) => node(graph, `session:${id}`)?.depth

  test("concurrent steps share a column and sequential ones do not", () => {
    // The three designers were issued in one turn, so they overlap and stand
    // side by side. Every other step waited on what came before it.
    expect([columnOf("d-a"), columnOf("d-b"), columnOf("d-c")]).toEqual([
      columnOf("d-a"),
      columnOf("d-a"),
      columnOf("d-a"),
    ])
    expect([columnOf("e-a"), columnOf("e-b"), columnOf("e-c")]).toEqual([
      columnOf("e-a"),
      columnOf("e-a"),
      columnOf("e-a"),
    ])
    expect(columnOf("d-solo")!).toBeLessThan(columnOf("d-a")!)
    expect(columnOf("d-a")!).toBeLessThan(columnOf("d-merge")!)
    expect(columnOf("d-merge")!).toBeLessThan(columnOf("e-a")!)
    expect(columnOf("e-a")!).toBeLessThan(columnOf("e-merge")!)
  })

  test("each fan-out closes with a merge the next stage flows out of", () => {
    // Designers -> merge -> the step that consumed them.
    const designers = graph.edges.filter((edge) => edge.to.startsWith("join:session:root:"))
    expect(designers.map((edge) => edge.from).toSorted()).toContain("session:d-a")
    const afterDesigners = graph.edges.find((edge) => edge.to === "session:d-merge")!
    expect(afterDesigners.from.startsWith("join:")).toBe(true)
    const afterEngineers = graph.edges.find((edge) => edge.to === "session:e-merge")!
    expect(afterEngineers.from.startsWith("join:")).toBe(true)
  })

  test("a lone step flows straight on without a merge diamond of its own", () => {
    // d-solo is a stage by itself; the next stage hangs off the step, not off a
    // merge that would have exactly one branch.
    expect(graph.edges.some((edge) => edge.from === "session:d-solo" && edge.to === "session:d-a")).toBe(true)
    expect(node(graph, "join:session:root:0")).toBeUndefined()
  })

  test("the pipeline is deeper than the three columns parentage would give", () => {
    // Nine steps all parented to the root; a spawn tree would put every one of
    // them in column 1 and stop at column 2.
    expect(Math.max(...graph.nodes.map((item) => item.depth))).toBeGreaterThan(6)
    expect(graph.counts.total).toBe(10)
  })

  test("the work still consolidates once, into the session that ran it", () => {
    expect(node(graph, "join:session:root")).toMatchObject({
      status: "completed",
      statusLabel: "Merged - outcomes unverified",
    })
  })

  test("stage-derived edges admit to being inferred; real spawn edges do not", () => {
    // d-a hangs off d-solo only because it started after d-solo stopped - a
    // timestamp reading. The first stage hangs off the session that actually
    // spawned it.
    const inferred = graph.edges.find((edge) => edge.from === "session:d-solo" && edge.to === "session:d-a")
    expect(inferred?.provenance).toBe("inferred_sequence")
    expect(inferred?.detail).toContain("Inferred: started after the previous stage returned.")
    const observed = graph.edges.find((edge) => edge.from === "session:root" && edge.to === "session:d-solo")
    expect(observed?.provenance).toBe("observed_spawn")
    // Merge fan-in is presentation, and every edge declares where it came from.
    const back = graph.edges.find((edge) => edge.to === "join:session:root")
    expect(back?.provenance).toBe("synthetic_return")
    expect(graph.edges.every((edge) => edge.provenance)).toBe(true)
  })
})

import { describe, expect, test } from "bun:test"
import type { OpencodeXGoal, OpencodeXGoalNode, Session } from "@opencode-ai/sdk/v2/client"
import { buildSessionGraph, type SessionGraph } from "../src/renderer/src/lib/session-graph"

/**
 * A declared goal, drawn as the pipeline it became.
 *
 * Execution is the witness for shape, so a step that ran is placed by when it
 * ran, not by where the plan filed it. The plan is consulted for the two things
 * running cannot show: the steps that have not happened, and the approval a
 * gate is parked on - which is the only way a blocked goal ever moves again.
 */

function goalNode(id: string, overrides: Partial<OpencodeXGoalNode> = {}): OpencodeXGoalNode {
  return {
    id,
    goalID: "g1",
    kind: "task",
    title: `Step ${id}`,
    brief: `Do ${id}`,
    status: "planned",
    sortOrder: 0,
    iteration: 0,
    attempt: 0,
    timeCreated: 0,
    timeUpdated: 0,
    ...overrides,
  } as OpencodeXGoalNode
}

function goal(nodes: OpencodeXGoalNode[], edges: OpencodeXGoal["edges"] = []): OpencodeXGoal {
  const built: OpencodeXGoal = {
    id: "g1",
    projectID: "p1",
    title: "Ship it",
    statement: "Ship the migration.",
    successCriteria: [],
    status: "running",
    source: "manual",
    spend: { nodeRuns: 0, costUsd: 0 },
    nodes,
    edges,
    ownerSessionID: "root",
    timeCreated: 0,
    timeUpdated: 0,
  }
  return built
}

function session(input: { id: string; title: string; parentID?: string; created: number; ran?: number }): Session {
  return {
    id: input.id,
    slug: input.id,
    projectID: "prj",
    directory: "/work",
    title: input.title,
    version: "test",
    time: { created: input.created, updated: input.created + (input.ran ?? 1) },
    ...(input.parentID ? { parentID: input.parentID } : {}),
  } as Session
}

const build = (sessions: readonly Session[], owned?: OpencodeXGoal): SessionGraph =>
  buildSessionGraph({
    sessionID: "root",
    workItems: [],
    sessions,
    jobs: [],
    swarms: [],
    ...(owned ? { goal: owned } : {}),
  })

const node = (graph: SessionGraph, id: string) => graph.nodes.find((item) => item.id === id)

// Two steps that ran back to back, so the pipeline reads them as two stages.
const ran = [
  session({ id: "root", title: "Ship it", created: 0 }),
  session({ id: "s-draft", title: "Draft", parentID: "root", created: 10, ran: 40 }),
  session({ id: "s-build", title: "Build", parentID: "root", created: 60, ran: 40 }),
]

describe("a goal folded into the pipeline", () => {
  test("a step that ran keeps the column execution gave it, and gains who ran it", () => {
    const graph = build(
      ran,
      goal([
        goalNode("draft", { sessionID: "s-draft", status: "done", executor: { type: "swarm_role", role: "Designer" } }),
        goalNode("build", { sessionID: "s-build", status: "done", executor: { type: "swarm_role", role: "Engineer" } }),
      ]),
    )
    expect(node(graph, "session:s-draft")?.role).toBe("Designer")
    expect(node(graph, "session:s-build")?.role).toBe("Engineer")
    // Sequential in time, so sequential in columns - the plan did not move them.
    expect(node(graph, "session:s-draft")!.depth).toBeLessThan(node(graph, "session:s-build")!.depth)
    // No duplicates: a step that ran is drawn once, from its session.
    expect(graph.nodes.filter((item) => item.title === "Draft")).toHaveLength(1)
    expect(node(graph, "goal:draft")).toBeUndefined()
  })

  test("a step still to run is drawn, because nothing has run to infer it from", () => {
    const graph = build(ran, goal([
      goalNode("draft", { sessionID: "s-draft", status: "done" }),
      goalNode("review", { status: "planned", sortOrder: 1 }),
    ]))
    const planned = node(graph, "goal:review")
    expect(planned).toMatchObject({ status: "queued", statusLabel: "Not started", title: "Step review" })
    // After everything that has run, not beside it.
    expect(planned!.depth).toBeGreaterThan(node(graph, "session:s-build")!.depth)
  })

  test("a parked gate carries what it needs to be answered", () => {
    const graph = build(ran, goal([goalNode("sign-off", { kind: "gate", status: "awaiting_approval" })]))
    expect(node(graph, "goal:sign-off")).toMatchObject({
      status: "input_needed",
      gate: { goalID: "g1", nodeID: "sign-off" },
    })
    // It reads as needing a human in the counts, which is what raises the hand.
    expect(graph.counts.blocked).toBe(1)
  })

  test("a gate on a step that already ran moves that step, not a second copy of it", () => {
    const graph = build(ran, goal([goalNode("build", { sessionID: "s-build", status: "awaiting_approval" })]))
    expect(node(graph, "session:s-build")).toMatchObject({
      status: "input_needed",
      gate: { goalID: "g1", nodeID: "build" },
    })
    expect(node(graph, "goal:build")).toBeUndefined()
  })

  test("a goal that has not started yet still draws every step it declared", () => {
    // Otherwise a plan parked on its first gate would render an empty canvas,
    // and the only control that could unblock it would have nowhere to live.
    const only = [session({ id: "root", title: "Ship it", created: 0 })]
    const graph = build(only, goal(
      [
        goalNode("one", { sortOrder: 0 }),
        goalNode("two", { sortOrder: 1 }),
        goalNode("three", { sortOrder: 2 }),
      ],
      [{ fromNodeID: "one", toNodeID: "two" }, { fromNodeID: "two", toNodeID: "three" }],
    ))
    expect(graph.counts.total).toBe(4)
    // The declared order is the only order available, so it is used.
    expect(node(graph, "goal:one")!.depth).toBeLessThan(node(graph, "goal:two")!.depth)
    expect(node(graph, "goal:two")!.depth).toBeLessThan(node(graph, "goal:three")!.depth)
    expect(graph.edges.some((edge) => edge.from === "goal:one" && edge.to === "goal:two")).toBe(true)
  })

  test("a planned step hangs off the step it declared as its input", () => {
    const graph = build(ran, goal(
      [goalNode("build", { sessionID: "s-build", status: "done" }), goalNode("review", { sortOrder: 1 })],
      [{ fromNodeID: "build", toNodeID: "review" }],
    ))
    // Spelled with the session's id, not the plan's - they are different names
    // for the step and only one of them is on the canvas.
    expect(graph.edges.some((edge) => edge.from === "session:s-build" && edge.to === "goal:review")).toBe(true)
  })

  test("a plan that names itself as its own input still settles", () => {
    const graph = build(ran, goal(
      [goalNode("a", { sortOrder: 0 }), goalNode("b", { sortOrder: 1 })],
      [{ fromNodeID: "a", toNodeID: "b" }, { fromNodeID: "b", toNodeID: "a" }],
    ))
    expect(node(graph, "goal:a")).toBeDefined()
    expect(node(graph, "goal:b")).toBeDefined()
  })

  test("without a goal the pipeline is exactly what it was", () => {
    const plain = build(ran)
    const withEmpty = build(ran, goal([]))
    expect(withEmpty.nodes.map((item) => item.id)).toEqual(plain.nodes.map((item) => item.id))
    expect(withEmpty.counts).toEqual(plain.counts)
  })
})

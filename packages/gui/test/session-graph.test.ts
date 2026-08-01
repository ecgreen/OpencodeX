import { describe, expect, test } from "bun:test"
import type { OpencodeXJob, OpencodeXSwarm, Session } from "@opencode-ai/sdk/v2/client"
import { clientWorkItems } from "@opencode-ai/sdk/v2/work-item"
import {
  buildSessionGraph,
  graphRootSessionID,
  sessionGraphAvailable,
  sessionGraphSummary,
  type SessionGraphInput,
} from "../src/renderer/src/lib/session-graph"
import { summarizeGraphDetail } from "../src/renderer/src/lib/session-graph-nodes"

describe("session graph model", () => {
  test("builds the parent/child tree from session cards alone", () => {
    const graph = buildSessionGraph(
      input({
        sessions: [root(), child("child-1", "Research the API"), child("child-2", "Write the migration")],
      }),
    )
    expect(graph.rootSessionID).toBe("root")
    expect(steps(graph).map((node) => node.id)).toEqual(["session:root", "session:child-1", "session:child-2"])
    expect(steps(graph).map((node) => node.depth)).toEqual([0, 1, 1])
    expect(graph.edges.map((edge) => `${edge.from}->${edge.to}`)).toContain("session:root->session:child-1")
    expect(graph.edges.map((edge) => `${edge.from}->${edge.to}`)).toContain("session:root->session:child-2")
    expect(sessionGraphAvailable(graph)).toBe(true)
  })

  test("draws nested delegation at increasing depth", () => {
    const grandchild = { ...child("child-2", "Sub-task"), parentID: "child-1" }
    const graph = buildSessionGraph({
      ...input({ sessions: [root(), child("child-1", "Research"), grandchild] }),
    })
    expect(graph.nodes.find((node) => node.id === "session:child-2")?.depth).toBe(2)
  })

  test("opens the same graph from a child as from the top session", () => {
    const sessions = [root(), child("child-1", "Research")]
    expect(graphRootSessionID(sessions, "child-1")).toBe("root")
    const fromChild = buildSessionGraph(input({ sessionID: "child-1", sessions }))
    const fromRoot = buildSessionGraph(input({ sessionID: "root", sessions }))
    expect(fromChild.nodes.map((node) => node.id)).toEqual(fromRoot.nodes.map((node) => node.id))
  })

  test("survives a parent id that points at a session the client has not seen", () => {
    const orphan = { ...child("child-1", "Research"), parentID: "missing" }
    expect(graphRootSessionID([orphan], "child-1")).toBe("child-1")
    expect(buildSessionGraph(input({ sessionID: "child-1", sessions: [orphan] })).nodes).toHaveLength(1)
  })

  test("reports no graph for a lone session", () => {
    const graph = buildSessionGraph(input({ sessions: [root()] }))
    expect(graph.nodes).toHaveLength(1)
    expect(sessionGraphAvailable(graph)).toBe(false)
  })

  test("returns the empty graph when the session is not in the catalog yet", () => {
    expect(buildSessionGraph(input({ sessionID: "pending:1", sessions: [] })).nodes).toEqual([])
    expect(buildSessionGraph(input({ sessionID: "", sessions: [root()] })).nodes).toEqual([])
  })
})

describe("session graph status", () => {
  test("marks a finished delegation complete from its job, not its idle session", () => {
    const sessions = [root(), child("child-1", "Research")]
    const jobs = [job({ id: "job-1", sessionID: "child-1", status: "succeeded" })]
    const graph = buildSessionGraph(input({ sessions, jobs }))
    const node = graph.nodes.find((item) => item.id === "session:child-1")
    expect(node?.status).toBe("completed")
    expect(node?.badge).toBe("success")
    expect(graph.counts.completed).toBe(1)
  })

  test("marks a failed delegation with the failure badge and message", () => {
    const sessions = [root(), child("child-1", "Research")]
    const jobs = [
      job({ id: "job-1", sessionID: "child-1", status: "failed", failure: { message: "Tests did not pass" } }),
    ]
    const graph = buildSessionGraph(input({ sessions, jobs }))
    const node = graph.nodes.find((item) => item.id === "session:child-1")
    expect(node?.status).toBe("failed")
    expect(node?.badge).toBe("failure")
    expect(node?.detail).toBe("Tests did not pass")
    expect(graph.edges.find((edge) => edge.to === "session:child-1")?.status).toBe("failed")
  })

  test("lets a live session outrank a recorded job outcome", () => {
    const sessions = [root(), child("child-1", "Research")]
    const jobs = [job({ id: "job-1", sessionID: "child-1", status: "succeeded" })]
    const graph = buildSessionGraph({
      ...input({ sessions, jobs }),
      workItems: clientWorkItems({
        sessions: entities(sessions),
        sessionStatus: { "child-1": { type: "busy" } },
        sessionUiState: {},
        permissions: entities([]),
        questions: entities([]),
        jobs: entities(jobs),
        swarms: entities([]),
      }),
    })
    const node = graph.nodes.find((item) => item.id === "session:child-1")
    expect(node?.status).toBe("running")
    expect(node?.badge).toBeUndefined()
  })

  test("the top session with nothing running is idle and unbadged", () => {
    const graph = buildSessionGraph(input({ sessions: [root(), child("child-1", "Research")] }))
    const node = graph.nodes.find((item) => item.id === "session:root")
    expect(node?.status).toBe("idle")
    expect(node?.badge).toBeUndefined()
  })

  test("a delegated child that is no longer working reads as returned", () => {
    // Nothing tracks a swarm-delegated child but its own session status, which
    // is cleared the moment it stops. It exists only because a parent created
    // and prompted it, so "not running" means the delegation came back.
    const graph = buildSessionGraph(input({ sessions: [root(), child("child-1", "Research")] }))
    const node = graph.nodes.find((item) => item.id === "session:child-1")
    expect(node?.status).toBe("completed")
    expect(node?.badge).toBe("success")
  })

  test("summarizes the run for the canvas label", () => {
    const sessions = [root(), child("child-1", "A"), child("child-2", "B")]
    const jobs = [
      job({ id: "job-1", sessionID: "child-1", status: "succeeded" }),
      job({ id: "job-2", sessionID: "child-2", status: "failed" }),
    ]
    expect(sessionGraphSummary(buildSessionGraph(input({ sessions, jobs })))).toBe(
      "Workflow graph: 3 steps, 1 complete, 1 failed",
    )
  })
})

describe("session graph jobs", () => {
  test("gives a queued job with no session its own node under the swarm root", () => {
    const sessions = [swarmRoot()]
    const jobs = [job({ id: "job-1", status: "queued", swarmID: "swarm-1", title: "Review the diff" })]
    const graph = buildSessionGraph(input({ sessions, jobs, swarms: [swarm()] }))
    expect(steps(graph).map((node) => node.id)).toEqual(["session:root", "job:job-1"])
    expect(steps(graph)[1]).toMatchObject({ kind: "job", depth: 1, status: "queued", title: "Review the diff" })
  })

  test("folds a claimed job into the child session it runs, with no duplicate node", () => {
    const sessions = [swarmRoot(), child("child-1", "Review the diff")]
    const jobs = [job({ id: "job-1", sessionID: "child-1", status: "running", swarmID: "swarm-1" })]
    const graph = buildSessionGraph(input({ sessions, jobs, swarms: [swarm()] }))
    expect(steps(graph).map((node) => node.id)).toEqual(["session:root", "session:child-1"])
    expect(steps(graph)[1]?.status).toBe("running")
  })

  test("places a child job listed before its parent job", () => {
    const sessions = [swarmRoot()]
    const parent = job({ id: "job-1", status: "running", swarmID: "swarm-1" })
    const nested = job({ id: "job-2", status: "queued", parentJobID: "job-1" })
    const graph = buildSessionGraph(input({ sessions, jobs: [nested, parent], swarms: [swarm()] }))
    expect(steps(graph).map((node) => node.id)).toEqual(["session:root", "job:job-1", "job:job-2"])
    expect(graph.nodes.find((node) => node.id === "job:job-2")?.depth).toBe(2)
  })

  test("leaves out a job that belongs to another workflow", () => {
    const graph = buildSessionGraph(
      input({ sessions: [swarmRoot()], jobs: [job({ id: "job-1", swarmID: "other" })], swarms: [swarm()] }),
    )
    expect(graph.nodes.map((node) => node.id)).toEqual(["session:root"])
    expect(sessionGraphAvailable(graph)).toBe(false)
  })
})

describe("session graph with a fetched swarm delegation tree", () => {
  /**
   * The shape that motivated descendant fetching: the catalog hides children
   * tagged with a swarmID, so they arrive merged from the children endpoint.
   * One role has fanned its own work out to two subagents of itself.
   */
  const engineer: Session = {
    ...child("child-1", "Senior Engineer: build the graph (@general subagent)"),
    metadata: { opencodex: { swarmID: "swarm-1" } },
  }
  const designer: Session = {
    ...child("child-2", "Designer: brief (@general subagent)"),
    metadata: { opencodex: { swarmID: "swarm-1" } },
  }
  const fanOut: Session[] = [
    { ...child("child-1a", "Layout worker"), parentID: "child-1", time: { created: 5, updated: 6 } },
    { ...child("child-1b", "Status worker"), parentID: "child-1", time: { created: 6, updated: 7 } },
  ]
  const sessions = [swarmRoot(), engineer, designer, ...fanOut]

  test("draws the swarm children and the role's own subagents", () => {
    const graph = buildSessionGraph(input({ sessions }))
    expect(steps(graph).map((node) => `${node.depth}:${node.id}`)).toEqual([
      "0:session:root",
      "1:session:child-1",
      "1:session:child-2",
      "2:session:child-1a",
      "2:session:child-1b",
    ])
    expect(graph.edges.map((edge) => `${edge.from}->${edge.to}`)).toContain("session:child-1->session:child-1a")
    expect(sessionGraphAvailable(graph)).toBe(true)
  })

  test("cleans the subagent bookkeeping suffix from node titles", () => {
    const graph = buildSessionGraph(input({ sessions }))
    expect(graph.nodes.find((node) => node.id === "session:child-1")?.title).toBe(
      "Senior Engineer: build the graph",
    )
  })

  test("a live busy status marks a fetched child running, even over a finished job", () => {
    const jobs = [job({ id: "job-1", sessionID: "child-1", status: "succeeded" })]
    const graph = buildSessionGraph({
      ...input({ sessions, jobs }),
      sessionStatus: { "child-1": { type: "busy" }, "child-1a": { type: "retry" } },
    })
    expect(graph.nodes.find((node) => node.id === "session:child-1")?.status).toBe("running")
    expect(graph.nodes.find((node) => node.id === "session:child-1a")?.status).toBe("running")
    // No live status of its own, so this branch has already reported back.
    expect(graph.nodes.find((node) => node.id === "session:child-1b")?.status).toBe("completed")
    expect(graph.counts.running).toBe(2)
  })
})

describe("session graph consolidation", () => {
  const sessions = [root(), child("child-1", "Research"), child("child-2", "Migrate")]

  test("every delegating node gains a merge node its branches report into", () => {
    const graph = buildSessionGraph(input({ sessions }))
    const join = graph.nodes.find((node) => node.id === "join:session:root")
    expect(join).toMatchObject({ kind: "join", depth: 2, sessionID: "root", title: "Merge results" })
    expect(graph.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(
      expect.arrayContaining(["session:child-1->join:session:root", "session:child-2->join:session:root"]),
    )
    const detail = graph.edges.find((edge) => edge.from === "session:child-1" && edge.to === "join:session:root")
    expect(detail?.detail).toBe("Research reports back into Ship the migration.")
  })

  test("waits on branches, merges while the parent is busy, completes when it is not", () => {
    const jobs = [
      job({ id: "job-1", sessionID: "child-1", status: "succeeded" }),
      job({ id: "job-2", sessionID: "child-2", status: "running" }),
    ]
    const waiting = buildSessionGraph(input({ sessions, jobs }))
    expect(waiting.nodes.find((node) => node.kind === "join")).toMatchObject({
      status: "queued",
      statusLabel: "Waiting on branches",
      progress: { completed: 1, failed: 0, total: 2 },
      badge: undefined,
    })

    const done = [
      job({ id: "job-1", sessionID: "child-1", status: "succeeded" }),
      job({ id: "job-2", sessionID: "child-2", status: "failed" }),
    ]
    const merging = buildSessionGraph({
      ...input({ sessions, jobs: done }),
      sessionStatus: { root: { type: "busy" } },
    })
    expect(merging.nodes.find((node) => node.kind === "join")).toMatchObject({
      status: "running",
      statusLabel: "Merging",
    })

    const merged = buildSessionGraph(input({ sessions, jobs: done }))
    expect(merged.nodes.find((node) => node.kind === "join")).toMatchObject({
      status: "completed",
      statusLabel: "Merged",
      badge: "success",
      progress: { completed: 1, failed: 1, total: 2 },
    })
  })

  test("nested delegation chains merge nodes: a branch's merge feeds its parent's", () => {
    const grandchildren = [
      { ...child("child-1a", "Worker A"), parentID: "child-1", time: { created: 5, updated: 6 } },
      { ...child("child-1b", "Worker B"), parentID: "child-1", time: { created: 6, updated: 7 } },
    ]
    const graph = buildSessionGraph(input({ sessions: [...sessions, ...grandchildren] }))
    const inner = graph.nodes.find((node) => node.id === "join:session:child-1")
    const outer = graph.nodes.find((node) => node.id === "join:session:root")
    expect(inner?.depth).toBe(3)
    expect(outer?.depth).toBe(4)
    // The root's merge collects the branch's own merge, not the branch node.
    expect(graph.edges.some((edge) => edge.from === "join:session:child-1" && edge.to === "join:session:root")).toBe(
      true,
    )
    expect(graph.edges.some((edge) => edge.from === "session:child-1" && edge.to === "join:session:root")).toBe(false)
  })

  test("merge nodes never count as workflow steps", () => {
    const graph = buildSessionGraph(input({ sessions }))
    expect(graph.counts.total).toBe(3)
    expect(sessionGraphSummary(graph)).toBe("Workflow graph: 3 steps, 2 complete")
  })

  test("branches that have returned settle the merge node", () => {
    // The whole point of the fan-in: once every branch is back, the merge reads
    // "Merged" rather than sitting on "Waiting on branches" for the session's
    // lifetime, which is what an `idle` child used to cause.
    const graph = buildSessionGraph(input({ sessions }))
    expect(graph.nodes.find((node) => node.id === "join:session:root")).toMatchObject({
      status: "completed",
      statusLabel: "Merged",
      progress: { completed: 2, failed: 0, total: 2 },
    })
  })

  test("a branch still working holds its merge node open", () => {
    const graph = buildSessionGraph({ ...input({ sessions }), sessionStatus: { "child-2": { type: "busy" } } })
    expect(graph.nodes.find((node) => node.id === "join:session:root")).toMatchObject({
      status: "queued",
      statusLabel: "Waiting on branches",
    })
  })
})

describe("session graph edge labels", () => {
  test("prefers the swarm role and its instructions", () => {
    const tagged: Session = {
      ...child("child-1", "Research the API (swarm role)"),
      metadata: { opencodex: { swarmID: "swarm-1", swarmRole: "Researcher" } },
    }
    const graph = buildSessionGraph(input({ sessions: [swarmRoot(), tagged], swarms: [swarm()] }))
    const edge = graph.edges[0]
    expect(edge?.label).toBe("Researcher")
    expect(edge?.detail).toBe("Find the API contract and report back.")
  })

  test("falls back to the child title before the role metadata hydrates", () => {
    const graph = buildSessionGraph(
      input({ sessions: [swarmRoot(), child("child-1", "Research the API (swarm role)")], swarms: [swarm()] }),
    )
    expect(graph.edges[0]?.label).toBe("Research the API")
    expect(graph.nodes[1]?.title).toBe("Research the API")
    // The label already says it; a detail here would pad the tooltip with a
    // duplicate, so the canvas is given nothing to render.
    expect(graph.edges[0]?.detail).toBe("")
  })

  test("keeps the child title as detail when the role name differs from it", () => {
    const tagged: Session = {
      ...child("child-1", "Research the API"),
      metadata: { opencodex: { swarmRole: "Scout" } },
    }
    const graph = buildSessionGraph(input({ sessions: [swarmRoot(), tagged] }))
    expect(graph.edges[0]?.label).toBe("Scout")
    expect(graph.edges[0]?.detail).toBe("Research the API")
  })

  test("describes a job edge by its source and attempt count", () => {
    const jobs = [
      job({ id: "job-1", status: "queued", swarmID: "swarm-1", title: "Review", attempt: 2, maxAttempts: 3 }),
    ]
    const graph = buildSessionGraph(input({ sessions: [swarmRoot()], jobs, swarms: [swarm()] }))
    expect(graph.edges[0]?.detail).toBe("swarm job: Review (attempt 2 of 3)")
  })
})

/** The real workflow steps: everything except the presentation-only merge nodes. */
function steps(graph: ReturnType<typeof buildSessionGraph>) {
  return graph.nodes.filter((node) => node.kind !== "join")
}

function input(overrides: Partial<SessionGraphInput> = {}): SessionGraphInput {
  return {
    sessionID: "root",
    workItems: [],
    sessions: [],
    jobs: [],
    swarms: [],
    ...overrides,
  }
}

function root(): Session {
  return {
    id: "root",
    slug: "root",
    projectID: "project-1",
    directory: "C:/Work/OpencodeX",
    title: "Ship the migration",
    version: "test",
    time: { created: 1, updated: 5 },
  }
}

function swarmRoot(): Session {
  return { ...root(), model: { providerID: "swarm", id: "swarm-1" } }
}

function child(id: string, title: string): Session {
  return {
    id,
    slug: id,
    projectID: "project-1",
    parentID: "root",
    directory: "C:/Work/OpencodeX",
    title,
    version: "test",
    time: { created: id === "child-1" ? 2 : 3, updated: 4 },
  }
}

function job(overrides: Partial<OpencodeXJob> & { id: string }): OpencodeXJob {
  return {
    kind: "swarm.role",
    status: "queued",
    source: "swarm",
    attempt: 1,
    maxAttempts: 1,
    timeCreated: 1,
    timeUpdated: 2,
    ...overrides,
  } as OpencodeXJob
}

function swarm(): OpencodeXSwarm {
  return {
    id: "swarm-1",
    projectID: "project-1",
    title: "Migration swarm",
    prompt: "Ship the migration",
    status: "running",
    source: "swarm",
    roles: [
      {
        id: "role-1",
        swarmID: "swarm-1",
        name: "Researcher",
        status: "running",
        instructions: "Find the API contract and report back.",
        sortOrder: 0,
        timeCreated: 1,
        timeUpdated: 1,
      },
    ],
    runs: [],
    events: [],
    timeCreated: 1,
    timeUpdated: 1,
  } as OpencodeXSwarm
}

function entities<T extends { id: string }>(items: readonly T[]) {
  return { ids: items.map((item) => item.id), records: Object.fromEntries(items.map((item) => [item.id, item])) }
}

describe("graph detail summaries", () => {
  test("keeps a short detail exactly as written", () => {
    expect(summarizeGraphDetail("Find the API contract and report back.")).toBe(
      "Find the API contract and report back.",
    )
  })

  test("keeps the opening sentence of a long brief", () => {
    const brief = `Review the flows end to end. ${"Then check every state, including the error ones. ".repeat(6)}`
    expect(summarizeGraphDetail(brief)).toBe("Review the flows end to end.")
  })

  test("clips at a word boundary when there is no early sentence stop", () => {
    const summary = summarizeGraphDetail("word ".repeat(80))!
    expect(summary.length).toBeLessThanOrEqual(143)
    expect(summary.endsWith("...")).toBe(true)
    expect(summary).not.toContain("wor...")
  })

  test("collapses the whitespace a pasted brief carries", () => {
    expect(summarizeGraphDetail("  Build   the\n\n  page  ")).toBe("Build the page")
  })

  test("nothing to say stays nothing", () => {
    expect(summarizeGraphDetail("   ")).toBeUndefined()
    expect(summarizeGraphDetail(undefined)).toBeUndefined()
  })

  test("a role's whole instruction sheet never reaches an edge tooltip", () => {
    const instructions = `Own the visual language of the product. ${"Audit every screen for spacing, colour, and type. ".repeat(20)}`
    const graph = buildSessionGraph(
      input({
        sessions: [swarmRoot(), { ...child("child-1", "Design pass"), metadata: { opencodex: { swarmID: "swarm-1", swarmRole: "Researcher" } } }],
        swarms: [{ ...swarm(), roles: [{ ...swarm().roles[0]!, instructions }] }],
      }),
    )
    expect(graph.edges[0]!.detail).toBe("Own the visual language of the product.")
  })
})

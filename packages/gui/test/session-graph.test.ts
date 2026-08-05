import { describe, expect, test } from "bun:test"
import type { OpencodeXJob, OpencodeXSwarm, Session } from "@opencode-ai/sdk/v2/client"
import { clientWorkItems } from "@opencode-ai/sdk/v2/work-item"
import {
  buildSessionGraph,
  graphRootSessionID,
  sessionGraphAvailable,
  sessionGraphSummary,
  type SessionGraphInput,
  type SessionGraphNode,
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

  test("a delegated child that is no longer working reads as returned, never as a success", () => {
    // Nothing tracks a swarm-delegated child but its own session status, which
    // is cleared the moment it stops. It exists only because a parent created
    // and prompted it, so "not running" means the delegation came back - but
    // nothing recorded *how*, so it must not wear a success badge: a subagent
    // that errored on its way out looks exactly like this.
    const graph = buildSessionGraph(input({ sessions: [root(), child("child-1", "Research")] }))
    const node = graph.nodes.find((item) => item.id === "session:child-1")
    expect(node?.status).toBe("returned")
    expect(node?.statusLabel).toBe("Returned")
    expect(node?.badge).toBeUndefined()
    expect(node?.detail).toBe("Outcome not recorded - open the step to verify")
  })

  test("a recorded delegation outcome settles the card - the common case, not returned", () => {
    // The parent stamps the child's metadata when the delegation ends (see
    // packages/opencode session/delegation-outcome.ts). This is what keeps a
    // real workflow from reading as a wall of "Returned". These are the
    // pre-versioning stamps, which stay readable forever.
    const stamped = (outcome: string) => ({
      ...child("child-1", "Research"),
      metadata: { opencodex: { swarmID: "swarm-1", delegation: { outcome, completedAt: 9 } } },
    })
    // A clean return is execution settlement, not verified success: the card
    // completes, but no verifier ran, so it must never wear the green check.
    const succeeded = buildSessionGraph(input({ sessions: [root(), stamped("succeeded")] }))
    const completedNode = succeeded.nodes.find((node) => node.id === "session:child-1")
    expect(completedNode).toMatchObject({
      status: "completed",
      statusLabel: "Completed",
      outcome: "completed_unverified",
    })
    expect(completedNode?.badge).toBeUndefined()
    const failed = buildSessionGraph(input({ sessions: [root(), stamped("failed")] }))
    expect(failed.nodes.find((node) => node.id === "session:child-1")).toMatchObject({
      status: "failed",
      outcome: "failed",
      badge: "failure",
    })
    const cancelled = buildSessionGraph(input({ sessions: [root(), stamped("cancelled")] }))
    expect(cancelled.nodes.find((node) => node.id === "session:child-1")).toMatchObject({
      status: "cancelled",
      outcome: "cancelled",
      badge: "cancelled",
    })
    // A malformed stamp is no stamp: the honest fallback stays.
    const junk = buildSessionGraph(input({ sessions: [root(), stamped("maybe")] }))
    expect(junk.nodes.find((node) => node.id === "session:child-1")?.status).toBe("returned")
  })

  test("a versioned run record settles the card only for its own graph edge", () => {
    const record = (overrides: Record<string, unknown> = {}) => ({
      version: 2,
      runID: "run_1",
      parentSessionID: "root",
      attempt: 1,
      phase: "settled",
      outcome: "completed",
      startedAt: 5,
      completedAt: 9,
      ...overrides,
    })
    const stamped = (delegation: Record<string, unknown>) => ({
      ...child("child-1", "Research"),
      metadata: { opencodex: { delegation } },
    })
    const settled = buildSessionGraph(input({ sessions: [root(), stamped(record())] }))
    expect(settled.nodes.find((node) => node.id === "session:child-1")).toMatchObject({
      status: "completed",
      outcome: "completed_unverified",
    })
    // The identity gate: a record stamped under some other parent - a reused
    // or copied session - must not decorate this edge.
    const foreign = buildSessionGraph(
      input({ sessions: [root(), stamped(record({ parentSessionID: "someone-else" }))] }),
    )
    expect(foreign.nodes.find((node) => node.id === "session:child-1")?.status).toBe("returned")
    // Unknown future versions degrade to unknown, never to success.
    const future = buildSessionGraph(input({ sessions: [root(), stamped(record({ version: 3 }))] }))
    expect(future.nodes.find((node) => node.id === "session:child-1")?.status).toBe("returned")
    // A record still `running` with no live evidence is an abandoned run, not
    // an outcome.
    const abandoned = buildSessionGraph(
      input({ sessions: [root(), stamped(record({ phase: "running", outcome: undefined }))] }),
    )
    expect(abandoned.nodes.find((node) => node.id === "session:child-1")?.status).toBe("returned")
  })

  test("a completed run whose report has not reached the parent says so", () => {
    const stamped = (deliveryOutcome?: string) => ({
      ...child("child-1", "Research"),
      metadata: {
        opencodex: {
          delegation: {
            version: 2,
            runID: "run_1",
            parentSessionID: "root",
            attempt: 1,
            phase: "settled",
            outcome: "completed",
            startedAt: 5,
            completedAt: 9,
            ...(deliveryOutcome ? { deliveryOutcome } : {}),
          },
        },
      },
    })
    const pending = buildSessionGraph(input({ sessions: [root(), stamped("pending")] }))
    expect(pending.nodes.find((node) => node.id === "session:child-1")?.statusLabel).toBe(
      "Completed - result pending",
    )
    const failed = buildSessionGraph(input({ sessions: [root(), stamped("failed")] }))
    expect(failed.nodes.find((node) => node.id === "session:child-1")?.statusLabel).toBe(
      "Completed - delivery failed",
    )
    const delivered = buildSessionGraph(input({ sessions: [root(), stamped("delivered")] }))
    expect(delivered.nodes.find((node) => node.id === "session:child-1")?.statusLabel).toBe("Completed")
  })

  test("a root session never wears a delegation record - forks clone metadata", () => {
    const forked = {
      ...root(),
      metadata: { opencodex: { delegation: { outcome: "succeeded", completedAt: 9 } } },
    }
    const graph = buildSessionGraph(input({ sessions: [forked, child("child-1", "Research")] }))
    expect(graph.nodes.find((node) => node.id === "session:root")).toMatchObject({ status: "idle" })
  })

  test("the stamped report opening becomes the node's summary", () => {
    const stamped = {
      ...child("child-1", "Research"),
      metadata: {
        opencodex: { delegation: { outcome: "succeeded", completedAt: 9, summary: "Found the API contract." } },
      },
    }
    const graph = buildSessionGraph(input({ sessions: [root(), stamped] }))
    expect(graph.nodes.find((node) => node.id === "session:child-1")?.summary).toBe(
      "Found the API contract.",
    )
  })

  test("a live step summarizes as its objective until a report exists", () => {
    const graph = buildSessionGraph({
      ...input({ sessions: [root(), child("child-1", "Research")] }),
      workItems: [
        {
          ...workItem("child-1", "running"),
          objective: "Map the current schema and flag breaking changes.",
        },
      ],
    })
    expect(graph.nodes.find((node) => node.id === "session:child-1")?.summary).toBe(
      "Map the current schema and flag breaking changes.",
    )
  })

  test("a live busy child outranks its previous run's recorded outcome", () => {
    const stamped = {
      ...child("child-1", "Research"),
      metadata: { opencodex: { delegation: { outcome: "succeeded", completedAt: 9 } } },
    }
    const graph = buildSessionGraph({
      ...input({ sessions: [root(), stamped] }),
      sessionStatus: { "child-1": { type: "busy" } },
    })
    expect(graph.nodes.find((node) => node.id === "session:child-1")?.status).toBe("running")
  })

  test("recorded outcomes settle a merge with a truthful badge", () => {
    const stamped = (id: string, outcome: string) => ({
      ...child(id, id),
      metadata: { opencodex: { delegation: { outcome, completedAt: 9 } } },
    })
    const graph = buildSessionGraph(
      input({ sessions: [root(), stamped("child-1", "succeeded"), stamped("child-2", "failed")] }),
    )
    expect(graph.nodes.find((node) => node.kind === "join")).toMatchObject({
      statusLabel: "Merged with 1 failed",
      badge: "warning",
    })
  })

  test("a just-created delegation reads queued, not returned", () => {
    // The first busy event rides the next push; silence in that window is not
    // an outcome.
    const fresh = { ...child("child-1", "Research"), time: { created: Date.now(), updated: Date.now() } }
    const graph = buildSessionGraph(input({ sessions: [root(), fresh] }))
    expect(graph.nodes.find((item) => item.id === "session:child-1")?.status).toBe("queued")
  })

  test("summarizes the run for the canvas label", () => {
    const sessions = [root(), child("child-1", "A"), child("child-2", "B")]
    const jobs = [
      job({ id: "job-1", sessionID: "child-1", status: "succeeded" }),
      job({ id: "job-2", sessionID: "child-2", status: "failed" }),
    ]
    expect(sessionGraphSummary(buildSessionGraph(input({ sessions, jobs })))).toBe(
      "Workflow graph: 2 delegated steps, 1 complete, 1 failed",
    )
  })

  test("the summary can admit the graph may be incomplete", () => {
    const graph = buildSessionGraph(input({ sessions: [root(), child("child-1", "A")] }))
    expect(sessionGraphSummary(graph, { incomplete: true })).toBe(
      "Workflow graph: 1 delegated step, 1 returned - graph may be incomplete",
    )
  })

  test("cancelled work counts as cancelled, not as failed", () => {
    const sessions = [root(), child("child-1", "A")]
    const jobs = [job({ id: "job-1", sessionID: "child-1", status: "cancelled" })]
    const graph = buildSessionGraph(input({ sessions, jobs }))
    expect(graph.counts.cancelled).toBe(1)
    expect(graph.counts.failed).toBe(0)
    expect(sessionGraphSummary(graph)).toBe("Workflow graph: 1 delegated step, 1 cancelled")
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
    { ...child("child-1a", "Layout worker"), parentID: "child-1", time: { created: 5, updated: 9 } },
    { ...child("child-1b", "Status worker"), parentID: "child-1", time: { created: 6, updated: 9 } },
  ]
  const sessions = [swarmRoot(), engineer, designer, ...fanOut]

  test("draws the swarm children and the role's own subagents", () => {
    const graph = buildSessionGraph(input({ sessions }))
    // Sorted: placement walks each branch to its end before starting the next,
    // so emission order is depth-first. Only the column each step lands in is
    // meaningful, and the layout reads that from `depth`.
    expect(steps(graph).map((node) => `${node.depth}:${node.id}`).toSorted()).toEqual([
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
    // No live status of its own, so this branch has already reported back -
    // with no record of how it went.
    expect(graph.nodes.find((node) => node.id === "session:child-1b")?.status).toBe("returned")
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
    })
    expect(waiting.nodes.find((node) => node.kind === "join")?.badge).toBeUndefined()

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

    // A merge that carried a failed branch is a qualified outcome: it says so,
    // and it never wears the unqualified green check.
    const merged = buildSessionGraph(input({ sessions, jobs: done }))
    expect(merged.nodes.find((node) => node.kind === "join")).toMatchObject({
      status: "completed",
      statusLabel: "Merged with 1 failed",
      badge: "warning",
      progress: { completed: 1, failed: 1, total: 2 },
    })
  })

  test("a merge whose branches all failed is a failed merge", () => {
    const jobs = [
      job({ id: "job-1", sessionID: "child-1", status: "failed" }),
      job({ id: "job-2", sessionID: "child-2", status: "failed" }),
    ]
    const graph = buildSessionGraph(input({ sessions, jobs }))
    expect(graph.nodes.find((node) => node.kind === "join")).toMatchObject({
      status: "failed",
      statusLabel: "Branches failed",
      badge: "failure",
    })
  })

  test("a merge of verified successes earns the unqualified check", () => {
    const jobs = [
      job({ id: "job-1", sessionID: "child-1", status: "succeeded" }),
      job({ id: "job-2", sessionID: "child-2", status: "succeeded" }),
    ]
    const graph = buildSessionGraph(input({ sessions, jobs }))
    expect(graph.nodes.find((node) => node.kind === "join")).toMatchObject({
      status: "completed",
      statusLabel: "Merged",
      badge: "success",
    })
  })

  test("nested delegation chains merge nodes: a branch's merge feeds its parent's", () => {
    const grandchildren = [
      { ...child("child-1a", "Worker A"), parentID: "child-1", time: { created: 5, updated: 9 } },
      { ...child("child-1b", "Worker B"), parentID: "child-1", time: { created: 6, updated: 9 } },
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
    expect(sessionGraphSummary(graph)).toBe("Workflow graph: 2 delegated steps, 2 returned")
  })

  test("branches that have returned settle the merge node, without claiming success", () => {
    // The whole point of the fan-in: once every branch is back, the merge stops
    // waiting rather than sitting on "Waiting on branches" for the session's
    // lifetime, which is what an `idle` child used to cause. But "back" is all
    // the data says, so the merge admits the outcomes are unverified.
    const graph = buildSessionGraph(input({ sessions }))
    expect(graph.nodes.find((node) => node.id === "join:session:root")).toMatchObject({
      status: "completed",
      statusLabel: "Merged - outcomes unverified",
      progress: { completed: 2, failed: 0, total: 2 },
    })
    expect(graph.nodes.find((node) => node.id === "join:session:root")?.badge).toBeUndefined()
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

describe("session graph unexpanded-branch markers", () => {
  test("each unexpanded branch carries its own marker with its reason", () => {
    const graph = buildSessionGraph({
      ...input({ sessions: [root(), child("child-1", "Research"), child("child-2", "Migrate")] }),
      unexpanded: [
        { sessionID: "child-1", reason: "depth_limit" },
        { sessionID: "child-2", reason: "load_error" },
      ],
    })
    const markers = graph.nodes.filter((node) => node.kind === "sentinel")
    expect(markers.map((node) => node.id).toSorted()).toEqual(["sentinel:child-1", "sentinel:child-2"])
    expect(markers.every((node) => node.title === "Descendants not checked")).toBe(true)
    expect(graph.nodes.find((node) => node.id === "sentinel:child-1")?.role).toBe("depth limit reached")
    expect(graph.nodes.find((node) => node.id === "sentinel:child-2")?.role).toBe("failed to load")
    // The marker hangs off the branch it belongs to, not an arbitrary node.
    expect(graph.edges.some((edge) => edge.from === "session:child-1" && edge.to === "sentinel:child-1")).toBe(true)
    // The wording never claims the tree continues - unknown means unknown.
    expect(graph.nodes.find((node) => node.id === "sentinel:child-1")?.detail).not.toContain("continues")
    // Not steps: counts and availability ignore them.
    expect(graph.counts.total).toBe(3)
    expect(sessionGraphSummary(graph, { incomplete: true })).toContain("graph may be incomplete")
  })

  test("markers are capped so a wide truncation cannot bury the graph", () => {
    const children = Array.from({ length: 8 }, (_, index) => child(`child-${index}`, `Step ${index}`))
    const graph = buildSessionGraph({
      ...input({ sessions: [root(), ...children] }),
      unexpanded: children.map((item) => ({ sessionID: item.id, reason: "session_limit" as const })),
    })
    expect(graph.nodes.filter((node) => node.kind === "sentinel").length).toBe(4)
  })

  test("a fully swept graph has no markers", () => {
    const graph = buildSessionGraph(input({ sessions: [root(), child("child-1", "Research")] }))
    expect(graph.nodes.some((node) => node.kind === "sentinel")).toBe(false)
  })
})

describe("session graph supervision states", () => {
  // The states a supervisor acts on must stay distinguishable: retrying is not
  // merely running, needs-review is not completed, partial is not success.
  const cases: Array<{
    state: string
    status: SessionGraphNode["status"]
    label: string
    badge: SessionGraphNode["badge"]
  }> = [
    { state: "retrying", status: "running", label: "Retrying", badge: undefined },
    { state: "needs_review", status: "needs_review", label: "Ready for review", badge: undefined },
    { state: "partially_completed", status: "completed", label: "Partially completed", badge: "warning" },
    { state: "recovered", status: "completed", label: "Recovered", badge: "success" },
    { state: "completed", status: "completed", label: "Completed", badge: "success" },
    { state: "failed", status: "failed", label: "Failed", badge: "failure" },
    // Cancellation is a deliberate stop, not a failure: neutral badge.
    { state: "cancelled", status: "cancelled", label: "Cancelled", badge: "cancelled" },
    { state: "queued", status: "queued", label: "Queued", badge: undefined },
  ]

  const outcomes: Array<{ state: string; outcome: SessionGraphNode["outcome"] }> = [
    { state: "completed", outcome: "verified_success" },
    { state: "needs_review", outcome: "review_required" },
    { state: "partially_completed", outcome: "partial" },
    { state: "recovered", outcome: "verified_success" },
    { state: "failed", outcome: "failed" },
    { state: "cancelled", outcome: "cancelled" },
    { state: "running", outcome: undefined },
  ]

  for (const expected of outcomes) {
    test(`work-item state ${expected.state} yields outcome ${expected.outcome ?? "none"}`, () => {
      const graph = buildSessionGraph({
        ...input({ sessions: [root(), child("child-1", "Research")] }),
        workItems: [workItem("child-1", expected.state)],
      })
      expect(graph.nodes.find((item) => item.id === "session:child-1")?.outcome).toBe(expected.outcome)
    })
  }

  for (const expected of cases) {
    test(`work-item state ${expected.state} presents as "${expected.label}"`, () => {
      const graph = buildSessionGraph({
        ...input({ sessions: [root(), child("child-1", "Research")] }),
        workItems: [workItem("child-1", expected.state)],
      })
      const node = graph.nodes.find((item) => item.id === "session:child-1")
      expect(node?.status).toBe(expected.status)
      expect(node?.statusLabel).toBe(expected.label)
      expect(node?.badge).toBe(expected.badge)
    })
  }

  test("a retrying step nests inside running instead of double-counting", () => {
    const graph = buildSessionGraph({
      ...input({ sessions: [root(), child("child-1", "Research")] }),
      workItems: [workItem("child-1", "retrying")],
    })
    expect(graph.counts.running).toBe(1)
    expect(graph.counts.retrying).toBe(1)
    expect(sessionGraphSummary(graph)).toBe("Workflow graph: 1 delegated step, 1 running (1 retrying)")
  })

  test("review-required outranks unknown when both feed a merge", () => {
    const graph = buildSessionGraph({
      ...input({ sessions: [root(), child("child-1", "A"), child("child-2", "B")] }),
      workItems: [workItem("child-1", "needs_review")],
    })
    const join = graph.nodes.find((node) => node.kind === "join")
    expect(join?.status).toBe("needs_review")
    expect(join?.statusLabel).toBe("Merged - review required")
    expect(join?.badge).toBeUndefined()
  })
})

describe("merge outcome aggregation", () => {
  const pair = () => [root(), child("child-1", "A"), child("child-2", "B")]
  const join = (graph: ReturnType<typeof buildSessionGraph>) =>
    graph.nodes.find((node) => node.kind === "join")

  test("all branches awaiting review keep the merge in the attention pool", () => {
    // The V2 review's laundering case: all-review used to render an
    // unqualified green "Merged".
    const graph = buildSessionGraph({
      ...input({ sessions: pair() }),
      workItems: [workItem("child-1", "needs_review"), workItem("child-2", "needs_review")],
    })
    expect(join(graph)).toMatchObject({
      status: "needs_review",
      statusLabel: "Merged - review required",
      outcome: "review_required",
    })
    expect(join(graph)?.badge).toBeUndefined()
  })

  test("a partial branch is reported as partial, never as failed", () => {
    const graph = buildSessionGraph({
      ...input({ sessions: pair() }),
      workItems: [workItem("child-1", "partially_completed"), workItem("child-2", "completed")],
    })
    expect(join(graph)).toMatchObject({
      status: "completed",
      statusLabel: "Merged with 1 partial",
      outcome: "partial",
      badge: "warning",
    })
  })

  test("all-partial reads as partial too", () => {
    const graph = buildSessionGraph({
      ...input({ sessions: pair() }),
      workItems: [workItem("child-1", "partially_completed"), workItem("child-2", "partially_completed")],
    })
    expect(join(graph)?.statusLabel).toBe("Merged with 2 partial")
  })

  test("failure still outranks partial", () => {
    const graph = buildSessionGraph({
      ...input({ sessions: pair() }),
      workItems: [workItem("child-1", "partially_completed"), workItem("child-2", "failed")],
    })
    expect(join(graph)).toMatchObject({ statusLabel: "Merged with 1 failed", outcome: "failed" })
  })

  test("an all-cancelled fan-in is cancelled, not failed", () => {
    const graph = buildSessionGraph({
      ...input({ sessions: pair() }),
      workItems: [workItem("child-1", "cancelled"), workItem("child-2", "cancelled")],
    })
    expect(join(graph)).toMatchObject({
      status: "cancelled",
      statusLabel: "Branches cancelled",
      outcome: "cancelled",
      badge: "cancelled",
    })
  })

  test("a cancelled branch beside successes is named, without a scare badge", () => {
    const graph = buildSessionGraph({
      ...input({ sessions: pair() }),
      workItems: [workItem("child-1", "cancelled"), workItem("child-2", "completed")],
    })
    expect(join(graph)).toMatchObject({ statusLabel: "Merged - 1 cancelled", outcome: "cancelled" })
    expect(join(graph)?.badge).toBeUndefined()
  })

  test("a nested merge's quality survives the hop to its parent's merge", () => {
    // child-1 delegates to two grandchildren, one needing review; child-1's
    // inner merge becomes review-required, and the root's outer merge must
    // not turn that into a green check.
    const grandchildren = [
      { ...child("gc-a", "Worker A"), parentID: "child-1", time: { created: 5, updated: 9 } },
      { ...child("gc-b", "Worker B"), parentID: "child-1", time: { created: 6, updated: 9 } },
    ]
    const graph = buildSessionGraph({
      ...input({ sessions: [...pair(), ...grandchildren] }),
      workItems: [
        workItem("gc-a", "needs_review"),
        workItem("gc-b", "completed"),
        workItem("child-2", "completed"),
      ],
    })
    const inner = graph.nodes.find((node) => node.id === "join:session:child-1")
    const outer = graph.nodes.find((node) => node.id === "join:session:root")
    expect(inner?.outcome).toBe("review_required")
    expect(outer?.outcome).toBe("review_required")
    expect(outer?.badge).toBeUndefined()
  })
})

/** The projection the snapshot would build, reduced to what the graph reads. */
function workItem(sessionID: string, state: string) {
  return {
    id: `session:${sessionID}`,
    kind: "session",
    sourceID: sessionID,
    sessionID,
    title: sessionID,
    state,
    statusLabel: state,
    executionTarget: "local",
    changedFiles: [],
    validation: { status: "unknown" },
    updatedAt: 1,
  } as unknown as import("@opencode-ai/sdk/v2/work-item").WorkItem
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
        swarms: [{ ...swarm(), roles: [{ ...swarm().roles[0], instructions }] }],
      }),
    )
    expect(graph.edges[0].detail).toBe("Own the visual language of the product.")
  })
})

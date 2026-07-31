import { describe, expect, test } from "bun:test"
import type { OpencodeXGoal, OpencodeXGoalNode } from "@opencode-ai/sdk/v2/client"
import {
  attentionGoals,
  goalGates,
  goalHeadline,
  goalNodeRows,
  goalNodeTone,
  goalProgress,
  sessionGoal,
} from "../src/renderer/src/lib/goal-graph-view"

function node(id: string, overrides: Partial<OpencodeXGoalNode> = {}): OpencodeXGoalNode {
  return {
    id,
    goalID: "g1",
    kind: "task",
    title: `Node ${id}`,
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

function goal(nodes: OpencodeXGoalNode[], overrides: Partial<OpencodeXGoal> = {}): OpencodeXGoal {
  return {
    id: "g1",
    projectID: "p1",
    title: "Ship it",
    statement: "Ship the migration.",
    successCriteria: [],
    status: "running",
    source: "manual",
    spend: { nodeRuns: 0, costUsd: 0 },
    nodes,
    edges: [],
    timeCreated: 0,
    timeUpdated: 0,
    ...overrides,
  } as OpencodeXGoal
}

describe("node rows", () => {
  test("a loop's body follows it, indented, so the cluster reads as one thing", () => {
    const rows = goalNodeRows(
      goal([
        node("report", { sortOrder: 3, kind: "synthesis" }),
        node("tests", { sortOrder: 2, kind: "check", parentNodeID: "fix" }),
        node("patch", { sortOrder: 1, parentNodeID: "fix" }),
        node("fix", {
          sortOrder: 0,
          kind: "loop",
          loop: { exitCheckNodeID: "tests", maxIterations: 3, iteration: 2, bodyNodeIDs: ["patch", "tests"] },
        }),
      ]),
    )

    expect(rows.map((row) => [row.node.id, row.depth])).toEqual([
      ["fix", 0],
      ["patch", 1],
      ["tests", 1],
      ["report", 0],
    ])
  })

  test("a row says who runs it, which iteration, and what it waits for", () => {
    const rows = goalNodeRows(
      goal(
        [
          node("survey", { sortOrder: 0, title: "Survey the schema" }),
          node("api", { sortOrder: 1, executor: { type: "swarm_role", role: "Backend" } }),
        ],
        { edges: [{ goalID: "g1", fromNodeID: "survey", toNodeID: "api", kind: "feeds" }] },
      ),
    )
    expect(rows[1]!.detail).toBe("Backend · after Survey the schema")
  })

  test("a loop row shows the iteration it is on, counting from one", () => {
    const rows = goalNodeRows(
      goal([
        node("fix", {
          kind: "loop",
          loop: { exitCheckNodeID: "c", maxIterations: 5, iteration: 0, bodyNodeIDs: [] },
        }),
      ]),
    )
    expect(rows[0]!.detail).toBe("iteration 1 of 5")
  })

  test("a gate says what it is waiting for", () => {
    const rows = goalNodeRows(goal([node("approve", { kind: "gate", status: "awaiting_approval" })]))
    expect(rows[0]!.detail).toBe("needs your approval")
    expect(rows[0]!.tone).toBe("attention")
  })

  test("every node status maps to a tone", () => {
    const statuses = ["planned", "ready", "dispatched", "running", "done", "failed", "skipped", "cancelled", "awaiting_approval"]
    for (const status of statuses) expect(goalNodeTone(status)).toBeTruthy()
    expect(goalNodeTone("done")).toBe("done")
    expect(goalNodeTone("failed")).toBe("failed")
  })
})

describe("progress", () => {
  test("counts settled work, including failures", () => {
    const progress = goalProgress(
      goal([
        node("a", { status: "done" }),
        node("b", { status: "failed" }),
        node("c", { status: "running" }),
        node("d", { status: "planned" }),
      ]),
    )
    expect(progress).toEqual({ total: 4, settled: 2, running: 1, failed: 1, percent: 50 })
  })

  test("an empty graph is not a division by zero", () => {
    expect(goalProgress(goal([])).percent).toBe(0)
  })
})

describe("headline", () => {
  test("says what is happening, in the reader's terms", () => {
    expect(goalHeadline(goal([node("a", { status: "running" }), node("b")]))).toBe("1 running, 0 of 2 done.")
    expect(goalHeadline(goal([node("a", { status: "done" })], { status: "completed" }))).toBe(
      "Every step finished. 1 step ran.",
    )
    expect(goalHeadline(goal([node("a")], { status: "blocked" }))).toBe("Waiting for you to approve a step.")
    expect(goalHeadline(goal([node("a")], { status: "planned" }))).toBe("Planned: 1 step, not started yet.")
  })

  test("a completion with skipped steps does not claim every step finished", () => {
    // A rejected gate settles its cone without running it.
    const headline = goalHeadline(
      goal([node("a", { status: "done" }), node("b", { status: "skipped" }), node("c", { status: "skipped" })], {
        status: "completed",
      }),
    )
    expect(headline).toBe("1 step ran, 2 skipped.")
  })

  test("a failure names the step and its reason", () => {
    const headline = goalHeadline(
      goal([node("a", { status: "failed", title: "Run tests", failureReason: "2 tests fail" })], { status: "failed" }),
    )
    expect(headline).toBe("Run tests failed: 2 tests fail")
  })

  test("an explicit status reason wins, because the server knows more", () => {
    expect(goalHeadline(goal([node("a")], { status: "paused", statusReason: "Node run budget spent (8/8)." }))).toBe(
      "Node run budget spent (8/8).",
    )
  })
})

describe("selection", () => {
  const live = goal([node("a")], { id: "live", status: "running", timeUpdated: 10, ownerSessionID: "ses_1" })
  const old = goal([node("a")], { id: "old", status: "completed", timeUpdated: 50, ownerSessionID: "ses_1" })
  const other = goal([node("a")], { id: "other", ownerSessionID: "ses_2" })

  test("a session shows its live goal even when a finished one is newer", () => {
    expect(sessionGoal({ id: "ses_1" } as never, [old, live, other])?.id).toBe("live")
  })

  test("with nothing live, the most recent finished goal still shows", () => {
    expect(sessionGoal({ id: "ses_1" } as never, [old, other])?.id).toBe("old")
  })

  test("a session with no goal gets nothing", () => {
    expect(sessionGoal({ id: "ses_9" } as never, [old, live])).toBeUndefined()
    expect(sessionGoal(undefined, [old, live])).toBeUndefined()
  })
})

describe("attention", () => {
  test("only goals that need a human, and only in this project", () => {
    const goals = [
      goal([], { id: "blocked", status: "blocked" }),
      goal([], { id: "paused", status: "paused" }),
      goal([], { id: "failed", status: "failed" }),
      goal([], { id: "running", status: "running" }),
      goal([], { id: "completed", status: "completed" }),
      goal([], { id: "elsewhere", status: "blocked", projectID: "p2" }),
    ]
    expect(attentionGoals(goals, "p1").map((item) => item.id)).toEqual(["blocked", "paused", "failed"])
  })

  test("gates are the nodes actually waiting", () => {
    const gates = goalGates(
      goal([node("a", { status: "awaiting_approval" }), node("b", { status: "planned" })]),
    )
    expect(gates.map((item) => item.id)).toEqual(["a"])
  })
})

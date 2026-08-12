import { describe, expect, test } from "bun:test"
import { planReconcile, type ReconcileGoal, type ReconcileNode } from "../../src/opencodex/goal-reconcile"
import type { EdgeView } from "../../src/opencodex/goal-graph"
import type { NodeStatus, Status } from "../../src/opencodex/goal-schema"

function node(id: string, status: NodeStatus, overrides: Partial<ReconcileNode> = {}): ReconcileNode {
  return { id, kind: "task", status, title: `Node ${id}`, ...overrides }
}

function link(from: string, to: string, kind: EdgeView["kind"] = "requires"): EdgeView {
  return { fromNodeID: from, toNodeID: to, kind }
}

function goal(nodes: ReconcileNode[], overrides: Partial<ReconcileGoal> = {}): ReconcileGoal {
  return {
    status: "running",
    spend: { nodeRuns: 0, costUsd: 0 },
    nodes,
    edges: [],
    ...overrides,
  }
}

const NOW = 1_000_000

describe("dispatch", () => {
  test("enqueues every independent node in one pass", () => {
    const plan = planReconcile({
      goal: goal([node("a", "planned"), node("b", "planned"), node("c", "planned")], {
        edges: [link("a", "c"), link("b", "c")],
      }),
      now: NOW,
    })
    expect(plan.dispatch.toSorted()).toEqual(["a", "b"])
    expect(plan.goal).toBeUndefined()
  })

  test("a finished dependency frees its dependents in the same pass", () => {
    // The fixpoint matters: without it a chain would need one reconcile tick
    // per level, and a ten-node chain would crawl.
    const plan = planReconcile({
      goal: goal([node("a", "done"), node("b", "planned"), node("c", "planned")], {
        edges: [link("a", "b"), link("b", "c")],
      }),
      now: NOW,
    })
    // "c" still waits: "b" is only dispatched, not done.
    expect(plan.dispatch).toEqual(["b"])
  })

  test("a gate parks for a human instead of dispatching", () => {
    const plan = planReconcile({ goal: goal([node("g", "planned", { kind: "gate" })]), now: NOW })
    expect(plan.gates).toEqual(["g"])
    expect(plan.dispatch).toEqual([])
    expect(plan.goal).toEqual({ status: "blocked" })
  })

  test("a failure settles its downstream cone and fails the goal", () => {
    const plan = planReconcile({
      goal: goal([node("a", "failed"), node("b", "planned"), node("c", "planned")], {
        edges: [link("a", "b"), link("b", "c")],
      }),
      now: NOW,
    })
    expect(plan.skip.toSorted()).toEqual(["b", "c"])
    expect(plan.dispatch).toEqual([])
    expect(plan.goal).toEqual({ status: "failed" })
  })

  test("a failure never skips work already in flight", () => {
    // "b" is running when "a" fails: it keeps running and its own job records
    // how it ended. Only "c", which never started, is settled by the cascade.
    const plan = planReconcile({
      goal: goal([node("a", "failed"), node("b", "running"), node("c", "planned")], {
        edges: [link("a", "b"), link("a", "c")],
      }),
      now: NOW,
    })
    expect(plan.skip).toEqual(["c"])
    // The goal stays running until the in-flight node lands.
    expect(plan.goal).toBeUndefined()
  })

  test("a goal completes when every node is settled", () => {
    const plan = planReconcile({ goal: goal([node("a", "done"), node("b", "skipped")]), now: NOW })
    expect(plan.goal).toEqual({ status: "completed" })
  })

  test("a terminal goal is left alone", () => {
    for (const status of ["completed", "failed", "cancelled"] as Status[]) {
      const plan = planReconcile({ goal: goal([node("a", "planned")], { status }), now: NOW })
      expect(plan).toEqual({ fail: [], skip: [], loops: [], gates: [], dispatch: [] })
    }
  })

  test("a status that already matches is not rewritten", () => {
    const plan = planReconcile({
      goal: goal([node("a", "running"), node("b", "planned")], { status: "running", edges: [link("a", "b")] }),
      now: NOW,
    })
    expect(plan.goal).toBeUndefined()
  })
})

describe("loops", () => {
  const loopGoal = (
    loopStatus: NodeStatus,
    body: ReconcileNode[],
    loop = { exitCheckNodeID: "tests", maxIterations: 3, iteration: 1 },
  ) =>
    goal([node("fix", loopStatus, { kind: "loop", loop }), ...body])

  test("a ready loop starts iterating and its body dispatches immediately", () => {
    const plan = planReconcile({
      goal: loopGoal(
        "planned",
        [
          node("patch", "planned", { parentNodeID: "fix" }),
          node("tests", "planned", { kind: "check", parentNodeID: "fix" }),
        ],
        { exitCheckNodeID: "tests", maxIterations: 3, iteration: 0 },
      ),
      now: NOW,
    })
    // The body is stamped with the iteration it belongs to, so each pass gets
    // its own job instead of colliding with the previous one's.
    expect(plan.loops).toEqual([
      { type: "start", nodeID: "fix", iteration: 1, resetNodeIDs: ["patch", "tests"] },
    ])
    expect(plan.dispatch).toEqual(["patch"])
  })

  test("the exit check dispatches once the body lands", () => {
    const plan = planReconcile({
      goal: loopGoal("running", [
        node("patch", "done", { parentNodeID: "fix" }),
        node("tests", "planned", { kind: "check", parentNodeID: "fix" }),
      ]),
      now: NOW,
    })
    expect(plan.dispatch).toEqual(["tests"])
    expect(plan.loops).toEqual([])
  })

  test("a failing check resets the body and re-dispatches it with the findings", () => {
    const plan = planReconcile({
      goal: loopGoal("running", [
        node("patch", "done", { parentNodeID: "fix" }),
        node("tests", "done", {
          kind: "check",
          parentNodeID: "fix",
          verdict: { pass: false, summary: "1 test fails.", findings: ["auth.test.ts:44"] },
        }),
      ]),
      now: NOW,
    })
    expect(plan.loops).toEqual([
      {
        type: "advance",
        nodeID: "fix",
        iteration: 2,
        report: "1 test fails.\n- auth.test.ts:44",
        resetNodeIDs: ["patch", "tests"],
      },
    ])
    // The reset body is ready again in the same pass, so iteration 2 starts now.
    expect(plan.dispatch).toEqual(["patch"])
  })

  test("a passing check finishes the loop and frees what waited on it", () => {
    const plan = planReconcile({
      goal: {
        ...loopGoal("running", [
          node("patch", "done", { parentNodeID: "fix" }),
          node("tests", "done", { kind: "check", parentNodeID: "fix", verdict: { pass: true, summary: "Green." } }),
          node("report", "planned"),
        ]),
        edges: [link("fix", "report", "feeds")],
      },
      now: NOW,
    })
    expect(plan.loops).toEqual([{ type: "finish", nodeID: "fix", status: "done", report: "Green." }])
    expect(plan.dispatch).toEqual(["report"])
  })

  test("an exhausted loop fails the goal instead of exiting unverified", () => {
    const plan = planReconcile({
      goal: {
        ...loopGoal(
          "running",
          [
            node("patch", "done", { parentNodeID: "fix" }),
            node("tests", "done", {
              kind: "check",
              parentNodeID: "fix",
              verdict: { pass: false, summary: "Still failing." },
            }),
            node("report", "planned"),
          ],
          { exitCheckNodeID: "tests", maxIterations: 2, iteration: 2 },
        ),
        edges: [link("fix", "report")],
      },
      now: NOW,
    })
    expect(plan.loops).toEqual([{ type: "finish", nodeID: "fix", status: "failed", report: "Still failing." }])
    expect(plan.skip).toEqual(["report"])
    expect(plan.goal).toEqual({ status: "failed" })
  })

  test("a body failure retries the iteration rather than killing the goal", () => {
    const plan = planReconcile({
      goal: loopGoal("running", [
        node("patch", "failed", { parentNodeID: "fix", failureReason: "patch conflict", title: "Apply patch" }),
        node("tests", "planned", { kind: "check", parentNodeID: "fix" }),
      ]),
      now: NOW,
    })
    expect(plan.loops[0]).toMatchObject({ type: "advance", iteration: 2 })
    expect(plan.dispatch).toEqual(["patch"])
    expect(plan.goal).toBeUndefined()
  })
})

describe("check verdicts", () => {
  test("a failing check outside a loop fails the node and its downstream cone", () => {
    // The check's job succeeded, so its status is "done" - but its word is the
    // whole point: dependents must not run and the goal must not read as met.
    const plan = planReconcile({
      goal: goal(
        [
          node("build", "done"),
          node("verify", "done", {
            kind: "check",
            verdict: { pass: false, summary: "Two criteria unmet.", findings: ["no tests", "lint errors"] },
          }),
          node("deploy", "planned"),
        ],
        { edges: [link("build", "verify"), link("verify", "deploy")] },
      ),
      now: NOW,
    })
    expect(plan.fail).toEqual([{ nodeID: "verify", reason: "Two criteria unmet.\n- no tests\n- lint errors" }])
    expect(plan.skip).toEqual(["deploy"])
    expect(plan.dispatch).toEqual([])
    expect(plan.goal).toEqual({ status: "failed" })
  })

  test("a passing check is left alone", () => {
    const plan = planReconcile({
      goal: goal([node("verify", "done", { kind: "check", verdict: { pass: true, summary: "Green." } })]),
      now: NOW,
    })
    expect(plan.fail).toEqual([])
    expect(plan.goal).toEqual({ status: "completed" })
  })

  test("a loop's exit check keeps its failing verdict - the loop consumes it", () => {
    const plan = planReconcile({
      goal: goal([
        node("fix", "running", { kind: "loop", loop: { exitCheckNodeID: "tests", maxIterations: 3, iteration: 1 } }),
        node("patch", "done", { parentNodeID: "fix" }),
        node("tests", "done", {
          kind: "check",
          parentNodeID: "fix",
          verdict: { pass: false, summary: "Still red." },
        }),
      ]),
      now: NOW,
    })
    expect(plan.fail).toEqual([])
    expect(plan.loops[0]).toMatchObject({ type: "advance", iteration: 2 })
  })

  test("a failing non-exit check inside a loop body spends an iteration", () => {
    const plan = planReconcile({
      goal: goal([
        node("fix", "running", { kind: "loop", loop: { exitCheckNodeID: "tests", maxIterations: 3, iteration: 1 } }),
        node("sanity", "done", {
          kind: "check",
          parentNodeID: "fix",
          title: "Sanity check",
          verdict: { pass: false, summary: "Setup is broken." },
        }),
        node("patch", "planned", { parentNodeID: "fix" }),
        node("tests", "planned", { kind: "check", parentNodeID: "fix" }),
      ]),
      now: NOW,
    })
    expect(plan.fail).toEqual([{ nodeID: "sanity", reason: "Setup is broken." }])
    expect(plan.loops[0]).toMatchObject({ type: "advance", iteration: 2 })
    expect(plan.goal).toBeUndefined()
  })
})

describe("budget", () => {
  const pending = [node("a", "planned"), node("b", "planned")]

  test("a spent budget stops new dispatch and pauses the goal", () => {
    const plan = planReconcile({
      goal: goal(pending, { budget: { maxNodeRuns: 2 }, spend: { nodeRuns: 2, costUsd: 0 } }),
      now: NOW,
    })
    expect(plan.dispatch).toEqual([])
    expect(plan.goal?.status).toBe("paused")
    expect(plan.goal?.reason).toContain("Node run budget")
  })

  test("work already in flight is allowed to finish", () => {
    const plan = planReconcile({
      goal: goal([node("a", "running"), node("b", "planned")], {
        budget: { maxCostUsd: 5 },
        spend: { nodeRuns: 1, costUsd: 7 },
      }),
      now: NOW,
    })
    expect(plan.dispatch).toEqual([])
    expect(plan.goal?.status).toBe("paused")
  })

  test("a paused goal is not re-paused every tick", () => {
    const plan = planReconcile({
      goal: goal(pending, { status: "paused", budget: { maxNodeRuns: 1 }, spend: { nodeRuns: 4, costUsd: 0 } }),
      now: NOW,
    })
    expect(plan.goal).toBeUndefined()
  })

  test("completion still wins over a spent budget", () => {
    const plan = planReconcile({
      goal: goal([node("a", "done")], { budget: { maxNodeRuns: 1 }, spend: { nodeRuns: 9, costUsd: 0 } }),
      now: NOW,
    })
    expect(plan.goal).toEqual({ status: "completed" })
  })
})

describe("stalls", () => {
  test("a settled loop takes its leftover body nodes with it", () => {
    const plan = planReconcile({
      goal: goal([
        node("fix", "done", { kind: "loop", loop: { exitCheckNodeID: "tests", maxIterations: 1, iteration: 1 } }),
        node("orphan", "planned", { parentNodeID: "fix" }),
      ]),
      now: NOW,
    })
    expect(plan.skip).toEqual(["orphan"])
    expect(plan.dispatch).toEqual([])
    expect(plan.goal).toEqual({ status: "completed" })
  })

  test("a loop whose exit check went missing fails instead of iterating forever", () => {
    const plan = planReconcile({
      goal: goal([
        node("fix", "running", { kind: "loop", loop: { exitCheckNodeID: "missing", maxIterations: 1, iteration: 1 } }),
      ]),
      now: NOW,
    })
    expect(plan.loops).toEqual([{ type: "finish", nodeID: "fix", status: "failed", report: "Loop has no exit check." }])
  })

  test("a gate blocks without being called a stall", () => {
    const plan = planReconcile({
      goal: goal([node("g", "awaiting_approval", { kind: "gate" }), node("after", "planned")], {
        status: "blocked",
        edges: [link("g", "after")],
      }),
      now: NOW,
    })
    expect(plan.goal).toBeUndefined()
    expect(plan.dispatch).toEqual([])
  })
})

describe("determinism", () => {
  test("planning twice from the same state yields the same plan", () => {
    const state = goal(
      [
        node("survey", "done", { result: "notes" }),
        node("api", "planned"),
        node("ui", "planned"),
        node("merge", "planned", { kind: "synthesis" }),
      ],
      { edges: [link("survey", "api"), link("survey", "ui"), link("api", "merge", "feeds"), link("ui", "merge")] },
    )
    expect(planReconcile({ goal: state, now: NOW })).toEqual(planReconcile({ goal: state, now: NOW + 5_000 }))
  })
})

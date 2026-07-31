import { afterEach, describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Layer } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXGoal } from "@/opencodex/goal"
import { GoalDispatch } from "@/opencodex/goal-dispatch"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXProject } from "@/opencodex/project"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

/**
 * The graph against a real database and a real job queue. Node execution is
 * left out on purpose - settling a job by hand is exactly what the executor
 * does, and it lets the whole walk be driven deterministically.
 */

const dependencies = Layer.mergeAll(
  AppFileSystem.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Database.defaultLayer,
  EventV2Bridge.defaultLayer,
  Project.defaultLayer,
  Session.defaultLayer,
  testInstanceStoreLayer,
)

const it = testEffect(
  OpencodeXGoal.layer.pipe(
    Layer.provideMerge(OpencodeXProject.defaultLayer),
    Layer.provideMerge(OpencodeXJob.defaultLayer),
    Layer.provideMerge(dependencies),
  ),
)

afterEach(resetDatabase)

const project = Effect.gen(function* () {
  const directory = yield* tmpdirScoped({ git: true })
  const projects = yield* OpencodeXProject.Service
  return yield* projects.create({ name: "graph", folders: [directory] })
})

const executor = { type: "agent" as const, agent: "build" }

function node(id: string, overrides: Record<string, unknown> = {}) {
  return { id, title: `Node ${id}`, brief: `Do ${id}`, executor, ...overrides }
}

/** Runs a node's job the way the real executor would, then lets the graph move. */
const settle = Effect.fnUntraced(function* (input: {
  goalID: string
  nodeID: string
  result?: string
  verdict?: { pass: boolean; summary: string; findings?: string[] }
  fail?: string
}) {
  const goals = yield* OpencodeXGoal.Service
  const jobs = yield* OpencodeXJob.Service
  const goal = yield* goals.get(input.goalID)
  const node = goal.nodes.find((item) => item.id === input.nodeID)
  if (!node?.jobID) throw new Error(`Node ${input.nodeID} has no job to settle`)
  const owner = `test:${node.jobID}`
  yield* jobs.claim({ jobID: node.jobID, owner, leaseMs: 30_000 })
  yield* jobs.start(node.jobID, owner)
  // The executor writes its report before the job settles, so the graph can
  // read a result even when the job later fails.
  yield* goals.report(input.goalID, {
    nodeID: input.nodeID,
    result: input.result ?? `${input.nodeID} done`,
    verdict: input.verdict ? { findings: [], ...input.verdict } : undefined,
  })
  const dispatch = yield* GoalDispatch
  if (input.fail) {
    yield* jobs.settle(
      { jobID: node.jobID, owner, outcome: { status: "failed", failure: { code: "TEST", message: input.fail } } },
      dispatch.settleNode,
    )
    return
  }
  yield* jobs.settle(
    { jobID: node.jobID, owner, outcome: { status: "succeeded", result: { costUsd: 0.25 } } },
    dispatch.settleNode,
  )
})

function statuses(goal: OpencodeXGoal.Info) {
  return Object.fromEntries(goal.nodes.map((item) => [item.id, item.status]))
}

describe("goal store", () => {
  it.live("round-trips a plan, including loop membership and executors", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const goal = yield* goals.create({
        projectID: created.id,
        statement: "Ship the migration.",
        successCriteria: ["Tests pass"],
        budget: { maxNodeRuns: 12 },
      })
      expect(goal.status).toBe("draft")
      expect(goal.title).toBe("Ship the migration.")
      expect(goal.spend).toEqual({ nodeRuns: 0, costUsd: 0 })

      const planned = yield* goals.plan(goal.id, {
        nodes: [
          node("survey", { executor: { type: "swarm_role", role: "Backend" } }),
          node("fix", { kind: "loop", executor: undefined, loop: { exitCheckNodeID: "tests", maxIterations: 4 } }),
          node("patch", { parentNodeID: "fix" }),
          node("tests", { kind: "check", parentNodeID: "fix" }),
        ],
        edges: [{ from: "survey", to: "fix", kind: "feeds" }],
      })

      expect(planned.status).toBe("planned")
      expect(planned.nodes).toHaveLength(4)
      const loop = planned.nodes.find((item) => item.id === "fix")!
      expect(loop.loop).toEqual({
        exitCheckNodeID: "tests",
        maxIterations: 4,
        iteration: 0,
        bodyNodeIDs: ["patch", "tests"],
      })
      expect(planned.nodes.find((item) => item.id === "survey")!.executor).toEqual({
        type: "swarm_role",
        role: "Backend",
      })
      expect(planned.edges).toEqual([
        { goalID: goal.id, fromNodeID: "survey", toNodeID: "fix", kind: "feeds" },
      ])

      // Reading it back fresh proves it is the database talking, not a cache.
      expect(yield* goals.get(goal.id)).toEqual(planned)
    }),
  )

  it.live("rejects an unrunnable plan with every issue at once", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const goal = yield* goals.create({ projectID: created.id, statement: "x" })
      const rejected = yield* goals
        .plan(goal.id, { nodes: [node("a"), node("a"), node("b", { executor: undefined })] })
        .pipe(Effect.flip)

      if (rejected._tag !== "OpencodeX.Goal.ValidationError") throw new Error(`unexpected ${rejected._tag}`)
      expect(rejected.issues).toEqual(
        expect.arrayContaining([expect.stringContaining("Duplicate node id"), 'Node "b" needs an executor.']),
      )
      // A rejected plan leaves the goal untouched.
      expect((yield* goals.get(goal.id)).nodes).toEqual([])
    }),
  )

  it.live("will not replan a goal that is already running", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const goal = yield* goals.create({ projectID: created.id, statement: "x" })
      yield* goals.plan(goal.id, { nodes: [node("a")] })
      yield* goals.start(goal.id)

      const rejected = yield* goals.plan(goal.id, { nodes: [node("b")] }).pipe(Effect.flip)
      expect(rejected.message).toContain("graph_update")
    }),
  )
})

describe("goal dispatch", () => {
  it.live("walks a diamond: parallel roots, then the join, then completion", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const jobs = yield* OpencodeXJob.Service
      const goal = yield* goals.create({ projectID: created.id, statement: "Ship it." })
      yield* goals.plan(goal.id, {
        nodes: [node("survey"), node("api"), node("ui"), node("merge", { kind: "synthesis" })],
        edges: [
          { from: "survey", to: "api" },
          { from: "survey", to: "ui" },
          { from: "api", to: "merge", kind: "feeds" },
          { from: "ui", to: "merge", kind: "feeds" },
        ],
      })

      const started = yield* goals.start(goal.id)
      expect(started.status).toBe("running")
      expect(statuses(started)).toEqual({
        survey: "dispatched",
        api: "planned",
        ui: "planned",
        merge: "planned",
      })
      const dispatched = (yield* jobs.list()).filter((job) => job.kind === "goal.node")
      expect(dispatched).toHaveLength(1)
      expect(dispatched[0]!.idempotencyKey).toBe(`${goal.id}:survey:0`)

      yield* settle({ goalID: goal.id, nodeID: "survey", result: "17 tables" })
      // One settled root frees both branches at once - parallelism is the
      // graph's shape, not something the planner has to ask for.
      expect(statuses(yield* goals.get(goal.id))).toEqual({
        survey: "done",
        api: "dispatched",
        ui: "dispatched",
        merge: "planned",
      })

      yield* settle({ goalID: goal.id, nodeID: "api" })
      expect(statuses(yield* goals.get(goal.id)).merge).toBe("planned")
      yield* settle({ goalID: goal.id, nodeID: "ui" })

      const joined = yield* goals.get(goal.id)
      expect(joined.nodes.find((item) => item.id === "merge")!.status).toBe("dispatched")

      yield* settle({ goalID: goal.id, nodeID: "merge", result: "All done." })
      const finished = yield* goals.get(goal.id)
      expect(finished.status).toBe("completed")
      expect(finished.completedAt).toBeGreaterThan(0)
      // Every settled node is charged for, so budgets are honest.
      expect(finished.spend).toEqual({ nodeRuns: 4, costUsd: 1 })
    }),
  )

  it.live("a failed node skips its dependents and fails the goal", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const goal = yield* goals.create({ projectID: created.id, statement: "Ship it." })
      yield* goals.plan(goal.id, {
        nodes: [node("a"), node("b"), node("c")],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
        ],
      })
      yield* goals.start(goal.id)
      yield* settle({ goalID: goal.id, nodeID: "a", fail: "compiler exploded" })

      const failed = yield* goals.get(goal.id)
      expect(statuses(failed)).toEqual({ a: "failed", b: "skipped", c: "skipped" })
      expect(failed.status).toBe("failed")
      expect(failed.nodes.find((item) => item.id === "a")!.failureReason).toBe("compiler exploded")
    }),
  )

  it.live("a gate parks the goal until a human answers", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const goal = yield* goals.create({ projectID: created.id, statement: "Deploy." })
      yield* goals.plan(goal.id, {
        nodes: [node("approve", { kind: "gate", executor: undefined }), node("deploy")],
        edges: [{ from: "approve", to: "deploy" }],
      })
      const started = yield* goals.start(goal.id)
      expect(started.status).toBe("blocked")
      expect(statuses(started)).toEqual({ approve: "awaiting_approval", deploy: "planned" })

      const approved = yield* goals.approve(goal.id, "approve", true)
      expect(statuses(approved)).toEqual({ approve: "done", deploy: "dispatched" })

      yield* settle({ goalID: goal.id, nodeID: "deploy" })
      expect((yield* goals.get(goal.id)).status).toBe("completed")
    }),
  )

  it.live("a rejected gate skips the work behind it", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const goal = yield* goals.create({ projectID: created.id, statement: "Deploy." })
      yield* goals.plan(goal.id, {
        nodes: [node("approve", { kind: "gate", executor: undefined }), node("deploy")],
        edges: [{ from: "approve", to: "deploy" }],
      })
      yield* goals.start(goal.id)

      const rejected = yield* goals.approve(goal.id, "approve", false)
      expect(statuses(rejected)).toEqual({ approve: "skipped", deploy: "skipped" })
      expect(rejected.status).toBe("completed")
    }),
  )

  it.live("a spent budget pauses the goal instead of dispatching more work", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const goal = yield* goals.create({
        projectID: created.id,
        statement: "Ship it.",
        budget: { maxNodeRuns: 1 },
      })
      yield* goals.plan(goal.id, { nodes: [node("a"), node("b")], edges: [{ from: "a", to: "b" }] })
      yield* goals.start(goal.id)
      yield* settle({ goalID: goal.id, nodeID: "a" })

      const paused = yield* goals.get(goal.id)
      expect(paused.status).toBe("paused")
      expect(paused.statusReason).toContain("Node run budget")
      expect(statuses(paused)).toEqual({ a: "done", b: "planned" })

      // Raising the budget and restarting picks the graph back up.
      yield* goals.updatePlan(goal.id, { budget: { maxNodeRuns: 10 } })
      const resumed = yield* goals.start(goal.id)
      expect(statuses(resumed).b).toBe("dispatched")
    }),
  )

  it.live("cancelling stops the outstanding jobs and settles every node", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const jobs = yield* OpencodeXJob.Service
      const goal = yield* goals.create({ projectID: created.id, statement: "Ship it." })
      yield* goals.plan(goal.id, { nodes: [node("a"), node("b")], edges: [{ from: "a", to: "b" }] })
      const started = yield* goals.start(goal.id)
      const jobID = started.nodes.find((item) => item.id === "a")!.jobID!

      const cancelled = yield* goals.cancel(goal.id)
      expect(cancelled.status).toBe("cancelled")
      expect(statuses(cancelled)).toEqual({ a: "cancelled", b: "cancelled" })
      expect((yield* jobs.get(jobID)).status).toBe("cancelled")
    }),
  )
})

describe("goal loops", () => {
  const loopPlan = {
    nodes: [
      node("fix", { kind: "loop", executor: undefined, loop: { exitCheckNodeID: "tests", maxIterations: 2 } }),
      node("patch", { parentNodeID: "fix" }),
      node("tests", { kind: "check", parentNodeID: "fix" }),
      node("report", { kind: "synthesis" }),
    ],
    edges: [{ from: "fix", to: "report", kind: "feeds" as const }],
  }

  it.live("iterates until the exit check passes, feeding findings forward", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const goal = yield* goals.create({ projectID: created.id, statement: "Make the tests pass." })
      yield* goals.plan(goal.id, loopPlan)
      const started = yield* goals.start(goal.id)
      expect(statuses(started)).toMatchObject({ fix: "running", patch: "dispatched", tests: "planned" })

      yield* settle({ goalID: goal.id, nodeID: "patch" })
      expect(statuses(yield* goals.get(goal.id)).tests).toBe("dispatched")

      yield* settle({
        goalID: goal.id,
        nodeID: "tests",
        verdict: { pass: false, summary: "1 test fails.", findings: ["auth.test.ts:44"] },
      })

      const second = yield* goals.get(goal.id)
      const loop = second.nodes.find((item) => item.id === "fix")!
      expect(loop.loop?.iteration).toBe(2)
      expect(loop.loop?.lastReport).toBe("1 test fails.\n- auth.test.ts:44")
      // The body is re-queued with its previous run cleared away.
      expect(statuses(second)).toMatchObject({ fix: "running", patch: "dispatched", tests: "planned" })
      const patch = second.nodes.find((item) => item.id === "patch")!
      expect(patch.result).toBeUndefined()
      expect(patch.iteration).toBe(2)

      // A second iteration is a second job, not a retry of the first.
      const jobs = yield* OpencodeXJob.Service
      const keys = (yield* jobs.list()).flatMap((job) => (job.idempotencyKey ? [job.idempotencyKey] : []))
      expect(keys).toContain(`${goal.id}:patch:1`)
      expect(keys).toContain(`${goal.id}:patch:2`)

      yield* settle({ goalID: goal.id, nodeID: "patch" })
      yield* settle({ goalID: goal.id, nodeID: "tests", verdict: { pass: true, summary: "All green." } })

      const passed = yield* goals.get(goal.id)
      expect(passed.nodes.find((item) => item.id === "fix")!.status).toBe("done")
      expect(passed.nodes.find((item) => item.id === "fix")!.result).toBe("All green.")
      expect(statuses(passed).report).toBe("dispatched")

      yield* settle({ goalID: goal.id, nodeID: "report" })
      expect((yield* goals.get(goal.id)).status).toBe("completed")
    }),
  )

  it.live("a spent iteration cap fails the goal rather than exiting unverified", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const goal = yield* goals.create({ projectID: created.id, statement: "Make the tests pass." })
      yield* goals.plan(goal.id, loopPlan)
      yield* goals.start(goal.id)

      for (const iteration of [1, 2]) {
        yield* settle({ goalID: goal.id, nodeID: "patch" })
        yield* settle({
          goalID: goal.id,
          nodeID: "tests",
          verdict: { pass: false, summary: `Still failing after ${iteration}.` },
        })
      }

      const exhausted = yield* goals.get(goal.id)
      expect(exhausted.status).toBe("failed")
      const loop = exhausted.nodes.find((item) => item.id === "fix")!
      expect(loop.status).toBe("failed")
      expect(loop.failureReason).toBe("Still failing after 2.")
      expect(statuses(exhausted).report).toBe("skipped")
    }),
  )

  it.live("a failed body node retries the iteration instead of killing the goal", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const goal = yield* goals.create({ projectID: created.id, statement: "Make the tests pass." })
      yield* goals.plan(goal.id, loopPlan)
      yield* goals.start(goal.id)

      yield* settle({ goalID: goal.id, nodeID: "patch", fail: "patch did not apply" })

      const retried = yield* goals.get(goal.id)
      expect(retried.status).toBe("running")
      expect(retried.nodes.find((item) => item.id === "fix")!.loop?.iteration).toBe(2)
      expect(retried.nodes.find((item) => item.id === "fix")!.loop?.lastReport).toContain("patch did not apply")
      expect(statuses(retried).patch).toBe("dispatched")
    }),
  )
})

describe("standing goals", () => {
  it.live("re-runs its graph when the cadence comes due, and not before", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const dispatch = yield* GoalDispatch
      const goal = yield* goals.create({
        projectID: created.id,
        statement: "Triage new issues nightly.",
        source: "schedule",
        schedule: { everyMs: 3_600_000 },
      })
      yield* goals.plan(goal.id, { nodes: [node("triage")] })

      // No owner session ever starts it, so the sweep is what does.
      const due = yield* dispatch.sweepSchedules(1_000_000)
      expect(due).toEqual([goal.id])

      const running = yield* goals.get(goal.id)
      expect(running.status).toBe("running")
      expect(statuses(running).triage).toBe("dispatched")
      expect(running.schedule).toEqual({ everyMs: 3_600_000, lastRunAt: 1_000_000, nextRunAt: 4_600_000 })

      yield* settle({ goalID: goal.id, nodeID: "triage", result: "3 new issues" })
      const finished = yield* goals.get(goal.id)
      expect(finished.status).toBe("completed")
      expect(finished.spend.nodeRuns).toBe(1)

      // Still inside the cadence: nothing happens.
      expect(yield* dispatch.sweepSchedules(4_599_999)).toEqual([])
      expect((yield* goals.get(goal.id)).status).toBe("completed")

      // Due again: the plan is kept, the previous run's state is cleared.
      expect(yield* dispatch.sweepSchedules(4_600_000)).toEqual([goal.id])
      const second = yield* goals.get(goal.id)
      expect(second.status).toBe("running")
      expect(second.spend).toEqual({ nodeRuns: 0, costUsd: 0 })
      const triage = second.nodes.find((item) => item.id === "triage")!
      expect(triage.status).toBe("dispatched")
      expect(triage.result).toBeUndefined()
      expect(triage.completedAt).toBeUndefined()
    }),
  )

  it.live("never starts a second run on top of one still in flight", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const dispatch = yield* GoalDispatch
      const goal = yield* goals.create({
        projectID: created.id,
        statement: "Watch the build.",
        source: "schedule",
        schedule: { everyMs: 1_000 },
      })
      yield* goals.plan(goal.id, { nodes: [node("watch")] })
      yield* dispatch.sweepSchedules(10_000)

      // A cadence shorter than the work takes slips instead of piling up.
      expect(yield* dispatch.sweepSchedules(99_999)).toEqual([])
      expect((yield* goals.get(goal.id)).schedule?.lastRunAt).toBe(10_000)
    }),
  )
})

describe("mid-flight repair", () => {
  it.live("adds a remediation node behind work that already finished", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const goal = yield* goals.create({ projectID: created.id, statement: "Ship it." })
      yield* goals.plan(goal.id, { nodes: [node("a")] })
      yield* goals.start(goal.id)
      yield* settle({ goalID: goal.id, nodeID: "a", result: "found a problem" })
      expect((yield* goals.get(goal.id)).status).toBe("completed")

      const repaired = yield* goals.updatePlan(goal.id, {
        addNodes: [node("fixup")],
        addEdges: [{ from: "a", to: "fixup", kind: "feeds" }],
      })
      // The repair reopens the goal on its own; no explicit restart needed.
      expect(statuses(repaired)).toEqual({ a: "done", fixup: "dispatched" })
      expect(repaired.status).toBe("running")
    }),
  )

  it.live("refuses a repair that would put a cycle in the graph", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const goal = yield* goals.create({ projectID: created.id, statement: "Ship it." })
      yield* goals.plan(goal.id, { nodes: [node("a"), node("b")], edges: [{ from: "a", to: "b" }] })

      const rejected = yield* goals.updatePlan(goal.id, { addEdges: [{ from: "b", to: "a" }] }).pipe(Effect.flip)
      expect(rejected.message).toContain("dependency cycle")
      expect((yield* goals.get(goal.id)).edges).toHaveLength(1)
    }),
  )

  it.live("skips a node the planner abandons and settles what waited on it", () =>
    Effect.gen(function* () {
      const created = yield* project
      const goals = yield* OpencodeXGoal.Service
      const goal = yield* goals.create({ projectID: created.id, statement: "Ship it." })
      yield* goals.plan(goal.id, {
        nodes: [node("a"), node("b"), node("c")],
        edges: [{ from: "b", to: "c" }],
      })
      yield* goals.start(goal.id)

      const updated = yield* goals.updatePlan(goal.id, { patchNodes: [{ id: "b", status: "skipped" }] })
      expect(statuses(updated)).toMatchObject({ b: "skipped", c: "skipped" })

      yield* settle({ goalID: goal.id, nodeID: "a" })
      expect((yield* goals.get(goal.id)).status).toBe("completed")
    }),
  )
})

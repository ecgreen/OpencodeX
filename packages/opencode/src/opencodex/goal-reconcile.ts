import {
  budgetBreach,
  cascadeSkipIDs,
  failingCheckIDs,
  foldStatus,
  isStalled,
  loopOutcome,
  readyNodeIDs,
  type EdgeView,
  type FailingCheck,
  type NodeView,
} from "./goal-graph"
import { TERMINAL_STATUSES, type Budget, type Schedule, type Spend, type Status } from "./goal-schema"

/**
 * What the dispatcher should do next, decided as a pure function of the goal's
 * current state. Keeping the decision separate from the writing is what lets
 * every rule here - loop advance, skip cascade, budget pause, completion - be
 * tested without a database, a queue, or a model.
 */

export type ReconcileNode = NodeView & { readonly result?: string }

export type ReconcileGoal = {
  readonly status: Status
  readonly budget?: Budget
  readonly spend: Spend
  readonly startedAt?: number
  readonly nodes: readonly ReconcileNode[]
  readonly edges: readonly EdgeView[]
}

export type LoopAction =
  | {
      readonly type: "start"
      readonly nodeID: string
      readonly iteration: number
      readonly resetNodeIDs: readonly string[]
    }
  | {
      readonly type: "advance"
      readonly nodeID: string
      readonly iteration: number
      readonly report: string
      readonly resetNodeIDs: readonly string[]
    }
  | { readonly type: "finish"; readonly nodeID: string; readonly status: "done" | "failed"; readonly report: string }

export type ReconcilePlan = {
  /** Checks whose verdict said no: the node failed even though its job succeeded. */
  readonly fail: readonly FailingCheck[]
  /** Nodes that can never run because an upstream never produced a result. */
  readonly skip: readonly string[]
  readonly loops: readonly LoopAction[]
  /** Gate nodes that should park for a human. */
  readonly gates: readonly string[]
  /** Executable nodes to enqueue as jobs, in dispatch order. */
  readonly dispatch: readonly string[]
  /** Set when the goal itself should change status. */
  readonly goal?: { readonly status: Status; readonly reason?: string }
}

const EXECUTABLE = new Set(["task", "check", "synthesis"])
/** Fixpoint guard: a loop finishing can free work, which can start a loop. */
const MAX_PASSES = 64

export function planReconcile(input: { goal: ReconcileGoal; now: number }): ReconcilePlan {
  const goal = input.goal
  if (TERMINAL_STATUSES.includes(goal.status)) return empty()

  const working = new Map<string, ReconcileNode>(goal.nodes.map((node) => [node.id, node]))
  const edges = goal.edges
  const fail: FailingCheck[] = []
  const skip = new Set<string>()
  const loops: LoopAction[] = []
  const gates = new Set<string>()
  const dispatch: string[] = []

  const breach = budgetBreach({ budget: goal.budget, spend: goal.spend, startedAt: goal.startedAt, now: input.now })

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false

    // A check that ran fine but said "no" fails before anything else settles,
    // so the same pass's skip cascade already sees its dependents as doomed.
    for (const failure of failingCheckIDs({ nodes: [...working.values()], edges })) {
      fail.push(failure)
      working.set(failure.nodeID, {
        ...working.get(failure.nodeID)!,
        status: "failed",
        failureReason: failure.reason,
      })
      changed = true
    }

    const graph = { nodes: [...working.values()], edges }
    for (const id of cascadeSkipIDs(graph)) {
      skip.add(id)
      working.set(id, { ...working.get(id)!, status: "skipped" })
      changed = true
    }

    // Snapshot before iterating: the loop mutates `working` as it settles.
    for (const node of Array.from(working.values())) {
      if (node.kind !== "loop" || node.status !== "running" || !node.loop) continue
      const outcome = loopOutcome({ nodes: [...working.values()], edges }, node.id)
      if (outcome.type === "waiting") continue
      if (outcome.type === "passed") {
        loops.push({ type: "finish", nodeID: node.id, status: "done", report: outcome.report ?? "Exit check passed." })
        working.set(node.id, { ...node, status: "done", result: outcome.report })
        changed = true
        continue
      }
      if (outcome.type === "exhausted") {
        loops.push({ type: "finish", nodeID: node.id, status: "failed", report: outcome.report })
        working.set(node.id, { ...node, status: "failed", failureReason: outcome.report })
        changed = true
        continue
      }
      const body = [...working.values()].filter((item) => item.parentNodeID === node.id)
      loops.push({
        type: "advance",
        nodeID: node.id,
        iteration: outcome.iteration,
        report: outcome.report,
        resetNodeIDs: body.map((item) => item.id),
      })
      working.set(node.id, {
        ...node,
        loop: { ...node.loop, iteration: outcome.iteration, lastReport: outcome.report },
      })
      for (const item of body) {
        working.set(item.id, {
          ...item,
          status: "planned",
          verdict: undefined,
          failureReason: undefined,
          result: undefined,
        })
        skip.delete(item.id)
      }
      changed = true
    }

    for (const id of readyNodeIDs({ nodes: [...working.values()], edges })) {
      const node = working.get(id)!
      if (node.kind === "loop") {
        const iteration = 1
        loops.push({
          type: "start",
          nodeID: id,
          iteration,
          // Body nodes are stamped with the iteration they belong to, so each
          // pass gets its own job rather than colliding with the last one's.
          resetNodeIDs: [...working.values()].filter((item) => item.parentNodeID === id).map((item) => item.id),
        })
        working.set(id, {
          ...node,
          status: "running",
          loop: node.loop ? { ...node.loop, iteration } : undefined,
        })
        changed = true
        continue
      }
      if (node.kind === "gate") {
        gates.add(id)
        working.set(id, { ...node, status: "awaiting_approval" })
        changed = true
        continue
      }
      if (!EXECUTABLE.has(node.kind)) continue
      // A spent budget stops new work without killing what is already running.
      if (breach) continue
      dispatch.push(id)
      working.set(id, { ...node, status: "dispatched" })
      changed = true
    }

    if (!changed) break
  }

  const graph = { nodes: [...working.values()], edges }
  return {
    fail,
    skip: [...skip],
    loops,
    gates: [...gates],
    dispatch,
    goal: goalTransition({ goal, graph, breach }),
  }
}

function goalTransition(input: {
  goal: ReconcileGoal
  graph: { nodes: readonly ReconcileNode[]; edges: readonly EdgeView[] }
  breach?: string
}) {
  const folded = foldStatus(input.graph)
  if (folded === "completed" || folded === "failed") {
    return input.goal.status === folded ? undefined : { status: folded as Status }
  }
  if (input.breach) {
    // Nothing new dispatches, but work already in flight is allowed to land.
    return input.goal.status === "paused" ? undefined : { status: "paused" as Status, reason: input.breach }
  }
  if (folded === "blocked") {
    return input.goal.status === "blocked" ? undefined : { status: "blocked" as Status }
  }
  if (isStalled(input.graph)) {
    return {
      status: "failed" as Status,
      reason: "The graph cannot progress: work remains but nothing can run it.",
    }
  }
  return input.goal.status === "running" ? undefined : { status: "running" as Status }
}

function empty(): ReconcilePlan {
  return { fail: [], skip: [], loops: [], gates: [], dispatch: [] }
}

export type StandingGoal = {
  readonly status: Status
  readonly schedule?: Schedule
  readonly nodeCount: number
}

/**
 * Whether a standing goal should run its graph again. A run is never started
 * on top of one already in flight, so a cadence shorter than the work takes
 * slips rather than piling up.
 */
export function scheduleDue(input: { goal: StandingGoal; now: number }): boolean {
  const schedule = input.goal.schedule
  if (!schedule || schedule.paused === true) return false
  if (input.goal.nodeCount === 0) return false
  if (schedule.everyMs <= 0) return false
  if (["running", "blocked", "draft"].includes(input.goal.status)) return false
  // No nextRunAt means it has never run: due immediately.
  return schedule.nextRunAt === undefined || schedule.nextRunAt <= input.now
}

/** The schedule after a run starts. Anchored to now, so drift does not stack. */
export function advanceSchedule(schedule: Schedule, now: number): Schedule {
  return { ...schedule, lastRunAt: now, nextRunAt: now + schedule.everyMs }
}

export * as GoalReconcile from "./goal-reconcile"

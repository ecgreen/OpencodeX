import {
  budgetBreach,
  cascadeSkipIDs,
  foldStatus,
  isStalled,
  loopOutcome,
  readyNodeIDs,
  type EdgeView,
  type NodeView,
} from "./goal-graph"
import { TERMINAL_STATUSES, type Budget, type Spend, type Status } from "./goal-schema"

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
  const skip = new Set<string>()
  const loops: LoopAction[] = []
  const gates = new Set<string>()
  const dispatch: string[] = []

  const breach = budgetBreach({ budget: goal.budget, spend: goal.spend, startedAt: goal.startedAt, now: input.now })

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const graph = { nodes: [...working.values()], edges }
    let changed = false

    for (const id of cascadeSkipIDs(graph)) {
      skip.add(id)
      working.set(id, { ...working.get(id)!, status: "skipped" })
      changed = true
    }

    for (const node of [...working.values()]) {
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
  return { skip: [], loops: [], gates: [], dispatch: [] }
}

export * as GoalReconcile from "./goal-reconcile"

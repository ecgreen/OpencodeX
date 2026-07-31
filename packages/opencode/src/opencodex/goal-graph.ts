import { SwarmBriefing } from "./swarm-briefing"
import type { Budget, EdgeInput, EdgeKind, Executor, NodeInput, NodeKind, NodeStatus, Spend } from "./goal-schema"

/**
 * The graph algebra: validation, readiness, skip propagation, loop advance, and
 * status folding. Everything here is pure so the runtime's decisions can be
 * tested without a database, a model, or a job queue - the dispatcher is
 * deliberately dumb because all of its judgement lives in this file.
 */

/** Node kinds that run an executor. Loops contain work; gates wait for a human. */
export const EXECUTABLE_KINDS: readonly NodeKind[] = ["task", "check", "synthesis"]

export const MAX_LOOP_ITERATIONS = 50
const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export type LoopView = {
  readonly exitCheckNodeID: string
  readonly maxIterations: number
  readonly iteration: number
  readonly lastReport?: string
}

export type NodeView = {
  readonly id: string
  readonly kind: NodeKind
  readonly status: NodeStatus
  readonly parentNodeID?: string
  readonly loop?: LoopView
  readonly verdict?: { readonly pass: boolean; readonly summary?: string; readonly findings?: readonly string[] }
  readonly failureReason?: string
  readonly title?: string
}

export type EdgeView = {
  readonly fromNodeID: string
  readonly toNodeID: string
  readonly kind: EdgeKind
}

export type GraphView = {
  readonly nodes: readonly NodeView[]
  readonly edges: readonly EdgeView[]
}

const TERMINAL: readonly NodeStatus[] = ["done", "failed", "skipped", "cancelled"]
/** A dependency is only satisfied by real success; skipped work is not a result. */
const SATISFYING: readonly NodeStatus[] = ["done"]
const POISONED: readonly NodeStatus[] = ["failed", "skipped", "cancelled"]
const PENDING: readonly NodeStatus[] = ["planned", "ready", "dispatched", "running"]

export function isTerminal(status: NodeStatus) {
  return TERMINAL.includes(status)
}

export function isPending(status: NodeStatus) {
  return PENDING.includes(status)
}

/** An index over one graph. Built once per decision so lookups stay O(1). */
export type GraphIndex = {
  readonly byID: ReadonlyMap<string, NodeView>
  /** Edges pointing at a node. Both edge kinds gate: you cannot pipe a missing result. */
  readonly incoming: ReadonlyMap<string, readonly EdgeView[]>
  readonly outgoing: ReadonlyMap<string, readonly EdgeView[]>
  /** Body members of each loop node, in declaration order. */
  readonly body: ReadonlyMap<string, readonly NodeView[]>
}

export function indexGraph(graph: GraphView): GraphIndex {
  const byID = new Map(graph.nodes.map((node) => [node.id, node]))
  const incoming = new Map<string, EdgeView[]>()
  const outgoing = new Map<string, EdgeView[]>()
  const body = new Map<string, NodeView[]>()
  for (const edge of graph.edges) {
    if (!incoming.has(edge.toNodeID)) incoming.set(edge.toNodeID, [])
    if (!outgoing.has(edge.fromNodeID)) outgoing.set(edge.fromNodeID, [])
    incoming.get(edge.toNodeID)!.push(edge)
    outgoing.get(edge.fromNodeID)!.push(edge)
  }
  for (const node of graph.nodes) {
    if (!node.parentNodeID) continue
    if (!body.has(node.parentNodeID)) body.set(node.parentNodeID, [])
    body.get(node.parentNodeID)!.push(node)
  }
  return { byID, incoming, outgoing, body }
}

export function dependencies(index: GraphIndex, nodeID: string) {
  return index.incoming.get(nodeID) ?? []
}

export function bodyNodes(index: GraphIndex, loopID: string) {
  return index.body.get(loopID) ?? []
}

/**
 * Nodes whose dependencies are met and which the runtime should act on now.
 * "Act on" depends on the kind: tasks and checks dispatch, loops start their
 * first iteration, gates park for approval.
 */
export function readyNodeIDs(graph: GraphView): string[] {
  const index = indexGraph(graph)
  const ready: string[] = []
  for (const node of graph.nodes) {
    if (node.status !== "planned") continue
    if (node.parentNodeID) {
      const loop = index.byID.get(node.parentNodeID)
      // Body work only exists while its loop is iterating.
      if (!loop || loop.status !== "running") continue
      if (loop.loop?.exitCheckNodeID === node.id) {
        const siblings = bodyNodes(index, loop.id).filter((item) => item.id !== node.id)
        // The exit check verifies a finished iteration, so it waits for the
        // body - and never runs at all once the iteration has already failed.
        if (!siblings.every((item) => isTerminal(item.status))) continue
        if (siblings.some((item) => item.status === "failed")) continue
      }
    }
    const deps = dependencies(index, node.id)
    if (!deps.every((edge) => satisfied(index.byID.get(edge.fromNodeID)))) continue
    ready.push(node.id)
  }
  return ready
}

function satisfied(node: NodeView | undefined) {
  return node !== undefined && SATISFYING.includes(node.status)
}

/**
 * Nodes that can never run because something they depend on failed, was
 * skipped, or was cancelled. Transitive, so one failure settles its whole
 * downstream cone in a single pass instead of one reconcile tick per level.
 */
export function cascadeSkipIDs(graph: GraphView): string[] {
  const index = indexGraph(graph)
  const status = new Map(graph.nodes.map((node) => [node.id, node.status]))
  const skipped = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const node of graph.nodes) {
      if (skipped.has(node.id)) continue
      if (!isPending(status.get(node.id)!)) continue
      const poisoned =
        dependencies(index, node.id).some((edge) => {
          const from = status.get(edge.fromNodeID)
          return from === undefined || POISONED.includes(from)
        }) ||
        // Body membership is not an edge, so a loop that will never iterate
        // again has to settle its body explicitly or it would sit forever.
        (node.parentNodeID !== undefined && isTerminal(status.get(node.parentNodeID) ?? "failed"))
      if (!poisoned) continue
      skipped.add(node.id)
      status.set(node.id, "skipped")
      changed = true
    }
  }
  return [...skipped]
}

/**
 * The upstream results piped into a node's prompt. Only `feeds` edges carry
 * context - a `requires` edge says "wait for this", not "read this" - and only
 * from work that actually succeeded and said something.
 */
export function feedsContext<T extends NodeView & { readonly result?: string }>(
  graph: { readonly nodes: readonly T[]; readonly edges: readonly EdgeView[] },
  nodeID: string,
): { title: string; result: string }[] {
  const byID = new Map(graph.nodes.map((node) => [node.id, node]))
  return graph.edges
    .filter((edge) => edge.toNodeID === nodeID && edge.kind === "feeds")
    .flatMap((edge) => {
      const from = byID.get(edge.fromNodeID)
      if (!from || from.status !== "done") return []
      const result = from.result?.trim()
      if (!result) return []
      return [{ title: from.title ?? from.id, result }]
    })
}

export type LoopOutcome =
  /** The iteration is still in flight. */
  | { readonly type: "waiting" }
  /** The exit check passed; the loop is done. */
  | { readonly type: "passed"; readonly report?: string }
  /** The iteration did not satisfy the exit check, and budget remains. */
  | { readonly type: "continue"; readonly iteration: number; readonly report: string }
  /** The iteration cap is spent and the criteria still do not hold. */
  | { readonly type: "exhausted"; readonly report: string }

/**
 * What a running loop should do next. A loop never exits silently unverified:
 * every path out is either a passing exit check or an explicit exhaustion.
 */
export function loopOutcome(graph: GraphView, loopID: string): LoopOutcome {
  const index = indexGraph(graph)
  const loop = index.byID.get(loopID)
  if (!loop?.loop) return { type: "waiting" }
  const members = bodyNodes(index, loopID)
  const check = index.byID.get(loop.loop.exitCheckNodeID)
  const failed = members.find((node) => node.id !== check?.id && node.status === "failed")
  if (failed) {
    return advance(loop.loop, `Body node "${failed.title ?? failed.id}" failed: ${failed.failureReason ?? "no reason recorded"}`)
  }
  if (!check) return { type: "exhausted", report: "Loop has no exit check." }
  if (!isTerminal(check.status)) return { type: "waiting" }
  if (check.status === "done" && check.verdict?.pass === true) {
    return { type: "passed", report: check.verdict.summary }
  }
  if (check.status === "done" && check.verdict) {
    return advance(loop.loop, checkReport(check.verdict))
  }
  // The check errored, was skipped, or returned no verdict at all. Treating any
  // of these as a pass would exit the loop unverified, so they are failures.
  return advance(loop.loop, check.failureReason ?? "Exit check did not return a verdict.")
}

function advance(loop: LoopView, report: string): LoopOutcome {
  if (loop.iteration < loop.maxIterations) return { type: "continue", iteration: loop.iteration + 1, report }
  return { type: "exhausted", report }
}

function checkReport(verdict: NonNullable<NodeView["verdict"]>) {
  const findings = verdict.findings ?? []
  return [verdict.summary?.trim(), ...findings.map((finding) => `- ${finding}`)].filter(Boolean).join("\n")
}

export type FoldedStatus = "running" | "blocked" | "completed" | "failed"

/** The goal status implied by its nodes. Budget pauses are set outside this. */
export function foldStatus(graph: GraphView): FoldedStatus {
  if (graph.nodes.length === 0) return "running"
  if (graph.nodes.some((node) => node.status === "awaiting_approval")) return "blocked"
  if (graph.nodes.some((node) => isPending(node.status))) return "running"
  return graph.nodes.some((node) => node.status === "failed") ? "failed" : "completed"
}

/**
 * True when work remains but nothing can move: no ready node, nothing running,
 * and nothing waiting on a human. Validation should make this unreachable, so
 * the dispatcher treats it as a goal failure rather than hanging forever.
 */
export function isStalled(graph: GraphView): boolean {
  if (!graph.nodes.some((node) => isPending(node.status))) return false
  if (graph.nodes.some((node) => ["ready", "dispatched", "running", "awaiting_approval"].includes(node.status))) {
    return false
  }
  if (readyNodeIDs(graph).length > 0) return false
  return cascadeSkipIDs(graph).length === 0
}

export function budgetBreach(input: {
  budget?: Budget
  spend: Spend
  startedAt?: number
  now: number
}): string | undefined {
  const budget = input.budget
  if (!budget) return undefined
  if (budget.maxNodeRuns !== undefined && input.spend.nodeRuns >= budget.maxNodeRuns) {
    return `Node run budget spent (${input.spend.nodeRuns}/${budget.maxNodeRuns}).`
  }
  if (budget.maxCostUsd !== undefined && input.spend.costUsd >= budget.maxCostUsd) {
    return `Cost budget spent ($${input.spend.costUsd.toFixed(2)}/$${budget.maxCostUsd.toFixed(2)}).`
  }
  if (budget.maxWallClockMs !== undefined && input.startedAt !== undefined) {
    const elapsed = input.now - input.startedAt
    if (elapsed >= budget.maxWallClockMs) {
      return `Wall-clock budget spent (${Math.round(elapsed / 1000)}s/${Math.round(budget.maxWallClockMs / 1000)}s).`
    }
  }
  return undefined
}

export type ValidationContext = {
  /** Role names on the goal's swarm, when it has one. */
  readonly roles?: readonly string[]
  /** Registered agent names, when the caller can enumerate them. */
  readonly agents?: readonly string[]
}

/**
 * Every problem with a proposed plan, so a planner can repair all of them in
 * one pass. An empty array means the plan is executable.
 */
export function validatePlan(
  input: { nodes: readonly NodeInput[]; edges?: readonly EdgeInput[] },
  context: ValidationContext = {},
): string[] {
  const issues: string[] = []
  const nodes = input.nodes
  const edges = input.edges ?? []
  if (nodes.length === 0) return ["A plan needs at least one node."]

  const byID = new Map<string, NodeInput>()
  for (const node of nodes) {
    if (!NODE_ID_PATTERN.test(node.id)) {
      issues.push(`Node id "${node.id}" must be 1-64 characters of letters, digits, dot, dash, or underscore.`)
      continue
    }
    if (byID.has(node.id)) {
      issues.push(`Duplicate node id "${node.id}".`)
      continue
    }
    byID.set(node.id, node)
  }
  for (const node of byID.values()) {
    if (!node.title.trim()) issues.push(`Node "${node.id}" needs a title.`)
    if (!node.brief.trim()) issues.push(`Node "${node.id}" needs a brief describing what to do.`)
    issues.push(...executorIssues(node, context))
    issues.push(...parentIssues(node, byID))
  }
  issues.push(...loopIssues(byID))
  issues.push(...edgeIssues(edges, byID))
  if (issues.length > 0) return issues
  // Structure is sound; only now do the whole-graph checks, whose results are
  // meaningless (and whose traversals can misbehave) on a malformed plan.
  return [...cycleIssues(nodes, edges), ...boundaryIssues(nodes, edges)]
}

function executorIssues(node: NodeInput, context: ValidationContext): string[] {
  const kind = node.kind ?? "task"
  const executor = node.executor
  if (!EXECUTABLE_KINDS.includes(kind)) {
    return executor ? [`Node "${node.id}" is a ${kind} and cannot have an executor.`] : []
  }
  if (!executor) return [`Node "${node.id}" needs an executor.`]
  if (executor.type === "swarm_role") {
    if (!executor.role.trim()) return [`Node "${node.id}" names an empty swarm role.`]
    if (!context.roles) return []
    if (!SwarmBriefing.matchSwarmRole(context.roles.map((name) => ({ name })), executor.role)) {
      return [`Node "${node.id}" names unknown swarm role "${executor.role}". Available: ${context.roles.join(", ")}.`]
    }
    return []
  }
  if (executor.type === "agent") {
    if (!executor.agent.trim()) return [`Node "${node.id}" names an empty agent.`]
    if (context.agents && !context.agents.includes(executor.agent)) {
      return [`Node "${node.id}" names unknown agent "${executor.agent}". Available: ${context.agents.join(", ")}.`]
    }
  }
  // A bare model executor inherits the goal's model, so half a model pair is
  // the only genuinely ambiguous case.
  if (Boolean(executor.providerID) !== Boolean(executor.modelID)) {
    return [`Node "${node.id}" needs both providerID and modelID, or neither.`]
  }
  return []
}

function parentIssues(node: NodeInput, byID: ReadonlyMap<string, NodeInput>): string[] {
  if (!node.parentNodeID) return []
  const parent = byID.get(node.parentNodeID)
  if (!parent) return [`Node "${node.id}" belongs to unknown loop "${node.parentNodeID}".`]
  if ((parent.kind ?? "task") !== "loop") return [`Node "${node.id}" belongs to "${parent.id}", which is not a loop.`]
  if ((node.kind ?? "task") === "loop") return [`Loop "${node.id}" is nested inside "${parent.id}"; nested loops are not supported.`]
  return []
}

function loopIssues(byID: ReadonlyMap<string, NodeInput>): string[] {
  const issues: string[] = []
  for (const node of byID.values()) {
    if ((node.kind ?? "task") !== "loop") continue
    if (!node.loop) {
      issues.push(`Loop "${node.id}" needs a loop configuration naming its exit check.`)
      continue
    }
    const members = [...byID.values()].filter((item) => item.parentNodeID === node.id)
    const check = byID.get(node.loop.exitCheckNodeID)
    if (!check) {
      issues.push(`Loop "${node.id}" names unknown exit check "${node.loop.exitCheckNodeID}".`)
    } else if ((check.kind ?? "task") !== "check") {
      issues.push(`Loop "${node.id}" names exit check "${check.id}", which is a ${check.kind ?? "task"} and not a check.`)
    } else if (check.parentNodeID !== node.id) {
      issues.push(`Loop "${node.id}" names exit check "${check.id}", which is not one of its body nodes.`)
    }
    if (members.filter((item) => item.id !== node.loop!.exitCheckNodeID).length === 0) {
      issues.push(`Loop "${node.id}" has no body work; a loop that only checks can never change its own outcome.`)
    }
    const max = node.loop.maxIterations
    if (max !== undefined && (!Number.isInteger(max) || max < 1 || max > MAX_LOOP_ITERATIONS)) {
      issues.push(`Loop "${node.id}" needs maxIterations between 1 and ${MAX_LOOP_ITERATIONS}.`)
    }
  }
  return issues
}

function edgeIssues(edges: readonly EdgeInput[], byID: ReadonlyMap<string, NodeInput>): string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const edge of edges) {
    if (!byID.has(edge.from)) issues.push(`Edge references unknown node "${edge.from}".`)
    if (!byID.has(edge.to)) issues.push(`Edge references unknown node "${edge.to}".`)
    if (edge.from === edge.to) issues.push(`Node "${edge.from}" cannot depend on itself.`)
    const key = `${edge.from}->${edge.to}:${edge.kind ?? "requires"}`
    if (seen.has(key)) issues.push(`Duplicate ${edge.kind ?? "requires"} edge from "${edge.from}" to "${edge.to}".`)
    seen.add(key)
  }
  return issues
}

/**
 * Cycles are illegal everywhere: between loops (checked on a graph where each
 * body node is collapsed into its loop) and inside a single loop body, whose
 * one legal repetition is the loop's own iteration.
 */
function cycleIssues(nodes: readonly NodeInput[], edges: readonly EdgeInput[]): string[] {
  const quotient = new Map(nodes.map((node) => [node.id, node.parentNodeID ?? node.id]))
  const collapsed = edges
    .map((edge) => ({ from: quotient.get(edge.from)!, to: quotient.get(edge.to)! }))
    .filter((edge) => edge.from !== edge.to)
  const cycle = findCycle(
    nodes.map((node) => quotient.get(node.id)!),
    collapsed,
  )
  if (cycle) return [`Plan has a dependency cycle: ${cycle.join(" -> ")}.`]
  const loops = new Set(nodes.flatMap((node) => (node.parentNodeID ? [node.parentNodeID] : [])))
  for (const loopID of loops) {
    const members = nodes.filter((node) => node.parentNodeID === loopID).map((node) => node.id)
    const memberSet = new Set(members)
    const inner = edges.filter((edge) => memberSet.has(edge.from) && memberSet.has(edge.to))
    const innerCycle = findCycle(members, inner)
    if (innerCycle) return [`Loop "${loopID}" has a dependency cycle in its body: ${innerCycle.join(" -> ")}.`]
  }
  return []
}

function findCycle(nodeIDs: readonly string[], edges: readonly { from: string; to: string }[]): string[] | undefined {
  const adjacency = new Map<string, string[]>()
  for (const id of nodeIDs) adjacency.set(id, [])
  for (const edge of edges) adjacency.get(edge.from)?.push(edge.to)
  const state = new Map<string, "visiting" | "done">()
  const stack: string[] = []
  const walk = (id: string): string[] | undefined => {
    const current = state.get(id)
    if (current === "done") return undefined
    if (current === "visiting") return [...stack.slice(stack.indexOf(id)), id]
    state.set(id, "visiting")
    stack.push(id)
    for (const next of adjacency.get(id) ?? []) {
      const found = walk(next)
      if (found) return found
    }
    stack.pop()
    state.set(id, "done")
    return undefined
  }
  for (const id of new Set(nodeIDs)) {
    const found = walk(id)
    if (found) return found
  }
  return undefined
}

/**
 * Loop bodies reset every iteration, so their nodes cannot be depended on from
 * outside; and a body node may only depend on outside work the loop itself
 * already waited for, or the iteration would stall on something no one is
 * running.
 */
function boundaryIssues(nodes: readonly NodeInput[], edges: readonly EdgeInput[]): string[] {
  const issues: string[] = []
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentNodeID]))
  const ancestors = transitiveDependencies(nodes, edges)
  for (const edge of edges) {
    const fromLoop = parentOf.get(edge.from)
    const toLoop = parentOf.get(edge.to)
    if (fromLoop === toLoop) continue
    if (fromLoop !== undefined) {
      issues.push(
        `Edge "${edge.from}" -> "${edge.to}" leaves loop "${fromLoop}"; depend on the loop node itself, whose result survives the iteration.`,
      )
      continue
    }
    // Entering a loop body from outside is fine only when the loop already
    // requires that node, which guarantees it is finished before any iteration.
    if (toLoop !== undefined && !ancestors.get(toLoop)?.has(edge.from)) {
      issues.push(
        `Edge "${edge.from}" -> "${edge.to}" enters loop "${toLoop}", but the loop does not require "${edge.from}"; add that dependency so the value exists before the first iteration.`,
      )
    }
  }
  return issues
}

function transitiveDependencies(nodes: readonly NodeInput[], edges: readonly EdgeInput[]) {
  const direct = new Map<string, string[]>()
  for (const node of nodes) direct.set(node.id, [])
  for (const edge of edges) direct.get(edge.to)?.push(edge.from)
  const resolved = new Map<string, Set<string>>()
  const walk = (id: string, seen: Set<string>): Set<string> => {
    const cached = resolved.get(id)
    if (cached) return cached
    if (seen.has(id)) return new Set()
    seen.add(id)
    const all = new Set<string>()
    for (const from of direct.get(id) ?? []) {
      all.add(from)
      for (const deeper of walk(from, seen)) all.add(deeper)
    }
    resolved.set(id, all)
    return all
  }
  for (const node of nodes) walk(node.id, new Set())
  return resolved
}

export type ExecutorView = Executor

export * as GoalGraph from "./goal-graph"

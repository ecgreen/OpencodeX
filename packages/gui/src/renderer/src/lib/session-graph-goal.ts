import type { OpencodeXGoal, OpencodeXGoalNode } from "@opencode-ai/sdk/v2/client"
import { executorLabel } from "./goal-graph-view"
import type {
  SessionGraphEdge,
  SessionGraphNode,
  SessionGraphOutcome,
  SessionGraphStatus,
} from "./session-graph"
import { OUTCOME_BADGE, summarizeGraphDetail } from "./session-graph-nodes"

/**
 * A declared goal, folded into the pipeline the session actually ran.
 *
 * Execution is the better witness and needs no cooperation from the model, so
 * it draws the shape: a goal's steps run in sessions parented to the chat, and
 * the stage inference already places them. The plan is consulted for the one
 * thing running never reveals - the steps that have not run yet - and for the
 * approval a gate is parked on, which is the only thing a goal asks a human.
 */

/** What a parked gate needs to be answered from the canvas. */
export type SessionGraphGate = { goalID: string; nodeID: string }

const STATUS: Record<string, SessionGraphStatus> = {
  planned: "queued",
  ready: "queued",
  dispatched: "running",
  running: "running",
  done: "completed",
  failed: "failed",
  skipped: "cancelled",
  cancelled: "cancelled",
  awaiting_approval: "input_needed",
}

const STATUS_LABEL: Record<SessionGraphStatus, string> = {
  idle: "Idle",
  queued: "Not started",
  running: "Running",
  input_needed: "Needs your approval",
  needs_review: "Ready for review",
  completed: "Done",
  returned: "Returned",
  failed: "Failed",
  cancelled: "Skipped",
}

export function goalNodeStatus(status: string): SessionGraphStatus {
  return STATUS[status] ?? "queued"
}

/** What a terminal plan step produced; running/waiting steps have no outcome. */
const GOAL_OUTCOME: Record<string, SessionGraphOutcome> = {
  done: "verified_success",
  failed: "failed",
  skipped: "cancelled",
  cancelled: "cancelled",
}

/** The goal's steps, by the session each one ran in. */
export function goalNodesBySession(goal: OpencodeXGoal) {
  return new Map(
    goal.nodes.flatMap((node) => (node.sessionID ? [[node.sessionID, node] as const] : [])),
  )
}

/**
 * What the plan adds to a step the pipeline already drew: who was meant to run
 * it, why it is parked, and the prompt it was handed. The shape stays as it
 * ran - only the labelling comes from the plan.
 */
export function enrichWithGoalNode(node: SessionGraphNode, goalNode: OpencodeXGoalNode, goalID: string) {
  const gated = goalNode.status === "awaiting_approval"
  return {
    ...node,
    role: node.role ?? executorLabel(goalNode),
    ...(gated ? { status: "input_needed" as const, statusLabel: STATUS_LABEL.input_needed } : {}),
    ...(gated ? { gate: { goalID, nodeID: goalNode.id } } : {}),
    ...(node.detail ? {} : goalDetail(goalNode)),
  }
}

/**
 * The steps the plan declares that execution cannot see, because they have not
 * run. Their order is the one place the declared edges are authoritative:
 * nothing has happened yet to infer from.
 */
export function plannedGoalNodes(input: {
  goal: OpencodeXGoal
  /**
   * Steps the pipeline already drew, by goal node id. Carries the graph node id
   * as well as the column: a step's own id is its session's, not its plan's, so
   * an edge into it cannot be spelled from the plan id alone.
   */
  placed: ReadonlyMap<string, { id: string; depth: number }>
  /** Where the pipeline currently ends, which unblocked steps hang off. */
  tail: SessionGraphNode
  tailDepth: number
}) {
  const drawn = input.placed
  const pending = input.goal.nodes.filter((node) => !drawn.has(node.id))
  if (pending.length === 0) return { nodes: [] as SessionGraphNode[], edges: [] as SessionGraphEdge[] }
  const byID = new Map(input.goal.nodes.map((node) => [node.id, node]))
  const dependencies = new Map(
    input.goal.nodes.map((node) => [
      node.id,
      input.goal.edges.filter((edge) => edge.toNodeID === node.id).map((edge) => edge.fromNodeID),
    ]),
  )
  const depths = new Map<string, number>()
  const resolving = new Set<string>()

  function depthOf(nodeID: string): number {
    const placed = drawn.get(nodeID)?.depth
    if (placed !== undefined) return placed
    const known = depths.get(nodeID)
    if (known !== undefined) return known
    // A plan should not name itself as its own input, but it is assembled by a
    // model, so a cycle settles at the tail rather than recursing forever.
    if (resolving.has(nodeID)) return input.tailDepth
    resolving.add(nodeID)
    const from = (dependencies.get(nodeID) ?? []).filter((id) => byID.has(id))
    const depth = from.length === 0 ? input.tailDepth + 1 : Math.max(...from.map(depthOf)) + 1
    resolving.delete(nodeID)
    depths.set(nodeID, depth)
    return depth
  }

  const nodes: SessionGraphNode[] = []
  const edges: SessionGraphEdge[] = []
  for (const node of [...pending].toSorted((left, right) => left.sortOrder - right.sortOrder)) {
    const status = goalNodeStatus(node.status)
    const outcome = GOAL_OUTCOME[node.status]
    const id = `goal:${node.id}`
    nodes.push({
      id,
      kind: "session",
      ...(node.sessionID ? { sessionID: node.sessionID } : {}),
      depth: depthOf(node.id),
      title: node.title,
      ...(executorLabel(node) ? { role: executorLabel(node) } : {}),
      status,
      statusLabel: STATUS_LABEL[status],
      ...(outcome ? { outcome, badge: OUTCOME_BADGE[outcome] } : {}),
      ...(status === "input_needed" ? { gate: { goalID: input.goal.id, nodeID: node.id } } : {}),
      ...goalDetail(node),
      updatedAt: node.completedAt ?? 0,
      root: false,
    })
    const from = (dependencies.get(node.id) ?? []).filter((id) => byID.has(id))
    const sources = from.length === 0 ? [input.tail.id] : from.map((id) => sourceID(id, drawn))
    for (const source of sources) {
      edges.push({
        id: `edge:${source}:${id}`,
        from: source,
        to: id,
        label: node.kind === "gate" ? "Awaiting approval" : "Planned",
        detail: node.brief || node.title,
        status,
        // The one place declared edges are authoritative: steps that have not
        // run. Once a step runs, execution draws its shape instead.
        provenance: "planned",
      })
    }
  }
  return { nodes, edges }
}

/** A dependency is either a step already drawn from its session, or another plan step. */
function sourceID(nodeID: string, drawn: ReadonlyMap<string, { id: string; depth: number }>) {
  return drawn.get(nodeID)?.id ?? `goal:${nodeID}`
}

function goalDetail(node: OpencodeXGoalNode) {
  const detail = node.failureReason || node.brief
  return detail ? { detail: summarizeGraphDetail(detail) } : {}
}

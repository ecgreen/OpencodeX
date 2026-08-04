import type {
  SessionGraphEdge,
  SessionGraphNode,
  SessionGraphOutcome,
  SessionGraphStatus,
} from "./session-graph"
import { OUTCOME_BADGE } from "./session-graph-nodes"

/**
 * Fan-in for the workflow graph.
 *
 * Delegation gives the graph its forks; this builds the joins. A stage of two
 * or more concurrent steps earns a merge node - that is a real fan-in, and the
 * next stage hangs off it. A stage of one does not: a lone step flows straight
 * into whatever follows it, and a diamond drawn across it would be decoration.
 *
 * The last stage always merges, whatever its width, because that is the point
 * where the delegating session gets its work back.
 *
 * Merge nodes are presentation, not sessions: clicking one opens the session
 * that consolidates (the parent), and none of them count as workflow steps.
 */

const TERMINAL: ReadonlySet<SessionGraphStatus> = new Set([
  "completed",
  "needs_review",
  "returned",
  "failed",
  "cancelled",
])

/** What reports into a merge: a leaf itself, or a branch's own final merge. */
export type SessionGraphBranch = { child: SessionGraphNode; via: SessionGraphNode }

export function stageMergeNeeded(input: { branches: readonly SessionGraphBranch[]; final: boolean }) {
  return input.final || input.branches.length > 1
}

/**
 * The merge closing one stage. `index` is the stage's position under its
 * parent; the final stage keeps the unsuffixed id, so a session's consolidation
 * stays addressable as `join:<parent node id>` however many stages preceded it.
 */
export function buildStageMerge(input: {
  parent: SessionGraphNode
  branches: readonly SessionGraphBranch[]
  index: number
  final: boolean
  depth: number
  busyType?: string
}): { node: SessionGraphNode; edges: SessionGraphEdge[] } {
  const settled = input.branches.filter((branch) => TERMINAL.has(branch.via.status))
  // What reports in may itself be a merge; each branch's *outcome* survives
  // the hop unchanged, so no nesting depth can launder a failed, partial,
  // review-required, or unknown subtree into a green check.
  const outcomes = settled.map((branch) => branchOutcome(branch.via))
  const wentWrong = outcomes.filter((value) => value === "failed" || value === "cancelled").length
  const outcome = mergeOutcome({
    total: input.branches.length,
    settled: settled.length,
    outcomes,
    busy: input.busyType === "busy" || input.busyType === "retry",
  })
  const node: SessionGraphNode = {
    id: input.final ? `join:${input.parent.id}` : `join:${input.parent.id}:${input.index}`,
    kind: "join",
    sessionID: input.parent.sessionID,
    depth: input.depth,
    title: "Merge results",
    role: input.final ? `into ${input.parent.title}` : `stage ${input.index + 1} of ${input.parent.title}`,
    ...outcome,
    progress: { completed: settled.length - wentWrong, failed: wentWrong, total: input.branches.length },
    updatedAt: Math.max(...input.branches.map((branch) => branch.via.updatedAt), 0),
    root: false,
  }
  return {
    node,
    edges: input.branches.map((branch) => ({
      id: `${branch.via.id}->${node.id}`,
      from: branch.via.id,
      to: node.id,
      label: "results",
      detail: `${branch.child.title} reports back into ${input.parent.title}.`,
      status: branch.via.status,
      provenance: "synthetic_return" as const,
    })),
  }
}

/**
 * What quality a settled branch reports into the fan-in. Every terminal node
 * carries an explicit outcome; the status fallback only covers nodes built
 * before outcomes existed (fixtures, tests) and stays conservative.
 */
function branchOutcome(via: SessionGraphNode): SessionGraphOutcome {
  if (via.outcome) return via.outcome
  if (via.status === "failed") return "failed"
  if (via.status === "cancelled") return "cancelled"
  if (via.status === "needs_review") return "review_required"
  if (via.status === "returned") return "unknown"
  return "unknown"
}

/**
 * What the fan-in may claim, given what its branches actually produced.
 *
 * A merge is the one place a run's imperfections could be laundered into a
 * green check, so aggregation is worst-first over branch *outcomes*: an
 * unqualified success only when every branch verifiably succeeded; failures
 * and partials are qualified; review-required keeps the merge in the
 * attention pool rather than the done pool; unknown stays unknown; and an
 * all-cancelled fan-in is itself cancelled, which is not a failure.
 */
function mergeOutcome(input: {
  total: number
  settled: number
  outcomes: readonly SessionGraphOutcome[]
  busy: boolean
}): {
  status: SessionGraphStatus
  statusLabel: string
  outcome?: SessionGraphOutcome
  badge?: "success" | "warning" | "failure" | "cancelled"
} {
  if (input.settled < input.total) return { status: "queued", statusLabel: "Waiting on branches" }
  if (input.busy) return { status: "running", statusLabel: "Merging" }
  const count = (outcome: SessionGraphOutcome) =>
    input.outcomes.filter((value) => value === outcome).length
  const failed = count("failed")
  const partial = count("partial")
  const review = count("review_required")
  const unknown = count("unknown")
  const unverified = count("completed_unverified")
  const cancelled = count("cancelled")
  if (failed >= input.total && input.total > 0)
    return { status: "failed", statusLabel: "Branches failed", outcome: "failed", badge: "failure" }
  if (failed > 0)
    return {
      status: "completed",
      statusLabel: `Merged with ${failed} failed`,
      outcome: "failed",
      badge: "warning",
    }
  if (partial > 0)
    return {
      status: "completed",
      statusLabel: `Merged with ${partial} partial`,
      outcome: "partial",
      badge: "warning",
    }
  if (review > 0)
    // The merge itself joins the attention pool: work is assembled, but a
    // human still owes it a decision, and "done" would hide that.
    return {
      status: "needs_review",
      statusLabel: "Merged - review required",
      outcome: "review_required",
    }
  if (unknown > 0)
    return { status: "completed", statusLabel: "Merged - outcomes unverified", outcome: "unknown" }
  if (unverified > 0)
    // Every branch returned cleanly, but at least one was never verified: the
    // merge inherits that qualification instead of laundering it into green.
    return { status: "completed", statusLabel: "Merged - unverified", outcome: "completed_unverified" }
  if (cancelled >= input.total && input.total > 0)
    return {
      status: "cancelled",
      statusLabel: "Branches cancelled",
      outcome: "cancelled",
      badge: OUTCOME_BADGE.cancelled,
    }
  if (cancelled > 0)
    return {
      status: "completed",
      statusLabel: `Merged - ${cancelled} cancelled`,
      outcome: "cancelled",
    }
  return { status: "completed", statusLabel: "Merged", outcome: "verified_success", badge: "success" }
}

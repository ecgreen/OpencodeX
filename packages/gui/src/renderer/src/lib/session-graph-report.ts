import type {
  SessionGraph,
  SessionGraphCounts,
  SessionGraphEdge,
  SessionGraphNode,
} from "./session-graph"

/**
 * What the graph says about itself: counts, the one-line summary, structural
 * identity, and the truncation sentinel. Split from `session-graph.ts` so the
 * traversal there stays readable; nothing here knows how the graph is walked.
 * Runtime imports flow one way - this module only takes types from there.
 */

import { EMPTY_SESSION_GRAPH_COUNTS } from "./session-graph-core"

export { EMPTY_SESSION_GRAPH_COUNTS }

/** Merge and sentinel nodes are presentation, not steps: out of the counts. */
export function countGraphNodes(all: readonly SessionGraphNode[]): SessionGraphCounts {
  const counts = { ...EMPTY_SESSION_GRAPH_COUNTS }
  for (const node of all) {
    if (node.kind === "join" || node.kind === "sentinel") continue
    counts.total += 1
    if (!node.root) counts.delegated += 1
    if (node.status === "running") counts.running += 1
    // A retry is running - the tone group holds it - but its own label is the
    // only place the model records it, so the count reads the label back.
    if (node.statusLabel === "Retrying") counts.retrying += 1
    if (node.status === "queued") counts.queued += 1
    if (node.status === "input_needed") counts.blocked += 1
    if (node.status === "needs_review") counts.needsReview += 1
    if (node.status === "completed") counts.completed += 1
    if (node.status === "returned") counts.returned += 1
    if (node.status === "failed") counts.failed += 1
    if (node.status === "cancelled") counts.cancelled += 1
  }
  return counts
}

/**
 * The one-line account of the workflow, for the footer and the canvas label.
 *
 * Leads with the work that was farmed out rather than a step total that counts
 * the orchestrator as its own step, and reports every nonzero state separately
 * - a cancelled step is not a failed one, and a returned step is neither.
 * Retrying is shown nested inside running, never as a second count.
 */
export function sessionGraphSummary(graph: SessionGraph, options?: { incomplete?: boolean }) {
  if (graph.nodes.length === 0) return "Workflow graph: empty"
  const counts = graph.counts
  const suffix = options?.incomplete ? " - graph may be incomplete" : ""
  if (counts.delegated === 0) return `Workflow graph: no delegated work yet${suffix}`
  const parts = [`${counts.delegated} delegated ${counts.delegated === 1 ? "step" : "steps"}`]
  // Retries nest inside running - a retry *is* running - so no step is ever
  // reported under two states at once.
  if (counts.running > 0)
    parts.push(
      `${counts.running} running${counts.retrying > 0 ? ` (${counts.retrying} retrying)` : ""}`,
    )
  if (counts.blocked > 0) parts.push(`${counts.blocked} needing input`)
  if (counts.queued > 0) parts.push(`${counts.queued} queued`)
  if (counts.needsReview > 0) parts.push(`${counts.needsReview} ready for review`)
  if (counts.completed > 0) parts.push(`${counts.completed} complete`)
  if (counts.returned > 0) parts.push(`${counts.returned} returned`)
  if (counts.failed > 0) parts.push(`${counts.failed} failed`)
  if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`)
  return `Workflow graph: ${parts.join(", ")}${suffix}`
}

/**
 * What makes a graph *this* graph: the workflow it roots plus its shape.
 * Status is deliberately absent - a node turning green must not re-frame the
 * canvas - but node identity, depth, and edge endpoints are all in, because a
 * same-count replacement or a re-inferred stage is a different graph and an
 * untouched viewport should re-frame it.
 */
export function sessionGraphStructure(graph: SessionGraph) {
  // Gate presence changes a node's drawn height (see graphNodeHeight), so a
  // gate appearing on an unchanged node is a geometry change an untouched
  // viewport should re-frame for.
  const nodes = graph.nodes.map((node) => `${node.id}:${node.depth}${node.gate ? ":g" : ""}`).join(",")
  const edges = graph.edges.map((edge) => `${edge.from}>${edge.to}`).join(",")
  return `${graph.rootID}|${nodes}|${edges}`
}

/** Markers stay legible: past this many, the summary carries the count. */
export const GRAPH_UNEXPANDED_MARKER_LIMIT = 4

const UNEXPANDED_ROLE: Record<string, string> = {
  depth_limit: "depth limit reached",
  session_limit: "session limit reached",
  load_error: "failed to load",
}

const UNEXPANDED_DETAIL: Record<string, string> = {
  depth_limit: "This branch was not checked for children - the sweep reached its depth bound.",
  session_limit: "This branch was not checked for children - the sweep reached its session bound.",
  load_error: "This branch's children could not be loaded.",
}

/**
 * The graph's admission of what it does not know: a `Descendants not checked`
 * marker on each branch discovery never queried. Deliberately not "the tree
 * continues" - past a bound the client has no idea whether it does. Markers
 * are not steps: no session, cannot be opened, out of every count.
 */
export function appendUnexpandedMarkers(
  nodes: SessionGraphNode[],
  edges: SessionGraphEdge[],
  unexpanded: readonly { sessionID: string; reason: "depth_limit" | "session_limit" | "load_error" }[],
) {
  const byID = new Map(nodes.map((node) => [node.id, node]))
  let shown = 0
  for (const branch of unexpanded) {
    if (shown >= GRAPH_UNEXPANDED_MARKER_LIMIT) return
    const parent = byID.get(`session:${branch.sessionID}`)
    if (!parent) continue
    shown += 1
    const node: SessionGraphNode = {
      id: `sentinel:${branch.sessionID}`,
      kind: "sentinel",
      depth: parent.depth + 1,
      title: "Descendants not checked",
      role: UNEXPANDED_ROLE[branch.reason],
      status: "idle",
      statusLabel: "Not checked",
      detail: UNEXPANDED_DETAIL[branch.reason],
      updatedAt: 0,
      root: false,
    }
    nodes.push(node)
    edges.push({
      id: `${parent.id}->${node.id}`,
      from: parent.id,
      to: node.id,
      label: "not checked",
      detail: node.detail!,
      status: "idle",
      provenance: "synthetic_return",
    })
  }
}

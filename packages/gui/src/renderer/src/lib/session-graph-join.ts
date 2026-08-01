import type { SessionGraphEdge, SessionGraphNode, SessionGraphStatus } from "./session-graph"

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

const JOIN_STATUS_LABEL: Partial<Record<SessionGraphStatus, string>> = {
  queued: "Waiting on branches",
  running: "Merging",
  completed: "Merged",
}

const TERMINAL: ReadonlySet<SessionGraphStatus> = new Set(["completed", "failed", "cancelled"])

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
  const failed = input.branches.filter(
    (branch) => branch.via.status === "failed" || branch.via.status === "cancelled",
  )
  const status: SessionGraphStatus =
    settled.length < input.branches.length
      ? "queued"
      : input.busyType === "busy" || input.busyType === "retry"
        ? "running"
        : "completed"
  const node: SessionGraphNode = {
    id: input.final ? `join:${input.parent.id}` : `join:${input.parent.id}:${input.index}`,
    kind: "join",
    sessionID: input.parent.sessionID,
    depth: input.depth,
    title: "Merge results",
    role: input.final ? `into ${input.parent.title}` : `stage ${input.index + 1} of ${input.parent.title}`,
    status,
    statusLabel: JOIN_STATUS_LABEL[status] ?? status,
    badge: status === "completed" ? "success" : undefined,
    progress: { completed: settled.length - failed.length, failed: failed.length, total: input.branches.length },
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
    })),
  }
}

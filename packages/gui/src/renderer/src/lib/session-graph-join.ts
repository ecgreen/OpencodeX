import type { SessionGraphEdge, SessionGraphNode, SessionGraphStatus } from "./session-graph"

/**
 * Fan-in for the workflow graph.
 *
 * Delegation gives the graph its fork shape; this adds the join: every node
 * that delegated gets a merge node collecting its branches, because that is
 * what actually happens - each specialist's report returns to the session
 * that spawned it, which synthesizes them. Nested delegations chain: a
 * specialist's own merge node is what feeds its parent's merge node, the same
 * fork/join nesting structured agent graphs use.
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

export function appendSessionGraphJoins(input: {
  nodes: SessionGraphNode[]
  edges: SessionGraphEdge[]
  sessionStatus?: Record<string, { type?: string } | undefined>
}) {
  const children = new Map<string, SessionGraphNode[]>()
  const byID = new Map(input.nodes.map((node) => [node.id, node]))
  for (const edge of input.edges) {
    const child = byID.get(edge.to)
    if (child) children.set(edge.from, [...(children.get(edge.from) ?? []), child])
  }

  const joins = new Map<string, SessionGraphNode>()
  // Deepest parents first, so a child's own merge node exists (with its final
  // depth and status) before the parent's merge node aggregates it.
  const parents = input.nodes.filter((node) => children.has(node.id)).sort((a, b) => b.depth - a.depth)
  for (const parent of parents) {
    // What actually reports back for each branch: the child itself for a leaf,
    // the child's merge node when the child delegated further.
    const branches = children.get(parent.id)!.map((child) => ({
      child,
      via: joins.get(`join:${child.id}`) ?? child,
    }))
    const settled = branches.filter((branch) => TERMINAL.has(branch.via.status))
    const failed = branches.filter((branch) => branch.via.status === "failed" || branch.via.status === "cancelled")
    const busyType = parent.sessionID ? input.sessionStatus?.[parent.sessionID]?.type : undefined
    const status: SessionGraphStatus =
      settled.length < branches.length ? "queued" : busyType === "busy" || busyType === "retry" ? "running" : "completed"
    const join: SessionGraphNode = {
      id: `join:${parent.id}`,
      kind: "join",
      sessionID: parent.sessionID,
      depth: 1 + Math.max(...branches.map((branch) => branch.via.depth)),
      title: "Merge results",
      role: `into ${parent.title}`,
      status,
      statusLabel: JOIN_STATUS_LABEL[status] ?? status,
      badge: status === "completed" ? "success" : undefined,
      progress: { completed: settled.length - failed.length, failed: failed.length, total: branches.length },
      updatedAt: Math.max(...branches.map((branch) => branch.via.updatedAt)),
      root: false,
    }
    joins.set(join.id, join)
    input.nodes.push(join)
    for (const branch of branches) {
      input.edges.push({
        id: `${branch.via.id}->${join.id}`,
        from: branch.via.id,
        to: join.id,
        label: "results",
        detail: `${branch.child.title} reports back into ${parent.title}.`,
        status: branch.via.status,
      })
    }
  }
}

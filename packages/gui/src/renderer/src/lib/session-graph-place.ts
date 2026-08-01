import type { OpencodeXJob, Session } from "@opencode-ai/sdk/v2/client"
import type { WorkItem } from "@opencode-ai/sdk/v2/work-item"
import type { SessionGraphEdge, SessionGraphNode } from "./session-graph"
import { buildStageMerge, stageMergeNeeded, type SessionGraphBranch } from "./session-graph-join"
import { sessionGraphEdge, sessionGraphNode, type SwarmRoleIndex } from "./session-graph-nodes"
import { groupSessionStages } from "./session-graph-stages"

/**
 * Laying a delegation tree out as the pipeline it actually ran as.
 *
 * Placement is a walk rather than a breadth-first sweep because a step's column
 * depends on what came before it, not on how many hops it sits from the root: a
 * session's children are grouped into stages (see `session-graph-stages`), and
 * each stage starts one column past whatever the previous stage ended in - its
 * merge, or its single step. Nested delegation composes for free, since a
 * child's own subtree is placed the same way before its stage closes.
 */

export type PlacementContext = {
  nodes: SessionGraphNode[]
  edges: SessionGraphEdge[]
  placed: Set<string>
  depths: Map<string, number>
  childSessions: ReadonlyMap<string, Session[]>
  jobsBySession: ReadonlyMap<string, OpencodeXJob[]>
  items: ReadonlyMap<string, WorkItem>
  roles: SwarmRoleIndex
  sessionStatus?: Record<string, { type?: string } | undefined>
  latestJob: (jobs: readonly OpencodeXJob[] | undefined) => OpencodeXJob | undefined
}

/** Where a placed branch ends, which is what the next stage hangs off. */
type Placement = { terminal: SessionGraphNode; depth: number }

export function placeSessionTree(
  context: PlacementContext,
  session: Session,
  depth: number,
  from: string,
): Placement | undefined {
  const id = `session:${session.id}`
  // A parent that is its own ancestor would otherwise recurse forever; the
  // catalog has no cycles, but it is assembled from two sources.
  if (context.placed.has(id)) return undefined
  context.placed.add(id)
  context.depths.set(id, depth)

  const job = context.latestJob(context.jobsBySession.get(session.id))
  const node = sessionGraphNode({
    session,
    item: context.items.get(id),
    job,
    depth,
    root: depth === 0 && !from,
    busyType: context.sessionStatus?.[session.id]?.type,
  })
  context.nodes.push(node)
  if (from) context.edges.push(sessionGraphEdge({ from, node, session, job, roles: context.roles }))

  const children = context.childSessions.get(session.id) ?? []
  if (children.length === 0) return { terminal: node, depth }

  const stages = groupSessionStages(children)
  let anchor = node
  let anchorDepth = depth
  stages.forEach((stage, index) => {
    const branches = stage.flatMap((child): SessionGraphBranch[] => {
      const placement = placeSessionTree(context, child, anchorDepth + 1, anchor.id)
      if (!placement) return []
      const own = context.nodes.find((item) => item.id === `session:${child.id}`)
      return own ? [{ child: own, via: placement.terminal }] : []
    })
    if (branches.length === 0) return
    const final = index === stages.length - 1
    const reach = Math.max(...branches.map((branch) => context.depths.get(branch.via.id) ?? anchorDepth + 1))
    if (!stageMergeNeeded({ branches, final })) {
      anchor = branches[0]!.via
      anchorDepth = reach
      return
    }
    const merge = buildStageMerge({
      parent: node,
      branches,
      index,
      final,
      depth: reach + 1,
      busyType: node.sessionID ? context.sessionStatus?.[node.sessionID]?.type : undefined,
    })
    context.nodes.push(merge.node)
    context.edges.push(...merge.edges)
    context.depths.set(merge.node.id, merge.node.depth)
    anchor = merge.node
    anchorDepth = merge.node.depth
  })
  return { terminal: anchor, depth: anchorDepth }
}

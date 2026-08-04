import type { OpencodeXGoal, OpencodeXJob, OpencodeXSwarm, Session } from "@opencode-ai/sdk/v2/client"
import type { WorkItem } from "@opencode-ai/sdk/v2/work-item"
import {
  enrichWithGoalNode,
  goalNodesBySession,
  plannedGoalNodes,
  type SessionGraphGate,
} from "./session-graph-goal"
import {
  jobGraphEdge,
  jobGraphNode,
  type SwarmRole,
  type SwarmRoleIndex,
} from "./session-graph-nodes"
import { placeSessionTree } from "./session-graph-place"
import {
  EMPTY_SESSION_GRAPH_COUNTS,
  appendUnexpandedMarkers,
  countGraphNodes,
} from "./session-graph-report"

// The reporting layer lives beside this module; re-exported so consumers keep
// one import path for the graph model.
export { sessionGraphSummary, sessionGraphStructure } from "./session-graph-report"

/**
 * The agentic workflow a session is driving, as a graph.
 *
 * Edges come from `Session.parentID` and `OpencodeXJob.parentJobID`, which ride
 * on session *cards* and so are always present. Swarm roles only arrive once a
 * full session snapshot lands, so they enrich labels rather than form them -
 * the graph must draw correctly before any of that hydrates.
 */

export type SessionGraphStatus =
  | "idle"
  | "queued"
  | "running"
  | "input_needed"
  | "needs_review"
  | "completed"
  /**
   * Terminal, but with no recorded outcome: the delegation stopped working and
   * nothing durable says how it ended. Deliberately not `completed` - a child
   * that errored without a job record must never wear a success badge.
   */
  | "returned"
  | "failed"
  | "cancelled"

/** How an edge is known: recorded fact, plan, inference, or presentation. */
export type SessionGraphEdgeProvenance =
  | "observed_spawn"
  | "declared_dependency"
  | "inferred_sequence"
  | "synthetic_return"
  | "planned"

/**
 * What a finished step produced, independent of whether it is still running
 * (status) and of how the card is decorated (badge). Merges aggregate this
 * dimension worst-first, which is what stops a review-required or partial
 * branch being laundered into a green check at any nesting depth.
 */
export type SessionGraphOutcome =
  | "verified_success"
  /**
   * The step returned cleanly and the harness durably recorded that - but
   * nothing verified the work. Execution settlement, not judged success:
   * deliberately distinct from `verified_success`, and never badged green.
   */
  | "completed_unverified"
  | "partial"
  | "review_required"
  | "unknown"
  | "failed"
  | "cancelled"

export type SessionGraphNode = {
  id: string
  /** `sentinel` marks where discovery stopped, not a step that exists. */
  kind: "session" | "job" | "join" | "sentinel"
  sessionID?: string
  jobID?: string
  /** Layer index: how many spawn hops from the root. */
  depth: number
  title: string
  /** Role or source chip under the title. */
  role?: string
  status: SessionGraphStatus
  statusLabel: string
  /** What the step produced, once terminal. Absent while it is still working. */
  outcome?: SessionGraphOutcome
  /**
   * Corner badge - pure presentation, derived from `outcome`. Absent while the
   * node has not reached a terminal state, and absent for a terminal state
   * whose outcome is unverified or review-required; `warning` marks a
   * qualified success, `cancelled` a deliberate stop that is not a failure.
   */
  badge?: "success" | "warning" | "failure" | "cancelled"
  /** Failure message or blocker, shown on hover. */
  detail?: string
  /**
   * What the step is about, in one breath: the recorded report opening for a
   * finished delegation, or the objective it was spawned with while it runs.
   */
  summary?: string
  progress?: { completed: number; failed: number; total: number }
  /** Present only while a declared step is parked on a human's approval. */
  gate?: SessionGraphGate
  startedAt?: number
  updatedAt: number
  root: boolean
}

export type SessionGraphEdge = {
  id: string
  from: string
  to: string
  /** Short "what this step resolves", drawn beside the edge. */
  label: string
  /** The long form, shown on hover or focus. */
  detail: string
  /** Mirrors the target node, so a failed branch reads as failed end to end. */
  status: SessionGraphStatus
  /**
   * Where this edge's claim comes from. Observed and declared edges draw solid;
   * inferred sequencing draws dashed and says so, because "started after the
   * previous stage returned" is a reading of timestamps, not a recorded fact.
   */
  provenance: SessionGraphEdgeProvenance
}

export type SessionGraphCounts = {
  /** Workflow steps including the orchestrator; merge nodes never count. */
  total: number
  /** Steps excluding the orchestrator - the work this session farmed out. */
  delegated: number
  running: number
  retrying: number
  queued: number
  /** Steps parked on a human: permissions, questions, approval gates. */
  blocked: number
  needsReview: number
  completed: number
  /** Terminal with no recorded outcome - see the `returned` status. */
  returned: number
  failed: number
  cancelled: number
}

export type SessionGraph = {
  rootID: string
  rootSessionID: string
  nodes: SessionGraphNode[]
  edges: SessionGraphEdge[]
  counts: SessionGraphCounts
}

export type SessionGraphInput = {
  sessionID: string
  workItems: readonly WorkItem[]
  sessions: readonly Session[]
  jobs: readonly OpencodeXJob[]
  swarms: readonly OpencodeXSwarm[]
  /**
   * Live per-session status. Work items only exist for catalog sessions, and
   * swarm-delegated children are not in the catalog - but status events are
   * applied by id regardless, so this is how a fetched child reads as running.
   */
  sessionStatus?: Record<string, { type?: string } | undefined>
  /**
   * The plan this session declared, when it declared one. Execution still draws
   * the shape; this only supplies what running cannot show - the steps that
   * have not run, and the approval a gate is parked on.
   */
  goal?: OpencodeXGoal
  /**
   * Branches whose descendants discovery never checked - a depth or session
   * bound, or a failed request. Each one gets an explicit marker on the
   * branch it belongs to instead of the graph silently looking complete.
   */
  unexpanded?: readonly { sessionID: string; reason: "depth_limit" | "session_limit" | "load_error" }[]
}

export const EMPTY_SESSION_GRAPH: SessionGraph = {
  rootID: "",
  rootSessionID: "",
  nodes: [],
  edges: [],
  counts: EMPTY_SESSION_GRAPH_COUNTS,
}

/**
 * The topmost session of the workflow the given session belongs to.
 *
 * Opening the graph from a child shows the same graph as opening it from the
 * orchestrator, which is what makes "back to the top session" mean one thing.
 */
export function graphRootSessionID(sessions: readonly Session[], sessionID: string) {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const seen = new Set<string>()
  let current = byID.get(sessionID)
  if (!current) return sessionID
  while (current.parentID && !seen.has(current.id)) {
    seen.add(current.id)
    const parent = byID.get(current.parentID)
    if (!parent) break
    current = parent
  }
  return current.id
}

export function buildSessionGraph(input: SessionGraphInput): SessionGraph {
  if (!input.sessionID) return EMPTY_SESSION_GRAPH
  const rootSessionID = graphRootSessionID(input.sessions, input.sessionID)
  const sessionsByID = new Map(input.sessions.map((session) => [session.id, session]))
  const rootSession = sessionsByID.get(rootSessionID)
  if (!rootSession) return EMPTY_SESSION_GRAPH
  const items = new Map(input.workItems.map((item) => [item.id, item]))
  const childSessions = groupChildSessions(input.sessions)
  const jobsBySession = groupJobsBySession(input.jobs)
  const roles = swarmRoles(input.swarms)

  const nodes: SessionGraphNode[] = []
  const edges: SessionGraphEdge[] = []
  const placed = new Set<string>()
  const depths = new Map<string, number>()
  placeSessionTree(
    { nodes, edges, placed, depths, childSessions, jobsBySession, items, roles, sessionStatus: input.sessionStatus, latestJob },
    rootSession,
    0,
    "",
  )

  placeJobs({ input, roles, items, placed, depths, nodes, edges, rootSessionID, sessionsByID })
  applyGoal({ goal: input.goal, nodes, edges, depths })
  if (input.unexpanded?.length) appendUnexpandedMarkers(nodes, edges, input.unexpanded)
  return { rootID: `session:${rootSessionID}`, rootSessionID, nodes, edges, counts: countGraphNodes(nodes) }
}

/**
 * Folds a declared plan into the drawn pipeline: labels the steps that ran from
 * what the plan meant them to be, then adds the ones that have not run at all.
 * The pipeline's own shape is never rewritten - execution stays the witness.
 */
function applyGoal(context: {
  goal?: OpencodeXGoal
  nodes: SessionGraphNode[]
  edges: SessionGraphEdge[]
  depths: ReadonlyMap<string, number>
}) {
  const goal = context.goal
  if (!goal || goal.nodes.length === 0) return
  const bySession = goalNodesBySession(goal)
  const placed = new Map<string, { id: string; depth: number }>()
  context.nodes.forEach((node, index) => {
    const goalNode = node.sessionID ? bySession.get(node.sessionID) : undefined
    if (!goalNode) return
    context.nodes[index] = enrichWithGoalNode(node, goalNode, goal.id)
    placed.set(goalNode.id, { id: node.id, depth: node.depth })
  })
  // Steps hang off wherever the drawn pipeline ends, which is its deepest node
  // - the final merge when there is one, else the last step to have run.
  const tail = context.nodes.reduce(
    (deepest, node) => (node.depth > deepest.depth ? node : deepest),
    context.nodes[0],
  )
  if (!tail) return
  const planned = plannedGoalNodes({ goal, placed, tail, tailDepth: tail.depth })
  context.nodes.push(...planned.nodes)
  context.edges.push(...planned.edges)
}

/** Whether this session is driving a workflow worth drawing. */
export function sessionGraphAvailable(graph: SessionGraph) {
  return graph.counts.total > 1
}

export function sessionGraphNodeAt(graph: SessionGraph, id: string) {
  return graph.nodes.find((node) => node.id === id)
}

/**
 * A job only earns its own node while it has no session to be represented by:
 * a claimed job's work is the child session the graph already draws. Placement
 * repeats to a fixpoint because a job may be listed before its parent job.
 */
function placeJobs(context: {
  input: SessionGraphInput
  roles: SwarmRoleIndex
  items: ReadonlyMap<string, WorkItem>
  placed: Set<string>
  depths: Map<string, number>
  nodes: SessionGraphNode[]
  edges: SessionGraphEdge[]
  rootSessionID: string
  sessionsByID: ReadonlyMap<string, Session>
}) {
  let pending = context.input.jobs
    .filter((job) => !(job.sessionID && context.placed.has(`session:${job.sessionID}`)))
    .toSorted((left, right) => jobTime(left.timeCreated) - jobTime(right.timeCreated) || left.id.localeCompare(right.id))
  for (let placedSome = true; pending.length > 0 && placedSome; ) {
    placedSome = false
    const remaining: OpencodeXJob[] = []
    for (const job of pending) {
      const parentID = jobParentID(job, context.placed, context.rootSessionID, context.sessionsByID)
      const id = `job:${job.id}`
      if (!parentID) {
        remaining.push(job)
        continue
      }
      if (context.placed.has(id)) continue
      context.placed.add(id)
      const depth = (context.depths.get(parentID) ?? 0) + 1
      context.depths.set(id, depth)
      const node = jobGraphNode({ job, item: context.items.get(id), depth, roles: context.roles })
      context.nodes.push(node)
      context.edges.push(jobGraphEdge(parentID, node, job))
      placedSome = true
    }
    pending = remaining
  }
}

/**
 * Where a session-less job hangs: under the job that spawned it, else the
 * session that owns it, else the root when it belongs to this workflow's swarm.
 */
function jobParentID(
  job: OpencodeXJob,
  placed: ReadonlySet<string>,
  rootSessionID: string,
  sessions: ReadonlyMap<string, Session>,
) {
  if (job.parentJobID && placed.has(`job:${job.parentJobID}`)) return `job:${job.parentJobID}`
  if (job.sessionID && placed.has(`session:${job.sessionID}`)) return `session:${job.sessionID}`
  const root = sessions.get(rootSessionID)
  const rootSwarmID = root?.model?.providerID === "swarm" ? root.model.id : undefined
  if (job.swarmID && job.swarmID === rootSwarmID) return `session:${rootSessionID}`
  return undefined
}

/** Filtered before sorting: the catalog holds every session, few of them children. */
function groupChildSessions(sessions: readonly Session[]) {
  const children = new Map<string, Session[]>()
  for (const session of sessions.filter((item) => item.parentID).toSorted(orderSessions)) {
    children.set(session.parentID!, [...(children.get(session.parentID!) ?? []), session])
  }
  return children
}

/** Stable sibling order, so the layout does not reshuffle between renders. */
function orderSessions(left: Session, right: Session) {
  return left.time.created - right.time.created || left.id.localeCompare(right.id)
}

function groupJobsBySession(jobs: readonly OpencodeXJob[]) {
  const grouped = new Map<string, OpencodeXJob[]>()
  for (const job of jobs) {
    if (!job.sessionID) continue
    grouped.set(job.sessionID, [...(grouped.get(job.sessionID) ?? []), job])
  }
  return grouped
}

function latestJob(jobs: readonly OpencodeXJob[] | undefined) {
  if (!jobs?.length) return undefined
  return jobs.toSorted((left, right) => jobTime(right.timeUpdated) - jobTime(left.timeUpdated))[0]
}

function swarmRoles(swarms: readonly OpencodeXSwarm[]): SwarmRoleIndex {
  return new Map(swarms.flatMap((swarm) => swarm.roles.map((role): [string, SwarmRole] => [role.id, role])))
}

/** Job timestamps are `number | string` on the wire; mirrors work-item.ts. */
function jobTime(value: number | string | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

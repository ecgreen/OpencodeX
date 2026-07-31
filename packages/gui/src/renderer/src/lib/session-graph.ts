import type { OpencodeXJob, OpencodeXSwarm, Session } from "@opencode-ai/sdk/v2/client"
import type { WorkItem } from "@opencode-ai/sdk/v2/work-item"
import {
  jobGraphEdge,
  jobGraphNode,
  sessionGraphEdge,
  sessionGraphNode,
  type SwarmRole,
  type SwarmRoleIndex,
} from "./session-graph-nodes"

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
  | "completed"
  | "failed"
  | "cancelled"

export type SessionGraphNode = {
  id: string
  kind: "session" | "job"
  sessionID?: string
  jobID?: string
  /** Layer index: how many spawn hops from the root. */
  depth: number
  title: string
  /** Role or source chip under the title. */
  role?: string
  status: SessionGraphStatus
  statusLabel: string
  /** Corner badge. Absent while the node has not reached a terminal state. */
  badge?: "success" | "failure"
  /** Failure message or blocker, shown on hover. */
  detail?: string
  progress?: { completed: number; failed: number; total: number }
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
}

export type SessionGraph = {
  rootID: string
  rootSessionID: string
  nodes: SessionGraphNode[]
  edges: SessionGraphEdge[]
  counts: { total: number; running: number; completed: number; failed: number; blocked: number }
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
}

export const EMPTY_SESSION_GRAPH: SessionGraph = {
  rootID: "",
  rootSessionID: "",
  nodes: [],
  edges: [],
  counts: { total: 0, running: 0, completed: 0, failed: 0, blocked: 0 },
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
  let frontier = [{ session: rootSession, depth: 0, parentID: "" }]
  while (frontier.length > 0) {
    const next: typeof frontier = []
    for (const entry of frontier) {
      const id = `session:${entry.session.id}`
      if (placed.has(id)) continue
      placed.add(id)
      depths.set(id, entry.depth)
      const job = latestJob(jobsBySession.get(entry.session.id))
      const item = items.get(id)
      const node = sessionGraphNode({
        session: entry.session,
        item,
        job,
        depth: entry.depth,
        root: entry.depth === 0,
        busyType: input.sessionStatus?.[entry.session.id]?.type,
      })
      nodes.push(node)
      if (entry.parentID)
        edges.push(sessionGraphEdge({ from: entry.parentID, node, session: entry.session, job, roles }))
      for (const child of childSessions.get(entry.session.id) ?? [])
        next.push({ session: child, depth: entry.depth + 1, parentID: id })
    }
    frontier = next
  }

  placeJobs({ input, roles, items, placed, depths, nodes, edges, rootSessionID, sessionsByID })
  return { rootID: `session:${rootSessionID}`, rootSessionID, nodes, edges, counts: countNodes(nodes) }
}

/** Whether this session is driving a workflow worth drawing. */
export function sessionGraphAvailable(graph: SessionGraph) {
  return graph.nodes.length > 1
}

export function sessionGraphSummary(graph: SessionGraph) {
  if (graph.nodes.length === 0) return "Workflow graph: empty"
  const parts = [`${graph.counts.total} ${graph.counts.total === 1 ? "step" : "steps"}`]
  if (graph.counts.running > 0) parts.push(`${graph.counts.running} running`)
  if (graph.counts.blocked > 0) parts.push(`${graph.counts.blocked} needing input`)
  if (graph.counts.completed > 0) parts.push(`${graph.counts.completed} complete`)
  if (graph.counts.failed > 0) parts.push(`${graph.counts.failed} failed`)
  return `Workflow graph: ${parts.join(", ")}`
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

function countNodes(nodes: readonly SessionGraphNode[]) {
  return nodes.reduce(
    (counts, node) => ({
      total: counts.total + 1,
      running: counts.running + (node.status === "running" ? 1 : 0),
      completed: counts.completed + (node.status === "completed" ? 1 : 0),
      failed: counts.failed + (node.status === "failed" || node.status === "cancelled" ? 1 : 0),
      blocked: counts.blocked + (node.status === "input_needed" ? 1 : 0),
    }),
    { total: 0, running: 0, completed: 0, failed: 0, blocked: 0 },
  )
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

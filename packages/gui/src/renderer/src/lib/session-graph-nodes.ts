import type { OpencodeXJob, OpencodeXSwarm, Session } from "@opencode-ai/sdk/v2/client"
import type { WorkItem, WorkItemState } from "@opencode-ai/sdk/v2/work-item"
import type { SessionGraphEdge, SessionGraphNode, SessionGraphStatus } from "./session-graph"
import { sessionSwarmRole } from "./swarm-team"

/**
 * Turning one session or job into the card and connector the canvas draws.
 *
 * Split from `session-graph.ts` so the traversal there stays readable: this
 * file is entirely "how a step presents itself", with no knowledge of how the
 * graph is walked.
 */

export type SwarmRole = OpencodeXSwarm["roles"][number]
export type SwarmRoleIndex = ReadonlyMap<string, SwarmRole>

/** Live states win over any recorded outcome: the step is doing something now. */
const LIVE_STATUS: Partial<Record<WorkItemState, SessionGraphStatus>> = {
  waiting_input: "input_needed",
  waiting_permission: "input_needed",
  preparing: "running",
  running: "running",
  retrying: "running",
  cancelling: "running",
  queued: "queued",
}

const TERMINAL_STATUS: Partial<Record<WorkItemState, SessionGraphStatus>> = {
  completed: "completed",
  needs_review: "completed",
  partially_completed: "completed",
  recovered: "completed",
  failed: "failed",
  interrupted: "failed",
  cancelled: "cancelled",
}

const JOB_STATUS: Record<OpencodeXJob["status"], SessionGraphStatus> = {
  queued: "queued",
  claimed: "running",
  running: "running",
  succeeded: "completed",
  failed: "failed",
  interrupted: "failed",
  cancelled: "cancelled",
}

const STATUS_LABEL: Record<SessionGraphStatus, string> = {
  idle: "Idle",
  queued: "Queued",
  running: "Running",
  input_needed: "Needs input",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
}

const BADGE: Partial<Record<SessionGraphStatus, "success" | "failure">> = {
  completed: "success",
  failed: "failure",
  cancelled: "failure",
}

export function sessionGraphNode(input: {
  session: Session
  item: WorkItem | undefined
  job: OpencodeXJob | undefined
  depth: number
  root: boolean
  /** The session's live status event type ("busy" | "retry" | ...), if any. */
  busyType?: string
}): SessionGraphNode {
  const status = resolveStatus(input.item?.state, input.job, input.busyType, !input.root)
  return {
    id: `session:${input.session.id}`,
    kind: "session",
    sessionID: input.session.id,
    depth: input.depth,
    title: cleanTitle(input.session.title) || "Untitled session",
    role: input.root ? "Top session" : sessionSwarmRole(input.session) ?? input.item?.agent,
    status,
    statusLabel: STATUS_LABEL[status],
    badge: BADGE[status],
    detail: input.item?.blocker ?? input.job?.failure?.message ?? input.job?.statusReason,
    progress: input.item?.progress,
    startedAt: input.item?.startedAt ?? input.session.time.created,
    updatedAt: input.session.time.updated,
    root: input.root,
  }
}

export function jobGraphNode(input: {
  job: OpencodeXJob
  item: WorkItem | undefined
  depth: number
  roles: SwarmRoleIndex
}): SessionGraphNode {
  const status = resolveStatus(input.item?.state, input.job)
  return {
    id: `job:${input.job.id}`,
    kind: "job",
    jobID: input.job.id,
    sessionID: input.job.sessionID,
    depth: input.depth,
    title:
      cleanTitle(input.job.title ?? "") || input.roles.get(input.job.roleID ?? "")?.name || input.job.kind,
    role: input.job.source === "manual" ? undefined : input.job.source,
    status,
    statusLabel: STATUS_LABEL[status],
    badge: BADGE[status],
    detail: input.job.failure?.message ?? input.job.statusReason,
    progress: input.item?.progress,
    startedAt: input.item?.startedAt,
    updatedAt: input.item?.updatedAt ?? 0,
    root: false,
  }
}

/**
 * What the child was spawned to resolve, best source first: the swarm role's
 * own instructions, then the role name, then the child's own title. The role
 * only exists once metadata has hydrated, so the fallbacks are the normal path
 * rather than an error case.
 */
export function sessionGraphEdge(input: {
  from: string
  node: SessionGraphNode
  session: Session
  job: OpencodeXJob | undefined
  roles: SwarmRoleIndex
}): SessionGraphEdge {
  const tagged = sessionSwarmRole(input.session)
  const role = input.roles.get(input.job?.roleID ?? "") ?? roleByName(input.roles, tagged)
  const label = role?.name ?? tagged ?? input.node.title
  // Before a role hydrates the only thing known about the delegation is the
  // child's own title, which is often what the label already says. Repeating it
  // as "detail" would pad the tooltip with nothing, so it is left empty and the
  // canvas drops the line.
  const title = cleanTitle(input.session.title)
  return {
    id: `${input.from}->${input.node.id}`,
    from: input.from,
    to: input.node.id,
    label,
    detail: role?.instructions?.trim() || (title === label ? "" : title),
    status: input.node.status,
  }
}

export function jobGraphEdge(from: string, node: SessionGraphNode, job: OpencodeXJob): SessionGraphEdge {
  const attempts = job.maxAttempts > 1 ? ` (attempt ${job.attempt} of ${job.maxAttempts})` : ""
  return {
    id: `${from}->${node.id}`,
    from,
    to: node.id,
    label: node.title,
    detail: `${job.source} job: ${node.title}${attempts}${job.failure?.message ? ` - ${job.failure.message}` : ""}`,
    status: node.status,
  }
}

function resolveStatus(
  state: WorkItemState | undefined,
  job: OpencodeXJob | undefined,
  busyType?: string,
  delegated = false,
): SessionGraphStatus {
  const live = state ? LIVE_STATUS[state] : undefined
  if (live) return live
  // A busy status event outranks any recorded outcome: the session is doing
  // something right now, even if a previous run of it already succeeded.
  if (busyType === "busy" || busyType === "retry") return "running"
  const terminal = state ? TERMINAL_STATUS[state] : undefined
  if (terminal) return terminal
  // A finished delegation leaves its session `idle`; the job it ran under is
  // the only record that it succeeded, so it decides the badge.
  if (job) return JOB_STATUS[job.status]
  // Swarm-delegated children have neither a work item nor a job - the catalog
  // hides them, so nothing tracks them but their own session status, and that
  // is cleared the moment they stop working. A delegated session only exists
  // because a parent created *and* immediately prompted it, so "not running"
  // means the delegation has returned. Reading that as `idle` was wrong twice
  // over: the card claimed nothing had happened, and `idle` is not terminal, so
  // the parent's merge node sat on "Waiting on branches" forever.
  //
  // The limitation is honest and worth stating: without a work item there is no
  // record of *how* it ended, so a subagent that errored still reads completed.
  // The transcript behind the node is where the failure is visible.
  return delegated ? "completed" : "idle"
}

function roleByName(roles: SwarmRoleIndex, name: string | undefined) {
  if (!name) return undefined
  const normalized = normalizeRole(name)
  for (const role of roles.values()) if (normalizeRole(role.name) === normalized) return role
  return undefined
}

/** Mirrors the server's lenient role matching (SwarmBriefing.matchSwarmRole). */
function normalizeRole(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "")
}

/** Strips the bookkeeping suffixes server-created child titles carry. */
function cleanTitle(title: string) {
  return title.replace(/\s*\((swarm role|@[\w-]+ subagent)\)\s*$/i, "").trim() || title
}

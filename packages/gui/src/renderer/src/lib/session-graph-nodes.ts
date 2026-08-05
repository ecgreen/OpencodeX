import type { OpencodeXJob, OpencodeXSwarm, Session } from "@opencode-ai/sdk/v2/client"
import type { WorkItem, WorkItemState } from "@opencode-ai/sdk/v2/work-item"
import { GRAPH_SPAWN_GRACE_MS } from "./session-graph-core"
import type {
  SessionGraphEdge,
  SessionGraphEdgeProvenance,
  SessionGraphNode,
  SessionGraphOutcome,
  SessionGraphStatus,
} from "./session-graph"
import { statusLabel as sharedStatusLabel } from "./status-system"
import {
  sessionDelegationRecord,
  type DelegationRecordOutcome,
  type DelegationRecordView,
} from "./delegation-record"
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
  needs_review: "needs_review",
  partially_completed: "completed",
  recovered: "completed",
  failed: "failed",
  interrupted: "failed",
  cancelled: "cancelled",
}

/**
 * Work-item states whose own name says more than their tone group: `retrying`
 * is running, but a card that says "Running" while the step is on attempt three
 * hides exactly what a supervisor needs. Labels come from the shared status
 * vocabulary so the graph never maintains a second user-facing map.
 */
const SPECIFIC_LABEL_STATES: ReadonlySet<WorkItemState> = new Set([
  "retrying",
  "cancelling",
  "needs_review",
  "partially_completed",
  "recovered",
  "interrupted",
])

const JOB_STATUS: Record<OpencodeXJob["status"], SessionGraphStatus> = {
  queued: "queued",
  claimed: "running",
  running: "running",
  succeeded: "completed",
  failed: "failed",
  interrupted: "failed",
  cancelled: "cancelled",
}

/** What each work-item terminal state actually produced. */
const STATE_OUTCOME: Partial<Record<WorkItemState, SessionGraphOutcome>> = {
  completed: "verified_success",
  needs_review: "review_required",
  partially_completed: "partial",
  recovered: "verified_success",
  failed: "failed",
  interrupted: "failed",
  cancelled: "cancelled",
}

const JOB_OUTCOME: Partial<Record<OpencodeXJob["status"], SessionGraphOutcome>> = {
  succeeded: "verified_success",
  failed: "failed",
  interrupted: "failed",
  cancelled: "cancelled",
}

/**
 * Badges are derived from outcome, never computed independently: outcome is
 * the business fact, the badge is its decoration. Review-required, unknown,
 * and unverified-completion outcomes deliberately carry no badge - absence is
 * the honest mark, and a delegation nothing verified must not wear a check.
 */
export const OUTCOME_BADGE: Partial<
  Record<SessionGraphOutcome, "success" | "warning" | "failure" | "cancelled">
> = {
  verified_success: "success",
  partial: "warning",
  failed: "failure",
  // A deliberate stop is not a failure; the shared status contract keeps
  // cancellation neutral and the graph now agrees at the leaf.
  cancelled: "cancelled",
}

/**
 * How long a just-created delegation may sit signal-less before its silence
 * reads as "returned". A child is created and prompted in the same beat, but
 * its first busy event rides the next push - without this grace the card
 * flashes a terminal state during that gap.
 *
 * Defined in session-graph-core so the eager controller can read it without
 * pulling this module in; re-exported here, where callers expect it.
 */
export { GRAPH_SPAWN_GRACE_MS }

export const RETURNED_DETAIL = "Outcome not recorded - open the step to verify"

type StatusPresentation = {
  status: SessionGraphStatus
  statusLabel: string
  outcome?: SessionGraphOutcome
  badge?: "success" | "warning" | "failure" | "cancelled"
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
  const recorded = sessionDelegationRecord(input.session)
  const presentation = resolveStatus({
    state: input.item?.state,
    job: input.job,
    busyType: input.busyType,
    delegated: !input.root,
    createdAt: input.session.time.created,
    recorded,
  })
  const detail = summarizeGraphDetail(
    input.item?.blocker ?? input.job?.failure?.message ?? input.job?.statusReason,
  )
  // What the step is about, without opening it: a finished delegation shows
  // the opening of the report it stamped back; a live one shows what it was
  // spawned to do.
  const summary = summarizeGraphDetail(recorded?.summary ?? input.item?.objective, 220)
  return {
    id: `session:${input.session.id}`,
    kind: "session",
    sessionID: input.session.id,
    depth: input.depth,
    title: cleanTitle(input.session.title) || "Untitled session",
    role: input.root ? "Top session" : sessionSwarmRole(input.session) ?? input.item?.agent,
    ...presentation,
    detail: detail ?? (presentation.status === "returned" ? RETURNED_DETAIL : undefined),
    ...(summary ? { summary } : {}),
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
  const presentation = resolveStatus({ state: input.item?.state, job: input.job, delegated: false })
  return {
    id: `job:${input.job.id}`,
    kind: "job",
    jobID: input.job.id,
    sessionID: input.job.sessionID,
    depth: input.depth,
    title:
      cleanTitle(input.job.title ?? "") || input.roles.get(input.job.roleID ?? "")?.name || input.job.kind,
    role: input.job.source === "manual" ? undefined : input.job.source,
    ...presentation,
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
/** What an inferred edge admits to on hover: a reading, not a record. */
export const INFERRED_EDGE_NOTE = "Inferred: started after the previous stage returned."

export function sessionGraphEdge(input: {
  from: string
  node: SessionGraphNode
  session: Session
  job: OpencodeXJob | undefined
  roles: SwarmRoleIndex
  /**
   * `observed_spawn` when the edge leaves the session that actually spawned the
   * child; `inferred_sequence` when it leaves the previous stage, which is a
   * timestamp reading rather than a recorded dependency.
   */
  provenance: SessionGraphEdgeProvenance
}): SessionGraphEdge {
  const tagged = sessionSwarmRole(input.session)
  const role = input.roles.get(input.job?.roleID ?? "") ?? roleByName(input.roles, tagged)
  const label = role?.name ?? tagged ?? input.node.title
  // Before a role hydrates the only thing known about the delegation is the
  // child's own title, which is often what the label already says. Repeating it
  // as "detail" would pad the tooltip with nothing, so it is left empty and the
  // canvas drops the line.
  const title = cleanTitle(input.session.title)
  const detail = summarizeGraphDetail(role?.instructions || (title === label ? "" : title)) ?? ""
  return {
    id: `${input.from}->${input.node.id}`,
    from: input.from,
    to: input.node.id,
    label,
    detail:
      input.provenance === "inferred_sequence"
        ? `${detail ? `${detail} ` : ""}${INFERRED_EDGE_NOTE}`
        : detail,
    status: input.node.status,
    provenance: input.provenance,
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
    provenance: "observed_spawn",
  }
}

/**
 * How a durable delegation record presents; see lib/delegation-record and
 * packages/opencode session/delegation-outcome. `completed` is execution
 * settlement - the child returned cleanly, nothing verified the work - so it
 * completes the card without the green verified-success treatment. Verified
 * success stays reserved for evidence an actual validator produced (job rows,
 * work-item terminal states).
 */
const RECORDED_PRESENTATION: Record<DelegationRecordOutcome, StatusPresentation> = {
  completed: { status: "completed", statusLabel: "Completed", outcome: "completed_unverified" },
  errored: { status: "failed", statusLabel: "Failed", outcome: "failed", badge: OUTCOME_BADGE.failed },
  cancelled: {
    status: "cancelled",
    statusLabel: "Cancelled",
    outcome: "cancelled",
    badge: OUTCOME_BADGE.cancelled,
  },
  // A run recovered without ever settling: terminal-unknown, never a success.
  abandoned: { status: "returned", statusLabel: "Returned", outcome: "unknown" },
}

function resolveStatus(input: {
  state: WorkItemState | undefined
  job: OpencodeXJob | undefined
  busyType?: string
  delegated: boolean
  createdAt?: number
  /** The parent's durable record of this delegation run, if one is honored. */
  recorded?: DelegationRecordView
}): StatusPresentation {
  const state = input.state
  const live = state ? LIVE_STATUS[state] : undefined
  if (live) return { status: live, statusLabel: labelFor(live, state) }
  // A busy status event outranks any recorded outcome: the session is doing
  // something right now, even if a previous run of it already succeeded.
  if (input.busyType === "busy" || input.busyType === "retry")
    return { status: "running", statusLabel: sharedStatusLabel(input.busyType) }
  const terminal = state ? TERMINAL_STATUS[state] : undefined
  if (terminal) {
    const outcome = state ? STATE_OUTCOME[state] : undefined
    return {
      status: terminal,
      statusLabel: labelFor(terminal, state),
      ...(outcome ? { outcome } : {}),
      badge: outcome ? OUTCOME_BADGE[outcome] : undefined,
    }
  }
  // A finished delegation leaves its session `idle`; the job it ran under is
  // the only record of what it produced, so it decides the outcome.
  if (input.job) {
    const status = JOB_STATUS[input.job.status]
    const outcome = JOB_OUTCOME[input.job.status]
    return {
      status,
      statusLabel: sharedStatusLabel(status),
      ...(outcome ? { outcome } : {}),
      badge: outcome ? OUTCOME_BADGE[outcome] : undefined,
    }
  }
  // The parent stamped how this delegation run ended - the durable record
  // that finally lets a settled child claim an outcome instead of the unknown
  // "returned". Live signals above still outrank it: a re-prompted child is
  // working again, whatever its previous run recorded. A record still
  // `running` with no live evidence is an abandoned run, so it falls through
  // to the unknown fallbacks below rather than claiming anything.
  if (input.recorded?.phase === "settled" && input.recorded.outcome) {
    const presentation = RECORDED_PRESENTATION[input.recorded.outcome]
    // Execution finished but the parent has not durably received the report:
    // a distinct claim, weaker than a plain completion.
    if (input.recorded.outcome === "completed" && input.recorded.delivery === "pending")
      return { ...presentation, statusLabel: "Completed - result pending" }
    if (input.recorded.outcome === "completed" && input.recorded.delivery === "failed")
      return { ...presentation, statusLabel: "Completed - delivery failed" }
    return presentation
  }
  if (!input.delegated) return { status: "idle", statusLabel: sharedStatusLabel("idle") }
  // A child created moments ago has simply not reported in yet.
  if (input.createdAt !== undefined && Date.now() - input.createdAt < GRAPH_SPAWN_GRACE_MS)
    return { status: "queued", statusLabel: sharedStatusLabel("queued") }
  // Swarm-delegated children have neither a work item nor a job - the catalog
  // hides them, so nothing tracks them but their own session status, and that
  // is cleared the moment they stop working. A delegated session only exists
  // because a parent created *and* immediately prompted it, so "not running"
  // means the delegation has returned - which settles the parent's merge node.
  // But nothing recorded *how* it ended, so its outcome is `unknown` with no
  // badge: a subagent that errored on its way out must never wear a check.
  return { status: "returned", statusLabel: sharedStatusLabel("returned"), outcome: "unknown" }
}

/** The state's own label when it says more than the tone group's does. */
function labelFor(status: SessionGraphStatus, state: WorkItemState | undefined) {
  if (state && SPECIFIC_LABEL_STATES.has(state)) return sharedStatusLabel(state)
  return sharedStatusLabel(status)
}

function roleByName(roles: SwarmRoleIndex, name: string | undefined) {
  if (!name) return undefined
  const normalized = normalizeRole(name)
  for (const role of roles.values()) if (normalizeRole(role.name) === normalized) return role
  return undefined
}

/** Roughly one line of tooltip at the canvas's text size. */
const SUMMARY_LIMIT = 140

/**
 * A hover card is a glance, not a document.
 *
 * Role instructions and delegation briefs run to paragraphs, and pasting one
 * into a tooltip produced a wall of text over the canvas that was slower to read
 * than opening the step. This keeps the opening sentence and stops there - the
 * transcript behind the node is the place for the whole thing.
 */
export function summarizeGraphDetail(value: string | undefined, limit = SUMMARY_LIMIT) {
  const text = value?.replace(/\s+/g, " ").trim()
  if (!text) return undefined
  // Prefer a natural stop, but only when one arrives early enough to be a
  // summary rather than the whole text again.
  const stop = text.search(/[.!?](\s|$)/)
  const sentence = stop > 0 && stop + 1 <= limit ? text.slice(0, stop + 1) : text
  if (sentence.length <= limit) return sentence
  const clipped = sentence.slice(0, limit)
  const boundary = clipped.lastIndexOf(" ")
  return `${(boundary > limit / 2 ? clipped.slice(0, boundary) : clipped).trimEnd()}...`
}

/** Mirrors the server's lenient role matching (SwarmBriefing.matchSwarmRole). */
function normalizeRole(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "")
}

/** Strips the bookkeeping suffixes server-created child titles carry. */
function cleanTitle(title: string) {
  return title.replace(/\s*\((swarm role|@[\w-]+ subagent)\)\s*$/i, "").trim() || title
}

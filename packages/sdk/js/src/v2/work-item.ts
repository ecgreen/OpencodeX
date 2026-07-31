import type {
  OpencodeXJob,
  OpencodeXSessionUiState,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
} from "./client.js"
import type { ClientEntityState, ClientStateSyncState } from "./client-sync-types.js"

export type WorkItemState =
  | "idle"
  | "preparing"
  | "queued"
  | "running"
  | "waiting_input"
  | "waiting_permission"
  | "retrying"
  | "cancelling"
  | "recovered"
  | "partially_completed"
  | "needs_review"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"

export type ExecutionTarget =
  | { kind: "direct"; directory?: string }
  | { kind: "worktree"; directory?: string; branch?: string }
  | { kind: "runner"; runnerID: string; workspace?: string }

export type ValidationResult = {
  state: "unknown" | "pending" | "passed" | "failed"
  summary?: string
  checks?: readonly { name: string; state: "pending" | "passed" | "failed"; detail?: string }[]
}

export type OperationProvenance = {
  workItemID: string
  sourceID: string
  sessionID?: string
  jobID?: string
  swarmID?: string
  timelineEventID?: string
}

export type ChangeSet = {
  id: string
  workItemID: string
  files: readonly string[]
  additions?: number
  deletions?: number
  validation: ValidationResult
  provenance: OperationProvenance
}

export type Checkpoint = {
  id: string
  workItemID: string
  label: string
  createdAt: number
  changeSetID?: string
  parentCheckpointID?: string
  restorable: boolean
}

export type RunTimelineEvent = {
  id: string
  workItemID: string
  kind: "prompt" | "decision" | "tool" | "checkpoint" | "validation" | "error" | "recovery" | "intervention"
  message: string
  createdAt: number
  provenance?: OperationProvenance
  metadata?: Readonly<Record<string, unknown>>
}

export type WorkItem = {
  id: string
  kind: "session" | "job"
  sourceID: string
  parentID?: string
  projectID?: string
  sessionID?: string
  jobID?: string
  swarmID?: string
  title: string
  objective?: string
  state: WorkItemState
  statusLabel: string
  agent?: string
  providerID?: string
  modelID?: string
  responsibleUser?: string
  executionTarget: ExecutionTarget
  blocker?: string
  changedFiles: readonly string[]
  validation: ValidationResult
  progress?: { completed: number; failed: number; total: number }
  resourceUse?: { cost?: number; inputTokens?: number; outputTokens?: number; reasoningTokens?: number }
  startedAt?: number
  completedAt?: number
  updatedAt: number
  elapsedMs?: number
}

export type AttentionItem = {
  id: string
  workItemID: string
  kind: "permission" | "input" | "review" | "failure" | "recovery"
  priority: 0 | 1 | 2
  title: string
  detail: string
  state: WorkItemState
  projectID?: string
  sessionID?: string
  swarmID?: string
  updatedAt: number
}

export type WorkItemProjectionInput = Pick<
  ClientStateSyncState,
  "sessions" | "sessionStatus" | "sessionUiState" | "permissions" | "questions" | "jobs"
>

export function clientWorkItems(input: WorkItemProjectionInput, now?: number): WorkItem[] {
  const permissions = groupBySession(input.permissions)
  const questions = groupBySession(input.questions)
  const jobs = input.jobs.ids.flatMap((id) => (input.jobs.records[id] ? [input.jobs.records[id]] : []))
  const jobsBySession = groupJobsBySession(jobs)
  return [
    ...input.sessions.ids.flatMap((id) => {
      const session = input.sessions.records[id]
      return session
        ? [
            sessionWorkItem(
              session,
              input.sessionStatus[id],
              input.sessionUiState[id],
              permissions[id],
              questions[id],
              jobsBySession[id],
              now,
            ),
          ]
        : []
    }),
    ...jobs.map((job) => jobWorkItem(job, now)),
  ].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
}

export function createClientWorkItemSelector() {
  let previous: WorkItemProjectionInput | undefined
  let items: WorkItem[] = []
  return (input: WorkItemProjectionInput) => {
    if (previous && sameWorkItemSources(previous, input)) return items
    previous = input
    items = clientWorkItems(input)
    return items
  }
}

export function clientAttentionItems(items: readonly WorkItem[]): AttentionItem[] {
  const sessionIDs = new Set(
    items.flatMap((item) => (item.kind === "session" && item.sessionID ? [item.sessionID] : [])),
  )
  return items
    .flatMap((item): AttentionItem[] => {
      if (item.kind === "job" && item.sessionID && sessionIDs.has(item.sessionID)) return []
      const attention = attentionForState(item.state)
      if (!attention) return []
      return [
        {
          id: `${attention.kind}:${item.id}`,
          workItemID: item.id,
          kind: attention.kind,
          priority: attention.priority,
          title: item.title,
          detail: item.blocker ?? item.statusLabel,
          state: item.state,
          projectID: item.projectID,
          sessionID: item.sessionID,
          swarmID: item.swarmID,
          updatedAt: item.updatedAt,
        },
      ]
    })
    .sort((left, right) => left.priority - right.priority || right.updatedAt - left.updatedAt)
}

/**
 * Attention items present in `next` but not in `previous`, by id.
 *
 * Both clients already project `clientAttentionItems`, so this is the shared
 * "something new needs a human" trigger: the TUI notifies from it and the GUI
 * raises OS notifications from it, instead of each hand-rolling a diff that
 * could disagree about what counts as newly appeared.
 *
 * Callers that hold no previous projection yet (a freshly connected client)
 * should seed with the first snapshot rather than pass an empty array, or every
 * pre-existing item reads as new.
 */
export function clientAttentionTransitions(
  previous: readonly AttentionItem[],
  next: readonly AttentionItem[],
): AttentionItem[] {
  if (next.length === 0) return []
  const seen = new Set(previous.map((item) => item.id))
  return next.filter((item) => !seen.has(item.id))
}

export function clientWorkItemBucket(item: WorkItem | undefined) {
  if (!item) return "inactive" as const
  if (item.state === "waiting_input" || item.state === "waiting_permission") return "input_needed" as const
  if (item.state === "needs_review" || item.state === "partially_completed" || item.state === "completed")
    return "ready_for_review" as const
  if (["preparing", "queued", "running", "retrying", "cancelling", "recovered"].includes(item.state))
    return "in_progress" as const
  return "inactive" as const
}

export function workItemStatusLabel(state: WorkItemState) {
  const labels: Record<WorkItemState, string> = {
    idle: "Idle",
    preparing: "Preparing",
    queued: "Queued",
    running: "Running",
    waiting_input: "Input needed",
    waiting_permission: "Permission needed",
    retrying: "Retrying",
    cancelling: "Cancelling",
    recovered: "Recovered",
    partially_completed: "Partially completed",
    needs_review: "Needs review",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
  }
  return labels[state]
}

function sessionWorkItem(
  session: Session,
  status: SessionStatus | undefined,
  ui: OpencodeXSessionUiState | undefined,
  permissions: readonly PermissionRequest[] | undefined,
  questions: readonly QuestionRequest[] | undefined,
  jobs: readonly OpencodeXJob[] | undefined,
  now: number | undefined,
): WorkItem {
  const job = jobs ? [...jobs].sort((left, right) => time(right.timeUpdated) - time(left.timeUpdated))[0] : undefined
  const state = sessionState(status, ui, permissions, questions, job, session.time.updated)
  const blocker =
    permissions?.[0]?.permission ?? questions?.[0]?.questions[0]?.question ?? job?.failure?.message ?? job?.statusReason
  return {
    id: `session:${session.id}`,
    kind: "session",
    sourceID: session.id,
    parentID: session.parentID ? `session:${session.parentID}` : undefined,
    projectID: session.projectID,
    sessionID: session.id,
    title: session.title,
    objective: metadataString(session.metadata, "objective") ?? session.title,
    state,
    statusLabel: workItemStatusLabel(state),
    agent: session.agent,
    providerID: session.model?.providerID,
    modelID: session.model?.id,
    responsibleUser: metadataString(session.metadata, "responsibleUser"),
    executionTarget: target(session.metadata, session.directory),
    blocker,
    changedFiles: session.summary?.diffs?.flatMap((diff) => (diff.file ? [diff.file] : [])) ?? [],
    validation: validation(session.metadata),
    resourceUse: {
      cost: session.cost,
      inputTokens: session.tokens?.input,
      outputTokens: session.tokens?.output,
      reasoningTokens: session.tokens?.reasoning,
    },
    startedAt: session.time.created,
    completedAt: state === "completed" ? session.time.updated : undefined,
    updatedAt: session.time.updated,
    elapsedMs: elapsed(session.time.created, state === "completed" ? session.time.updated : undefined, now),
  }
}

function jobWorkItem(job: OpencodeXJob, now: number | undefined): WorkItem {
  const state = jobState(job)
  return {
    id: `job:${job.id}`,
    kind: "job",
    sourceID: job.id,
    jobID: job.id,
    parentID: job.parentJobID ? `job:${job.parentJobID}` : job.sessionID ? `session:${job.sessionID}` : undefined,
    projectID: job.projectID,
    sessionID: job.sessionID,
    swarmID: job.swarmID,
    title: job.title ?? job.kind,
    objective: metadataString(job.metadata, "objective") ?? job.title,
    state,
    statusLabel: workItemStatusLabel(state),
    agent: job.agent,
    providerID: job.providerID,
    modelID: job.modelID,
    responsibleUser: metadataString(job.metadata, "responsibleUser"),
    executionTarget: target(job.metadata),
    blocker: job.failure?.message ?? job.statusReason,
    changedFiles: metadataStrings(job.metadata, "changedFiles"),
    validation: validation(job.metadata),
    progress: {
      completed: Math.min(job.attempt, job.maxAttempts),
      failed: job.status === "failed" ? 1 : 0,
      total: job.maxAttempts,
    },
    startedAt: timeOrUndefined(job.startedAt),
    completedAt: timeOrUndefined(job.completedAt),
    updatedAt: time(job.timeUpdated),
    elapsedMs: elapsed(timeOrUndefined(job.startedAt), timeOrUndefined(job.completedAt), now),
  }
}

function sessionState(
  status: SessionStatus | undefined,
  ui: OpencodeXSessionUiState | undefined,
  permissions: readonly PermissionRequest[] | undefined,
  questions: readonly QuestionRequest[] | undefined,
  job: OpencodeXJob | undefined,
  updatedAt: number,
): WorkItemState {
  if (permissions?.length) return "waiting_permission"
  if (questions?.length || ui?.displayStatus === "input_needed") return "waiting_input"
  if (status?.type === "busy") return "running"
  if (status?.type === "retry") return "retrying"
  if (ui?.displayStatus === "needs_review") return "needs_review"
  if (job?.cancelRequestedAt && ["claimed", "running"].includes(job.status)) return "cancelling"
  if (time(job?.timeUpdated) >= updatedAt && job?.status === "failed") return "failed"
  if (time(job?.timeUpdated) >= updatedAt && job?.status === "interrupted") return "interrupted"
  return "idle"
}

function jobState(job: OpencodeXJob): WorkItemState {
  if (job.cancelRequestedAt && (job.status === "claimed" || job.status === "running")) return "cancelling"
  if (job.status === "claimed") return "preparing"
  if (job.status === "succeeded") return "completed"
  return job.status
}

function attentionForState(state: WorkItemState) {
  if (state === "waiting_permission") return { kind: "permission" as const, priority: 0 as const }
  if (state === "waiting_input") return { kind: "input" as const, priority: 0 as const }
  if (state === "failed" || state === "interrupted" || state === "partially_completed")
    return { kind: "failure" as const, priority: 1 as const }
  if (state === "needs_review" || state === "completed") return { kind: "review" as const, priority: 2 as const }
  if (state === "recovered") return { kind: "recovery" as const, priority: 2 as const }
  return undefined
}

function groupBySession<T extends { sessionID: string }>(entities: ClientEntityState<T>) {
  return entities.ids.reduce<Record<string, T[]>>((result, id) => {
    const entity = entities.records[id]
    if (!entity) return result
    return { ...result, [entity.sessionID]: [...(result[entity.sessionID] ?? []), entity] }
  }, {})
}

function sameWorkItemSources(left: WorkItemProjectionInput, right: WorkItemProjectionInput) {
  return (
    left.sessions === right.sessions &&
    left.sessionStatus === right.sessionStatus &&
    left.sessionUiState === right.sessionUiState &&
    left.permissions === right.permissions &&
    left.questions === right.questions &&
    left.jobs === right.jobs
  )
}

function groupJobsBySession(jobs: readonly OpencodeXJob[]) {
  return jobs.reduce<Record<string, OpencodeXJob[]>>((result, job) => {
    if (!job.sessionID) return result
    return { ...result, [job.sessionID]: [...(result[job.sessionID] ?? []), job] }
  }, {})
}

function target(metadata: unknown, directory?: string): ExecutionTarget {
  const runnerID = metadataString(metadata, "runnerID")
  if (runnerID) return { kind: "runner", runnerID, workspace: metadataString(metadata, "runnerWorkspace") }
  if (metadataString(metadata, "executionTarget") === "worktree" || metadataString(metadata, "worktreePath"))
    return {
      kind: "worktree",
      directory: metadataString(metadata, "worktreePath") ?? directory,
      branch: metadataString(metadata, "branch"),
    }
  return { kind: "direct", directory: metadataString(metadata, "directory") ?? directory }
}

function validation(metadata: unknown): ValidationResult {
  const state = metadataString(metadata, "validationState")
  return {
    state: state === "pending" || state === "passed" || state === "failed" ? state : "unknown",
    summary: metadataString(metadata, "validationSummary"),
  }
}

function metadataString(metadata: unknown, key: string) {
  if (!isMetadata(metadata)) return undefined
  const value = metadata[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function metadataStrings(metadata: unknown, key: string) {
  if (!isMetadata(metadata)) return []
  const value = metadata[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function isMetadata(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function time(value: number | string | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function timeOrUndefined(value: number | string | undefined) {
  const result = time(value)
  return result || undefined
}

function elapsed(startedAt: number | undefined, completedAt: number | undefined, now: number | undefined) {
  if (!startedAt || now === undefined) return undefined
  return Math.max(0, (completedAt ?? now) - startedAt)
}

import type { OpencodeXGoalEdgeTable, OpencodeXGoalNodeTable, OpencodeXGoalTable } from "@opencode-ai/core/opencodex/sql"
import { Option, Schema } from "effect"
import { OpencodeXJob } from "@/opencodex/job"
import {
  Budget,
  EdgeKind,
  Executor,
  Metadata,
  NodeKind,
  NodeStatus,
  Schedule,
  Status,
  Verdict,
  type Edge,
  type Info,
  type Node,
  type Spend,
} from "./goal-schema"

/** Row shapes, hydration, and the small encoders the store writes through. */

type GoalRow = typeof OpencodeXGoalTable.$inferSelect
type NodeRow = typeof OpencodeXGoalNodeTable.$inferSelect
type EdgeRow = typeof OpencodeXGoalEdgeTable.$inferSelect

const decodeExecutor = Schema.decodeUnknownOption(Schema.fromJsonString(Executor))
const decodeVerdict = Schema.decodeUnknownOption(Schema.fromJsonString(Verdict))
const decodeBudget = Schema.decodeUnknownOption(Schema.fromJsonString(Budget))
const decodeSchedule = Schema.decodeUnknownOption(Schema.fromJsonString(Schedule))
const decodeMetadata = Schema.decodeUnknownOption(Schema.fromJsonString(Metadata))

type StoredLoop = {
  exitCheckNodeID: string
  maxIterations: number
  iteration: number
  lastReport?: string
}

export const EMPTY_SPEND: Spend = { nodeRuns: 0, costUsd: 0 }

export function encode(value: unknown) {
  return value === undefined ? undefined : JSON.stringify(value)
}

export function hydrateGoal(input: { goal: GoalRow; nodes: readonly NodeRow[]; edges: readonly EdgeRow[] }): Info {
  const nodes = input.nodes.map((row) => hydrateNode(row, input.nodes))
  return {
    id: input.goal.id,
    projectID: input.goal.opencodex_project_id,
    title: input.goal.title,
    statement: input.goal.statement,
    successCriteria: input.goal.success_criteria_json ?? [],
    status: Schema.decodeUnknownSync(Status)(input.goal.status),
    source: Schema.decodeUnknownSync(OpencodeXJob.Source)(input.goal.source),
    ownerSessionID: input.goal.owner_session_id ?? undefined,
    swarmID: input.goal.swarm_id ?? undefined,
    directory: input.goal.directory ?? undefined,
    budget: input.goal.budget_json ? Option.getOrUndefined(decodeBudget(input.goal.budget_json)) : undefined,
    spend: parseSpend(input.goal.spend_json),
    schedule: input.goal.schedule_json ? Option.getOrUndefined(decodeSchedule(input.goal.schedule_json)) : undefined,
    statusReason: input.goal.status_reason ?? undefined,
    nodes,
    edges: input.edges.map(hydrateEdge),
    startedAt: input.goal.started_at ?? undefined,
    completedAt: input.goal.completed_at ?? undefined,
    metadata: input.goal.metadata_json ? Option.getOrUndefined(decodeMetadata(input.goal.metadata_json)) : undefined,
    timeCreated: input.goal.time_created,
    timeUpdated: input.goal.time_updated,
  }
}

export function hydrateNode(row: NodeRow, all: readonly NodeRow[]): Node {
  const loop = parseLoop(row.loop_json)
  return {
    id: row.id,
    goalID: row.goal_id,
    kind: Schema.decodeUnknownSync(NodeKind)(row.kind),
    title: row.title,
    brief: row.brief,
    status: Schema.decodeUnknownSync(NodeStatus)(row.status),
    executor: row.executor_json ? Option.getOrUndefined(decodeExecutor(row.executor_json)) : undefined,
    parentNodeID: row.parent_node_id ?? undefined,
    loop: loop
      ? {
          ...loop,
          // Membership lives on the child rows, so the body list cannot drift
          // out of sync with the nodes that actually belong to the loop.
          bodyNodeIDs: all.filter((item) => item.parent_node_id === row.id).map((item) => item.id),
        }
      : undefined,
    sortOrder: row.sort_order,
    iteration: row.iteration,
    jobID: row.job_id ?? undefined,
    sessionID: row.session_id ?? undefined,
    deliveredPrompt: row.delivered_prompt ?? undefined,
    result: row.result_text ?? undefined,
    verdict: row.verdict_json ? Option.getOrUndefined(decodeVerdict(row.verdict_json)) : undefined,
    failureReason: row.failure_reason ?? undefined,
    attempt: row.attempt,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    metadata: row.metadata_json ? Option.getOrUndefined(decodeMetadata(row.metadata_json)) : undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export function hydrateEdge(row: EdgeRow): Edge {
  return {
    goalID: row.goal_id,
    fromNodeID: row.from_node_id,
    toNodeID: row.to_node_id,
    kind: Schema.decodeUnknownSync(EdgeKind)(row.kind),
  }
}

export function parseLoop(value: string | null | undefined): StoredLoop | undefined {
  if (!value) return undefined
  try {
    const parsed: Partial<StoredLoop> = JSON.parse(value)
    if (typeof parsed?.exitCheckNodeID !== "string") return undefined
    return {
      exitCheckNodeID: parsed.exitCheckNodeID,
      maxIterations: typeof parsed.maxIterations === "number" ? parsed.maxIterations : 1,
      iteration: typeof parsed.iteration === "number" ? parsed.iteration : 0,
      lastReport: typeof parsed.lastReport === "string" ? parsed.lastReport : undefined,
    }
  } catch {
    return undefined
  }
}

/**
 * How many times this goal's graph has been re-instantiated: a standing goal's
 * sweeps and a planner re-queuing settled nodes both bump it. It lives in the
 * goal's metadata so a run never collides with a previous run's jobs.
 */
export function runSerial(goal: Pick<Info, "metadata">): number {
  const value = goal.metadata?.["runSerial"]
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0
}

/**
 * The idempotency key for the job that runs one node once. Stable across
 * racing reconciles of the same run - that is the point - and different for
 * every (iteration, run serial) pair, so a node re-run on purpose never finds
 * a finished job squatting on its key.
 */
export function nodeJobKey(goal: Pick<Info, "id" | "metadata">, nodeID: string, iteration: number): string {
  const run = runSerial(goal)
  return `${goal.id}:${nodeID}:${iteration}${run > 0 ? `:r${run}` : ""}`
}

export function parseSpend(value: string | null | undefined): Spend {
  if (!value) return EMPTY_SPEND
  try {
    const parsed: Partial<Spend> = JSON.parse(value)
    return {
      nodeRuns: typeof parsed?.nodeRuns === "number" ? parsed.nodeRuns : 0,
      costUsd: typeof parsed?.costUsd === "number" ? parsed.costUsd : 0,
    }
  } catch {
    return EMPTY_SPEND
  }
}

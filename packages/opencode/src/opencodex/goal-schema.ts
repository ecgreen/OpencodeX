import { EventV2 } from "@opencode-ai/core/event"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { OpencodeXJob } from "@/opencodex/job"
import { Project } from "@/project/project"
import { Context, Effect, Schema } from "effect"

/**
 * Goals, graphs, and loops - the agent-engineering layer.
 *
 * A goal is a user-stated outcome with checkable success criteria. It owns one
 * graph of nodes; a dispatcher walks the graph and delegates each node to its
 * executor. Swarms and non-swarms are the same graph: the executor is what
 * differs, so a swarm role and a bare model+skill are interchangeable here.
 */

export const Metadata = Schema.Record(Schema.String, Schema.Any)

export const Status = Schema.Literals([
  "draft",
  "planned",
  "running",
  "blocked",
  "paused",
  "completed",
  "failed",
  "cancelled",
])
export type Status = Schema.Schema.Type<typeof Status>

/** Statuses that mean "this goal will never move again on its own". */
export const TERMINAL_STATUSES: readonly Status[] = ["completed", "failed", "cancelled"]

export const NodeKind = Schema.Literals(["task", "check", "loop", "synthesis", "gate"])
export type NodeKind = Schema.Schema.Type<typeof NodeKind>

export const NodeStatus = Schema.Literals([
  "planned",
  "ready",
  "dispatched",
  "running",
  "done",
  "failed",
  "skipped",
  "awaiting_approval",
  "cancelled",
])
export type NodeStatus = Schema.Schema.Type<typeof NodeStatus>

/** A node is settled when the dispatcher will not run it again this iteration. */
export const TERMINAL_NODE_STATUSES: readonly NodeStatus[] = ["done", "failed", "skipped", "cancelled"]

export const EdgeKind = Schema.Literals(["requires", "feeds"])
export type EdgeKind = Schema.Schema.Type<typeof EdgeKind>

/**
 * What runs a node. `swarm_role` names a role on the goal's swarm (matched
 * leniently, the way delegation already matches role names); `agent` names a
 * configured agent; `model` is the bare case - a provider model plus optional
 * skill body and instructions. Every executor ends up as the same three prompt
 * layers, which is why swarm and non-swarm goals need no separate machinery.
 */
export const Executor = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("swarm_role"),
    role: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("agent"),
    agent: Schema.String,
    providerID: Schema.optional(ProviderV2.ID),
    modelID: Schema.optional(ProviderV2.ModelID),
    skill: Schema.optional(Schema.String),
    instructions: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("model"),
    providerID: Schema.optional(ProviderV2.ID),
    modelID: Schema.optional(ProviderV2.ModelID),
    skill: Schema.optional(Schema.String),
    instructions: Schema.optional(Schema.String),
  }),
]).annotate({ identifier: "OpencodeXGoalExecutor" })
export type Executor = Schema.Schema.Type<typeof Executor>

export const Loop = Schema.Struct({
  exitCheckNodeID: Schema.String,
  maxIterations: Schema.Number,
  iteration: Schema.Number,
  /** What the last exit check found, fed into the next iteration's prompts. */
  lastReport: Schema.optional(Schema.String),
  /** Derived from node parentage; present so clients can draw the cluster. */
  bodyNodeIDs: Schema.Array(Schema.String),
}).annotate({ identifier: "OpencodeXGoalLoop" })
export type Loop = Schema.Schema.Type<typeof Loop>

export const Verdict = Schema.Struct({
  pass: Schema.Boolean,
  summary: Schema.String,
  findings: Schema.Array(Schema.String),
}).annotate({ identifier: "OpencodeXGoalVerdict" })
export type Verdict = Schema.Schema.Type<typeof Verdict>

export const Node = Schema.Struct({
  id: Schema.String,
  goalID: Schema.String,
  kind: NodeKind,
  title: Schema.String,
  brief: Schema.String,
  status: NodeStatus,
  executor: Schema.optional(Executor),
  /** The loop this node is a body member of, when it sits inside one. */
  parentNodeID: Schema.optional(Schema.String),
  loop: Schema.optional(Loop),
  sortOrder: Schema.Number,
  iteration: Schema.Number,
  jobID: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
  /**
   * The exact text handed to the executor, persisted at dispatch. "What did
   * this agent receive" is a field, never an inference from the transcript.
   */
  deliveredPrompt: Schema.optional(Schema.String),
  result: Schema.optional(Schema.String),
  verdict: Schema.optional(Verdict),
  failureReason: Schema.optional(Schema.String),
  attempt: Schema.Number,
  startedAt: Schema.optional(Schema.Number),
  completedAt: Schema.optional(Schema.Number),
  metadata: Schema.optional(Metadata),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "OpencodeXGoalNode" })
export type Node = Schema.Schema.Type<typeof Node>

export const Edge = Schema.Struct({
  goalID: Schema.String,
  fromNodeID: Schema.String,
  toNodeID: Schema.String,
  kind: EdgeKind,
}).annotate({ identifier: "OpencodeXGoalEdge" })
export type Edge = Schema.Schema.Type<typeof Edge>

export const Budget = Schema.Struct({
  maxNodeRuns: Schema.optional(Schema.Number),
  maxWallClockMs: Schema.optional(Schema.Number),
  maxCostUsd: Schema.optional(Schema.Number),
}).annotate({ identifier: "OpencodeXGoalBudget" })
export type Budget = Schema.Schema.Type<typeof Budget>

export const Spend = Schema.Struct({
  nodeRuns: Schema.Number,
  costUsd: Schema.Number,
}).annotate({ identifier: "OpencodeXGoalSpend" })
export type Spend = Schema.Schema.Type<typeof Spend>

/** A recurring goal re-instantiates its graph on this cadence. */
export const Schedule = Schema.Struct({
  everyMs: Schema.Number,
  nextRunAt: Schema.optional(Schema.Number),
  lastRunAt: Schema.optional(Schema.Number),
  paused: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "OpencodeXGoalSchedule" })
export type Schedule = Schema.Schema.Type<typeof Schedule>

export const Info = Schema.Struct({
  id: Schema.String,
  projectID: Schema.String,
  title: Schema.String,
  statement: Schema.String,
  successCriteria: Schema.Array(Schema.String),
  status: Status,
  source: OpencodeXJob.Source,
  /** The chat session that owns the goal; absent for standing goals. */
  ownerSessionID: Schema.optional(Schema.String),
  /** The swarm whose roles are the default executor pool, when there is one. */
  swarmID: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  budget: Schema.optional(Budget),
  spend: Spend,
  schedule: Schema.optional(Schedule),
  statusReason: Schema.optional(Schema.String),
  nodes: Schema.Array(Node),
  edges: Schema.Array(Edge),
  startedAt: Schema.optional(Schema.Number),
  completedAt: Schema.optional(Schema.Number),
  metadata: Schema.optional(Metadata),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "OpencodeXGoal" })
export type Info = Schema.Schema.Type<typeof Info>

export const StateEvent = {
  Created: EventV2.define({
    type: "opencodex.goal.created",
    sync: { aggregate: "goalID", version: 1 },
    schema: { goalID: Schema.String },
  }),
  Updated: EventV2.define({
    type: "opencodex.goal.updated",
    sync: { aggregate: "goalID", version: 1 },
    schema: { goalID: Schema.String },
  }),
  Deleted: EventV2.define({
    type: "opencodex.goal.deleted",
    sync: { aggregate: "goalID", version: 1 },
    schema: { goalID: Schema.String },
  }),
}

/** One node as a planner authors it. Ids are planner-chosen so edges can name them. */
export const NodeInput = Schema.Struct({
  id: Schema.String,
  kind: Schema.optional(NodeKind),
  title: Schema.String,
  brief: Schema.String,
  executor: Schema.optional(Executor),
  parentNodeID: Schema.optional(Schema.String),
  loop: Schema.optional(
    Schema.Struct({
      exitCheckNodeID: Schema.String,
      maxIterations: Schema.optional(Schema.Number),
    }),
  ),
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXGoalNodeInput" })
export type NodeInput = Schema.Schema.Type<typeof NodeInput>

export const EdgeInput = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  kind: Schema.optional(EdgeKind),
}).annotate({ identifier: "OpencodeXGoalEdgeInput" })
export type EdgeInput = Schema.Schema.Type<typeof EdgeInput>

export const CreateInput = Schema.Struct({
  projectID: Schema.String,
  title: Schema.optional(Schema.String),
  statement: Schema.String,
  successCriteria: Schema.optional(Schema.Array(Schema.String)),
  ownerSessionID: Schema.optional(Schema.String),
  swarmID: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  source: Schema.optional(OpencodeXJob.Source),
  budget: Schema.optional(Budget),
  schedule: Schema.optional(Schedule),
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXGoalCreateInput" })
export type CreateInput = Schema.Schema.Type<typeof CreateInput>

/** Replaces the whole plan. Only legal while the goal has not started running. */
export const PlanInput = Schema.Struct({
  nodes: Schema.Array(NodeInput),
  edges: Schema.optional(Schema.Array(EdgeInput)),
  successCriteria: Schema.optional(Schema.Array(Schema.String)),
  budget: Schema.optional(Budget),
}).annotate({ identifier: "OpencodeXGoalPlanInput" })
export type PlanInput = Schema.Schema.Type<typeof PlanInput>

/**
 * Mid-flight repair: add remediation nodes, skip obsolete ones, retarget an
 * executor. Append-only - existing nodes are patched, never silently dropped.
 */
export const UpdatePlanInput = Schema.Struct({
  addNodes: Schema.optional(Schema.Array(NodeInput)),
  addEdges: Schema.optional(Schema.Array(EdgeInput)),
  patchNodes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        title: Schema.optional(Schema.String),
        brief: Schema.optional(Schema.String),
        executor: Schema.optional(Executor),
        status: Schema.optional(Schema.Literals(["planned", "skipped"])),
      }),
    ),
  ),
  successCriteria: Schema.optional(Schema.Array(Schema.String)),
  budget: Schema.optional(Budget),
}).annotate({ identifier: "OpencodeXGoalUpdatePlanInput" })
export type UpdatePlanInput = Schema.Schema.Type<typeof UpdatePlanInput>

export const ReportInput = Schema.Struct({
  nodeID: Schema.String,
  result: Schema.optional(Schema.String),
  verdict: Schema.optional(Verdict),
}).annotate({ identifier: "OpencodeXGoalReportInput" })
export type ReportInput = Schema.Schema.Type<typeof ReportInput>

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("OpencodeX.Goal.NotFoundError", {
  goalID: Schema.String,
}) {}

export class NodeNotFoundError extends Schema.TaggedErrorClass<NodeNotFoundError>()(
  "OpencodeX.Goal.NodeNotFoundError",
  {
    goalID: Schema.String,
    nodeID: Schema.String,
  },
) {}

/**
 * A rejected plan. `issues` is the full list so a planner can repair every
 * problem in one pass instead of discovering them one round-trip at a time.
 */
export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()("OpencodeX.Goal.ValidationError", {
  message: Schema.String,
  issues: Schema.optional(Schema.Array(Schema.String)),
}) {}

export interface Interface {
  readonly list: (input?: { projectID?: string; sessionID?: string }) => Effect.Effect<Info[]>
  readonly get: (goalID: string) => Effect.Effect<Info, NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info, Project.NotFoundError | ValidationError>
  readonly plan: (goalID: string, input: PlanInput) => Effect.Effect<Info, NotFoundError | ValidationError>
  readonly updatePlan: (
    goalID: string,
    input: UpdatePlanInput,
  ) => Effect.Effect<Info, NotFoundError | ValidationError>
  readonly report: (goalID: string, input: ReportInput) => Effect.Effect<Info, NotFoundError | NodeNotFoundError>
  readonly start: (goalID: string) => Effect.Effect<Info, NotFoundError | ValidationError>
  readonly approve: (
    goalID: string,
    nodeID: string,
    approved: boolean,
  ) => Effect.Effect<Info, NotFoundError | NodeNotFoundError>
  readonly cancel: (goalID: string) => Effect.Effect<Info, NotFoundError>
  readonly remove: (goalID: string) => Effect.Effect<boolean, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXGoal") {}

/** The read half, for layers that must not pull the executor graph in. */
export interface ReadInterface {
  readonly list: (input?: { projectID?: string; sessionID?: string }) => Effect.Effect<Info[]>
  readonly get: (goalID: string) => Effect.Effect<Info, NotFoundError>
}

export class ReadService extends Context.Service<ReadService, ReadInterface>()("@opencode/OpencodeXGoalRead") {}

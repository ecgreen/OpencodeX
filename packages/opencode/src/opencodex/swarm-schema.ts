import { EventV2 } from "@opencode-ai/core/event"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { OpencodeXJob } from "@/opencodex/job"
import { Project } from "@/project/project"
import { Context, Effect, Schema } from "effect"

export const Metadata = Schema.Record(Schema.String, Schema.Any)

export const Status = Schema.Literals([
  "draft",
  "planned",
  "queued",
  "running",
  "cancelling",
  "approval_needed",
  "blocked",
  "failed",
  "partially_failed",
  "completed",
  "cancelled",
])
export type Status = Schema.Schema.Type<typeof Status>

export const RoleStatus = Schema.Literals([
  "planned",
  "queued",
  "running",
  "cancelling",
  "blocked",
  "failed",
  "completed",
  "cancelled",
])
export type RoleStatus = Schema.Schema.Type<typeof RoleStatus>

export const Event = Schema.Struct({
  id: Schema.String,
  swarmID: Schema.String,
  runID: Schema.optional(Schema.String),
  roleID: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
  kind: Schema.String,
  message: Schema.String,
  metadata: Schema.optional(Metadata),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "OpencodeXSwarmEvent" })
export type Event = Schema.Schema.Type<typeof Event>

export const StateEvent = {
  Created: EventV2.define({
    type: "opencodex.swarm.created",
    sync: { aggregate: "swarmID", version: 1 },
    schema: { swarmID: Schema.String },
  }),
  Updated: EventV2.define({
    type: "opencodex.swarm.updated",
    sync: { aggregate: "swarmID", version: 1 },
    schema: { swarmID: Schema.String },
  }),
  Deleted: EventV2.define({
    type: "opencodex.swarm.deleted",
    sync: { aggregate: "swarmID", version: 1 },
    schema: { swarmID: Schema.String },
  }),
}

export const Role = Schema.Struct({
  id: Schema.String,
  swarmID: Schema.String,
  name: Schema.String,
  agent: Schema.optional(Schema.String),
  skill: Schema.optional(Schema.String),
  providerID: Schema.optional(ProviderV2.ID),
  modelID: Schema.optional(ProviderV2.ModelID),
  modelProfile: Schema.optional(Schema.String),
  status: RoleStatus,
  instructions: Schema.String,
  sortOrder: Schema.Number,
  sessionID: Schema.optional(Schema.String),
  jobID: Schema.optional(Schema.String),
  metadata: Schema.optional(Metadata),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "OpencodeXSwarmRole" })
export type Role = Schema.Schema.Type<typeof Role>

export const AgentRun = Schema.Struct({
  id: Schema.String,
  runID: Schema.String,
  swarmID: Schema.String,
  roleID: Schema.optional(Schema.String),
  status: RoleStatus,
  prompt: Schema.String,
  sessionID: Schema.optional(Schema.String),
  jobID: Schema.optional(Schema.String),
  metadata: Schema.optional(Metadata),
  startedAt: Schema.optional(Schema.Number),
  completedAt: Schema.optional(Schema.Number),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "OpencodeXSwarmAgentRun" })
export type AgentRun = Schema.Schema.Type<typeof AgentRun>

export const Run = Schema.Struct({
  id: Schema.String,
  swarmID: Schema.String,
  projectID: Schema.optional(Schema.String),
  title: Schema.String,
  prompt: Schema.String,
  status: Status,
  source: OpencodeXJob.Source,
  orchestratorSessionID: Schema.optional(Schema.String),
  resultSessionID: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.Number),
  completedAt: Schema.optional(Schema.Number),
  metadata: Schema.optional(Metadata),
  agents: Schema.Array(AgentRun),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "OpencodeXSwarmRun" })
export type Run = Schema.Schema.Type<typeof Run>

export const Info = Schema.Struct({
  id: Schema.String,
  projectID: Schema.String,
  title: Schema.String,
  prompt: Schema.String,
  status: Status,
  source: OpencodeXJob.Source,
  createdBy: Schema.optional(Schema.String),
  synthesisSessionID: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.Number),
  completedAt: Schema.optional(Schema.Number),
  metadata: Schema.optional(Metadata),
  roles: Schema.Array(Role),
  runs: Schema.Array(Run),
  events: Schema.Array(Event),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "OpencodeXSwarm" })
export type Info = Schema.Schema.Type<typeof Info>

export const RoleInput = Schema.Struct({
  name: Schema.String,
  agent: Schema.optional(Schema.String),
  skill: Schema.optional(Schema.String),
  providerID: Schema.optional(ProviderV2.ID),
  modelID: Schema.optional(ProviderV2.ModelID),
  modelProfile: Schema.optional(Schema.String),
  instructions: Schema.String,
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXSwarmRoleInput" })
export type RoleInput = Schema.Schema.Type<typeof RoleInput>

export const CreateInput = Schema.Struct({
  projectID: Schema.String,
  title: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  source: Schema.optional(OpencodeXJob.Source),
  createdBy: Schema.optional(Schema.String),
  roles: Schema.optional(Schema.Array(RoleInput)),
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXSwarmCreateInput" })
export type CreateInput = Schema.Schema.Type<typeof CreateInput>

export const UpdateInput = Schema.Struct({
  title: Schema.optional(Schema.String),
  roles: Schema.optional(Schema.Array(RoleInput)),
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXSwarmUpdateInput" })
export type UpdateInput = Schema.Schema.Type<typeof UpdateInput>

export const AssignTaskInput = Schema.Struct({
  prompt: Schema.String,
  agent: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.Union([Schema.Literal("build"), Schema.Literal("plan")])),
  variant: Schema.optional(Schema.String),
}).annotate({ identifier: "OpencodeXSwarmAssignTaskInput" })
export type AssignTaskInput = Schema.Schema.Type<typeof AssignTaskInput>

export const AddRoleInput = Schema.Struct({
  role: RoleInput,
}).annotate({ identifier: "OpencodeXSwarmAddRoleInput" })
export type AddRoleInput = Schema.Schema.Type<typeof AddRoleInput>

export const UpdateRoleInput = Schema.Struct({
  name: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  skill: Schema.optional(Schema.String),
  providerID: Schema.optional(Schema.String),
  modelID: Schema.optional(Schema.String),
  modelProfile: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXSwarmUpdateRoleInput" })
export type UpdateRoleInput = Schema.Schema.Type<typeof UpdateRoleInput>

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("OpencodeX.Swarm.NotFoundError", {
  swarmID: Schema.String,
}) {}

export class RoleNotFoundError extends Schema.TaggedErrorClass<RoleNotFoundError>()(
  "OpencodeX.Swarm.RoleNotFoundError",
  {
    swarmID: Schema.String,
    roleID: Schema.String,
  },
) {}

export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()("OpencodeX.Swarm.ValidationError", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (swarmID: string) => Effect.Effect<Info, NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info, Project.NotFoundError | ValidationError>
  readonly update: (swarmID: string, input: UpdateInput) => Effect.Effect<Info, NotFoundError | ValidationError>
  readonly start: (swarmID: string) => Effect.Effect<Info, NotFoundError | ValidationError>
  readonly assignTask: (swarmID: string, input: AssignTaskInput) => Effect.Effect<Info, NotFoundError | ValidationError>
  readonly cancel: (swarmID: string) => Effect.Effect<Info, NotFoundError>
  readonly remove: (swarmID: string) => Effect.Effect<boolean, NotFoundError>
  readonly addRole: (swarmID: string, input: AddRoleInput) => Effect.Effect<Info, NotFoundError | ValidationError>
  readonly updateRole: (
    swarmID: string,
    roleID: string,
    input: UpdateRoleInput,
  ) => Effect.Effect<Info, NotFoundError | RoleNotFoundError | ValidationError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OpencodeXSwarm") {}

export interface ReadInterface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (swarmID: string) => Effect.Effect<Info, NotFoundError>
}

export class ReadService extends Context.Service<ReadService, ReadInterface>()("@opencode/OpencodeXSwarmRead") {}

export interface PlanInterface {
  readonly create: (
    input: CreateInput,
  ) => Effect.Effect<{ id: string; title: string; roles: RoleInput[] }, Project.NotFoundError | ValidationError>
}

export class PlanService extends Context.Service<PlanService, PlanInterface>()("@opencode/OpencodeXSwarmPlan") {}

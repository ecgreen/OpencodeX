import {
  OpencodeXSwarmAgentRunTable,
  OpencodeXSwarmEventTable,
  OpencodeXSwarmRoleTable,
  OpencodeXSwarmRunTable,
  OpencodeXSwarmTable,
} from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXProject } from "@/opencodex/project"
import { Project } from "@/project/project"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionPrompt } from "@/session/prompt"
import { Cause, Context, Effect, Layer, Option, Scope, Schema } from "effect"
import { eq, inArray } from "drizzle-orm"

const Metadata = Schema.Record(Schema.String, Schema.Any)
const decodeMetadata = Schema.decodeUnknownOption(Schema.fromJsonString(Metadata))

function metadata(value: string | null) {
  return value ? Option.getOrUndefined(decodeMetadata(value)) : undefined
}

export const Status = Schema.Literals([
  "draft",
  "planned",
  "queued",
  "running",
  "approval_needed",
  "blocked",
  "failed",
  "completed",
  "cancelled",
])
export type Status = Schema.Schema.Type<typeof Status>

export const RoleStatus = Schema.Literals([
  "planned",
  "queued",
  "running",
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

function serializeMetadata(metadata: Record<string, unknown> | undefined) {
  return metadata ? JSON.stringify(metadata) : undefined
}

function defaultTitle(prompt?: string) {
  const firstLine = prompt?.trim().split(/\r?\n/)[0] ?? "New swarm"
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine || "New swarm"
}

function defaultRoles(prompt: string): RoleInput[] {
  return [
    {
      name: "Orchestrator",
      skill: "orchestrator",
      instructions: `Coordinate specialist work, resolve dependencies, enforce verification gates, and synthesize a final handoff for this request:\n\n${prompt}`,
    },
    {
      name: "Product Manager",
      skill: "product-manager",
      instructions: `Clarify the product goal, user workflows, acceptance criteria, and tradeoffs for this request:\n\n${prompt}`,
    },
    {
      name: "Designer",
      skill: "designer",
      instructions: `Analyze the UI and UX implications, including flows, interaction states, accessibility, and design requirements:\n\n${prompt}`,
    },
    {
      name: "Architect",
      skill: "architect",
      instructions: `Identify the technical design, integration points, data flow, and implementation risks for this request:\n\n${prompt}`,
    },
    {
      name: "Senior Engineer",
      skill: "senior-engineer",
      instructions: `Plan or implement the engineering work, using product, design, and architecture constraints:\n\n${prompt}`,
    },
    {
      name: "QA Engineer",
      skill: "qa-engineer",
      instructions: `Define validation strategy, edge cases, and regression risks for this request:\n\n${prompt}`,
    },
    {
      name: "Code Reviewer",
      skill: "code-reviewer",
      instructions: `Review completed or proposed work for correctness, maintainability, regressions, and missing validation:\n\n${prompt}`,
    },
  ]
}

function isOrchestratorRole(role: RoleInput) {
  return role.skill === "orchestrator" || role.name.trim().toLowerCase() === "orchestrator"
}

function validateRoles(roles: readonly RoleInput[]) {
  if (roles.length < 2) return "A swarm requires at least two agents: one Orchestrator and one other role."
  if (roles.length > 10) return "A swarm can run at most 10 agents."
  if (!isOrchestratorRole(roles[0])) {
    return "A swarm requires the first role to be the Orchestrator."
  }
  if (!roles.some((role) => !isOrchestratorRole(role))) {
    return "A swarm requires at least one non-Orchestrator role."
  }
  if (roles.some((role) => role.name.trim().length === 0)) return "Every swarm role needs a name."
  return undefined
}

function hydrateRole(row: typeof OpencodeXSwarmRoleTable.$inferSelect): Role {
  return {
    id: row.id,
    swarmID: row.swarm_id,
    name: row.name,
    agent: row.agent ?? undefined,
    skill: row.skill ?? undefined,
    providerID: row.provider_id ? ProviderV2.ID.make(row.provider_id) : undefined,
    modelID: row.model_id ? ProviderV2.ModelID.make(row.model_id) : undefined,
    modelProfile: row.model_profile ?? undefined,
    status: Schema.decodeUnknownSync(RoleStatus)(row.status),
    instructions: row.instructions,
    sortOrder: row.sort_order,
    sessionID: row.session_id ?? undefined,
    jobID: row.job_id ?? undefined,
    metadata: metadata(row.metadata_json),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function hydrateEvent(row: typeof OpencodeXSwarmEventTable.$inferSelect): Event {
  return {
    id: row.id,
    swarmID: row.swarm_id,
    runID: row.run_id ?? undefined,
    roleID: row.role_id ?? undefined,
    sessionID: row.session_id ?? undefined,
    kind: row.kind,
    message: row.message,
    metadata: metadata(row.metadata_json),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function hydrateAgentRun(row: typeof OpencodeXSwarmAgentRunTable.$inferSelect): AgentRun {
  return {
    id: row.id,
    runID: row.run_id,
    swarmID: row.swarm_id,
    roleID: row.role_id ?? undefined,
    status: Schema.decodeUnknownSync(RoleStatus)(row.status),
    prompt: row.prompt,
    sessionID: row.session_id ?? undefined,
    jobID: row.job_id ?? undefined,
    metadata: metadata(row.metadata_json),
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function hydrateRun(
  row: typeof OpencodeXSwarmRunTable.$inferSelect,
  agents: (typeof OpencodeXSwarmAgentRunTable.$inferSelect)[],
): Run {
  return {
    id: row.id,
    swarmID: row.swarm_id,
    projectID: row.opencodex_project_id ?? undefined,
    title: row.title,
    prompt: row.prompt,
    status: Schema.decodeUnknownSync(Status)(row.status),
    source: Schema.decodeUnknownSync(OpencodeXJob.Source)(row.source),
    orchestratorSessionID: row.orchestrator_session_id ?? undefined,
    resultSessionID: row.result_session_id ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    metadata: metadata(row.metadata_json),
    agents: agents.filter((agent) => agent.run_id === row.id).map(hydrateAgentRun),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function hydrate(input: {
  swarm: typeof OpencodeXSwarmTable.$inferSelect
  roles: (typeof OpencodeXSwarmRoleTable.$inferSelect)[]
  runs: (typeof OpencodeXSwarmRunTable.$inferSelect)[]
  agentRuns: (typeof OpencodeXSwarmAgentRunTable.$inferSelect)[]
  events: (typeof OpencodeXSwarmEventTable.$inferSelect)[]
}): Info {
  const runs = input.runs.map((run) => hydrateRun(run, input.agentRuns))
  const latestRun = runs.toSorted((a, b) => b.timeCreated - a.timeCreated)[0]
  return {
    id: input.swarm.id,
    projectID: input.swarm.opencodex_project_id,
    title: input.swarm.title,
    prompt: latestRun?.prompt ?? input.swarm.prompt,
    status: latestRun?.status ?? Schema.decodeUnknownSync(Status)(input.swarm.status),
    source: Schema.decodeUnknownSync(OpencodeXJob.Source)(input.swarm.source),
    createdBy: input.swarm.created_by ?? undefined,
    synthesisSessionID: latestRun?.resultSessionID ?? input.swarm.synthesis_session_id ?? undefined,
    startedAt: latestRun?.startedAt ?? input.swarm.started_at ?? undefined,
    completedAt: latestRun?.completedAt ?? input.swarm.completed_at ?? undefined,
    metadata: metadata(input.swarm.metadata_json),
    roles: input.roles.map(hydrateRole),
    runs,
    events: input.events.map(hydrateEvent),
    timeCreated: input.swarm.time_created,
    timeUpdated: Math.max(input.swarm.time_updated, latestRun?.timeUpdated ?? 0),
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function swarmJobOwner(runID: string, phase: string) {
  return `local:${process.pid}:swarm:${runID}:${phase}`
}

function rolePrompt(input: { swarm: Info; role: Role; coordination?: string }) {
  const skill = input.role.skill ? `Use the "${input.role.skill}" role skill if it is available.` : undefined
  const instructions = input.role.instructions.trim()
  return [
    `You are running as the "${input.role.name}" role in an OpencodeX swarm.`,
    "",
    "Swarm goal:",
    input.swarm.prompt,
    input.coordination ? "" : undefined,
    input.coordination ? "Orchestrator coordination brief:" : undefined,
    input.coordination || undefined,
    instructions ? "" : undefined,
    instructions ? "Custom role instructions:" : undefined,
    instructions || undefined,
    instructions ? "" : undefined,
    skill,
    "Work independently and produce a concise handoff for the rest of the swarm.",
    instructions ? "Do not wait for other roles unless your custom instructions explicitly require it." : undefined,
    "",
    "End with this handoff format:",
    "",
    "## Handoff",
    "",
    "Decision:",
    "Work completed:",
    "Key evidence:",
    "Risks:",
    "Open questions:",
    "Recommended next action:",
    "Artifacts:",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

function executionMode(input: { agent?: string; mode?: "build" | "plan" }) {
  return input.mode ?? (input.agent === "plan" ? "plan" : "build")
}

function executionModeInstructions(mode: "build" | "plan") {
  if (mode === "plan") {
    return [
      "Execution mode: PLAN.",
      "The user wants a plan for review before execution.",
      "Never make code changes in plan mode. Do not edit files, write files, run destructive commands, or ask subagents to make code changes.",
      "When coordinating with subagents, explicitly tell them this is plan mode and require planning, analysis, review, or ticket output only.",
      "End with a reviewable plan, risks, open questions, and recommended next action for user approval.",
    ]
  }
  return [
    "Execution mode: BUILD.",
    "The user wants the swarm to execute approved work.",
    "When coordinating with subagents, explicitly tell them this is build mode and whether that subagent may edit files or should only review, validate, or plan.",
    "Build mode may make code changes when needed, but still requires role handoffs, validation, and review evidence before completion.",
  ]
}

function orchestratorRunPrompt(input: {
  swarm: Info
  run: Run
  orchestrator: Role
  roles: readonly Role[]
  mode: "build" | "plan"
}) {
  return [
    `You are the "${input.orchestrator.name}" orchestrator for an OpencodeX swarm team.`,
    "",
    input.orchestrator.skill ? `Use the "${input.orchestrator.skill}" role skill if it is available.` : undefined,
    ...executionModeInstructions(input.mode),
    "",
    "Produce the coordination brief for specialist jobs that the durable swarm runtime will launch after this turn.",
    "Do not invoke the task tool or start subagents yourself; doing so would create work outside the persisted job graph.",
    "Break the request into role-specific scopes, dependencies, expected outputs, and verification gates.",
    "Maintain a delegation ledger that records assignment, expected output, dependency, and follow-up owner for every role.",
    "Duplicate same-skill roles are allowed. Before delegating to duplicates, assign each one a temporary working title, non-overlapping scope boundary, expected output, and merge order; record those assignments in the delegation ledger.",
    "For user-visible product work, start by delegating discovery to Product Manager and Designer. Combine their findings with Architect constraints into detailed engineering tickets before sending work to Senior Engineer.",
    "Engineering tickets should include goal, scope, requirements, UX states, technical constraints, acceptance criteria, dependencies, risks, suggested validation, and owner.",
    "Before completion, require build, QA, and review evidence when those roles are relevant. If a gate is skipped, explain why and create a follow-up ticket.",
    "If a worker needs user input, decide whether the question is truly blocking; ask the user yourself only when needed.",
    "",
    "Swarm team:",
    input.swarm.title,
    "",
    "Run goal:",
    input.run.prompt,
    "",
    "Available team members:",
    ...input.roles.map((role) =>
      [
        `- ${role.name}`,
        role.id ? `id=${role.id}` : undefined,
        role.skill ? `skill=${role.skill}` : undefined,
        role.agent ? `agent=${role.agent}` : undefined,
        role.providerID && role.modelID ? `preferred_model=${role.providerID}/${role.modelID}` : undefined,
        role.modelProfile ? `model_profile=${role.modelProfile}` : undefined,
        role.instructions ? `instructions=${role.instructions}` : undefined,
      ]
        .filter((item): item is string => item !== undefined)
        .join("; "),
    ),
    "Treat team members with different ids as separate resources, even when they share the same name or skill.",
    "If team members share the same name or skill, disambiguate them in your own plan before starting workers; do not send identical broad prompts to duplicate roles.",
    "",
    "For each role, include the role identity, user goal, current stage, exact scope, non-goals, expected deliverable, verification expectation, and whether the worker may edit files.",
    "Do not claim that workers have already run. This turn prepares their durable assignments.",
    "",
    "When complete, provide:",
    "Decision summary:",
    "Coordination brief:",
    "Delegation ledger:",
    "Engineering tickets:",
    "Stage gates:",
    "Key role findings:",
    "Risks:",
    "Open questions:",
    "Recommended next action:",
    "Artifacts:",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

function messageText(message: { parts: { type: string; text?: string; synthetic?: boolean }[] }) {
  return message.parts
    .filter((part) => part.type === "text" && !part.synthetic && part.text?.trim())
    .map((part) => part.text?.trim())
    .filter((text): text is string => text !== undefined && text.length > 0)
    .join("\n")
}

function selectedRoleModel(role: Role) {
  if (!role.providerID || !role.modelID) return undefined
  return {
    providerID: ProviderV2.ID.make(role.providerID),
    modelID: ProviderV2.ModelID.make(role.modelID),
  }
}

function synthesisPrompt(input: {
  swarm: Info
  roles: {
    role: Role
    output: string
  }[]
}) {
  return [
    "You are the synthesis agent for an OpencodeX swarm.",
    "",
    "Swarm goal:",
    input.swarm.prompt,
    "",
    "Role outputs:",
    ...input.roles.flatMap((item) => [
      "",
      `## ${item.role.name}`,
      `Session: ${item.role.sessionID ?? "(none)"}`,
      item.output || "(no output captured)",
    ]),
    "",
    "Produce a concise final synthesis for the user.",
    "",
    "Include:",
    "Decision summary:",
    "Work completed:",
    "Key role findings:",
    "Risks:",
    "Open questions:",
    "Recommended next action:",
    "Artifacts:",
  ].join("\n")
}

export const planLayer = Layer.effect(
  PlanService,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    const projects = yield* OpencodeXProject.Service

    const create = Effect.fn("OpencodeXSwarmPlan.create")(function* (input: CreateInput) {
      yield* projects.get(input.projectID)
      const swarmID = `swm_${Identifier.ascending()}`
      const now = Date.now()
      const prompt = input.prompt?.trim() ?? ""
      const roles = input.roles && input.roles.length > 0 ? [...input.roles] : defaultRoles(prompt)
      const invalid = validateRoles(roles)
      if (invalid) return yield* new ValidationError({ message: invalid })
      const title = input.title?.trim() || defaultTitle(prompt)
      yield* db
        .transaction(
          (tx) =>
            Effect.gen(function* () {
              yield* tx
                .insert(OpencodeXSwarmTable)
                .values({
                  id: swarmID,
                  opencodex_project_id: input.projectID,
                  title,
                  prompt,
                  status: "planned",
                  source: input.source ?? "manual",
                  created_by: input.createdBy,
                  metadata_json: serializeMetadata(input.metadata),
                  time_created: now,
                  time_updated: now,
                })
                .run()
              yield* Effect.forEach(
                roles,
                (role, index) =>
                  tx
                    .insert(OpencodeXSwarmRoleTable)
                    .values({
                      id: `swr_${Identifier.ascending()}`,
                      swarm_id: swarmID,
                      name: role.name,
                      agent: role.agent,
                      skill: role.skill,
                      provider_id: role.providerID,
                      model_id: role.modelID,
                      model_profile: role.modelProfile,
                      status: "planned",
                      instructions: role.instructions,
                      sort_order: index,
                      metadata_json: serializeMetadata(role.metadata),
                      time_created: now,
                      time_updated: now,
                    })
                    .run(),
                { discard: true },
              )
              yield* tx
                .insert(OpencodeXSwarmEventTable)
                .values({
                  id: `oxe_${Identifier.ascending()}`,
                  swarm_id: swarmID,
                  kind: "swarm.created",
                  message: "Swarm plan created",
                  time_created: now,
                  time_updated: now,
                })
                .run()
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
      yield* events.publish(StateEvent.Created, { swarmID })
      return { id: swarmID, title, roles }
    })

    return PlanService.of({ create })
  }),
)

export const readLayer = Layer.effect(
  ReadService,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const get = Effect.fn("OpencodeXSwarmRead.get")(function* (swarmID: string) {
      const swarm = yield* db
        .select()
        .from(OpencodeXSwarmTable)
        .where(eq(OpencodeXSwarmTable.id, swarmID))
        .get()
        .pipe(Effect.orDie)
      if (!swarm) return yield* new NotFoundError({ swarmID })
      const [roles, runs, agentRuns, events] = yield* Effect.all(
        [
          db
            .select()
            .from(OpencodeXSwarmRoleTable)
            .where(eq(OpencodeXSwarmRoleTable.swarm_id, swarmID))
            .orderBy(OpencodeXSwarmRoleTable.sort_order, OpencodeXSwarmRoleTable.time_created)
            .all()
            .pipe(Effect.orDie),
          db
            .select()
            .from(OpencodeXSwarmRunTable)
            .where(eq(OpencodeXSwarmRunTable.swarm_id, swarmID))
            .orderBy(OpencodeXSwarmRunTable.time_created)
            .all()
            .pipe(Effect.orDie),
          db
            .select()
            .from(OpencodeXSwarmAgentRunTable)
            .where(eq(OpencodeXSwarmAgentRunTable.swarm_id, swarmID))
            .orderBy(OpencodeXSwarmAgentRunTable.time_created)
            .all()
            .pipe(Effect.orDie),
          db
            .select()
            .from(OpencodeXSwarmEventTable)
            .where(eq(OpencodeXSwarmEventTable.swarm_id, swarmID))
            .orderBy(OpencodeXSwarmEventTable.time_created)
            .all()
            .pipe(Effect.orDie),
        ],
        { concurrency: "unbounded" },
      )
      return hydrate({ swarm, roles, runs, agentRuns, events })
    })

    const list = Effect.fn("OpencodeXSwarmRead.list")(function* () {
      const swarms = (yield* db
        .select()
        .from(OpencodeXSwarmTable)
        .orderBy(OpencodeXSwarmTable.time_updated)
        .all()
        .pipe(Effect.orDie)).toReversed()
      if (swarms.length === 0) return []
      const ids = swarms.map((swarm) => swarm.id)
      const [roles, runs, agentRuns, history] = yield* Effect.all(
        [
          db
            .select()
            .from(OpencodeXSwarmRoleTable)
            .where(inArray(OpencodeXSwarmRoleTable.swarm_id, ids))
            .orderBy(OpencodeXSwarmRoleTable.swarm_id, OpencodeXSwarmRoleTable.sort_order)
            .all()
            .pipe(Effect.orDie),
          db
            .select()
            .from(OpencodeXSwarmRunTable)
            .where(inArray(OpencodeXSwarmRunTable.swarm_id, ids))
            .orderBy(OpencodeXSwarmRunTable.swarm_id, OpencodeXSwarmRunTable.time_created)
            .all()
            .pipe(Effect.orDie),
          db
            .select()
            .from(OpencodeXSwarmAgentRunTable)
            .where(inArray(OpencodeXSwarmAgentRunTable.swarm_id, ids))
            .orderBy(OpencodeXSwarmAgentRunTable.swarm_id, OpencodeXSwarmAgentRunTable.time_created)
            .all()
            .pipe(Effect.orDie),
          db
            .select()
            .from(OpencodeXSwarmEventTable)
            .where(inArray(OpencodeXSwarmEventTable.swarm_id, ids))
            .orderBy(OpencodeXSwarmEventTable.swarm_id, OpencodeXSwarmEventTable.time_created)
            .all()
            .pipe(Effect.orDie),
        ],
        { concurrency: "unbounded" },
      )
      const rolesBySwarm = Map.groupBy(roles, (row) => row.swarm_id)
      const runsBySwarm = Map.groupBy(runs, (row) => row.swarm_id)
      const agentsBySwarm = Map.groupBy(agentRuns, (row) => row.swarm_id)
      const eventsBySwarm = Map.groupBy(history, (row) => row.swarm_id)
      return swarms.map((swarm) =>
        hydrate({
          swarm,
          roles: rolesBySwarm.get(swarm.id) ?? [],
          runs: runsBySwarm.get(swarm.id) ?? [],
          agentRuns: agentsBySwarm.get(swarm.id) ?? [],
          events: eventsBySwarm.get(swarm.id) ?? [],
        }),
      )
    })

    return ReadService.of({ list, get })
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const stateEvents = yield* EventV2Bridge.Service
    const projects = yield* OpencodeXProject.Service
    const plans = yield* PlanService
    const reader = yield* ReadService
    const jobs = yield* OpencodeXJob.Service
    const background = yield* BackgroundJob.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const scope = yield* Scope.Scope
    const get = reader.get
    const list = reader.list

    const event = Effect.fn("OpencodeXSwarm.event")(function* (
      swarmID: string,
      input: {
        runID?: string
        roleID?: string
        sessionID?: SessionID
        kind: string
        message: string
        metadata?: Record<string, unknown>
      },
    ) {
      const now = Date.now()
      yield* db
        .insert(OpencodeXSwarmEventTable)
        .values({
          id: `oxe_${Identifier.ascending()}`,
          swarm_id: swarmID,
          run_id: input.runID,
          role_id: input.roleID,
          session_id: input.sessionID,
          kind: input.kind,
          message: input.message,
          metadata_json: serializeMetadata(input.metadata),
          time_created: now,
          time_updated: now,
        })
        .run()
        .pipe(Effect.orDie)
      yield* stateEvents.publish(StateEvent.Updated, { swarmID })
    })

    const missingModel = "Select a model for every swarm role or configure a default model."
    const defaultModel = Effect.fn("OpencodeXSwarm.defaultModel")(function* () {
      return yield* provider.defaultModel().pipe(
        Effect.catchTags({
          ProviderModelNotFoundError: () => Effect.fail(new ValidationError({ message: missingModel })),
          ProviderNoModelsError: () => Effect.fail(new ValidationError({ message: missingModel })),
          ProviderNoProvidersError: () => Effect.fail(new ValidationError({ message: missingModel })),
        }),
      )
    })

    const updateSwarmStatus = Effect.fn("OpencodeXSwarm.updateStatus")(function* (
      swarmID: string,
      status: Status,
      message: string,
    ) {
      const current = yield* get(swarmID)
      if (current.status === status || current.status === "cancelled") return
      const now = Date.now()
      yield* db
        .update(OpencodeXSwarmTable)
        .set({
          status,
          completed_at: status === "completed" || status === "failed" ? now : undefined,
          time_updated: now,
        })
        .where(eq(OpencodeXSwarmTable.id, swarmID))
        .run()
        .pipe(Effect.orDie)
      yield* event(swarmID, { kind: `swarm.${status}`, message })
    })

    const updateRunStatus = Effect.fn("OpencodeXSwarm.updateRunStatus")(function* (
      swarmID: string,
      runID: string,
      status: Status,
      message: string,
      sessionID?: SessionID,
    ) {
      const now = Date.now()
      yield* db
        .update(OpencodeXSwarmRunTable)
        .set({
          status,
          result_session_id: status === "completed" ? sessionID : undefined,
          completed_at: status === "completed" || status === "failed" ? now : undefined,
          time_updated: now,
        })
        .where(eq(OpencodeXSwarmRunTable.id, runID))
        .run()
        .pipe(Effect.orDie)
      yield* db
        .update(OpencodeXSwarmTable)
        .set({
          status,
          prompt: (yield* get(swarmID)).runs.find((run) => run.id === runID)?.prompt,
          synthesis_session_id: status === "completed" ? sessionID : undefined,
          completed_at: status === "completed" || status === "failed" ? now : undefined,
          time_updated: now,
        })
        .where(eq(OpencodeXSwarmTable.id, swarmID))
        .run()
        .pipe(Effect.orDie)
      yield* event(swarmID, { runID, sessionID, kind: `swarm.run.${status}`, message })
    })

    const completeIfFinished = Effect.fn("OpencodeXSwarm.completeIfFinished")(function* (swarmID: string) {
      const current = yield* get(swarmID)
      if (current.status === "cancelled") return
      const run = current.runs.toSorted((left, right) => right.timeCreated - left.timeCreated)[0]
      if (!run || ["completed", "failed", "cancelled"].includes(run.status)) return
      const roleJobs = (yield* jobs.list()).filter(
        (job) => job.swarmID === swarmID && job.roleID && job.metadata?.runID === run.id,
      )
      if (roleJobs.length === 0 || roleJobs.some((job) => ["queued", "claimed", "running"].includes(job.status))) return
      if (roleJobs.some((job) => job.status !== "succeeded")) {
        yield* updateRunStatus(swarmID, run.id, "failed", "Swarm finished with failed or interrupted role jobs")
        return
      }
      const synthesisJob = yield* jobs.create({
        kind: "swarm.synthesis",
        title: `${current.title}: Synthesis`,
        source: "swarm",
        projectID: current.projectID,
        parentJobID: roleJobs.find((job) => job.kind === "swarm.orchestrator")?.id,
        swarmID,
        idempotencyKey: `${run.id}:synthesis`,
        maxAttempts: 1,
        timeoutAt: Date.now() + 2 * 60 * 60 * 1_000,
        metadata: { runID: run.id, phase: "synthesis" },
      })
      const owner = swarmJobOwner(run.id, "synthesis")
      const claimed = yield* jobs
        .claim({ jobID: synthesisJob.id, owner, leaseMs: 2 * 60 * 60 * 1_000 })
        .pipe(Effect.option)
      if (Option.isNone(claimed)) return
      yield* jobs.start(synthesisJob.id, owner)
      const project = yield* projects.get(current.projectID).pipe(Effect.orDie)
      const directory = project.folders[0]?.path ?? project.project.worktree
      const defaultAgent = yield* agents.defaultAgent().pipe(Effect.orDie)
      const synthesisModel =
        current.roles.map(selectedRoleModel).find((model) => model !== undefined) ?? (yield* defaultModel())
      const roleOutputs = yield* Effect.forEach(
        current.roles,
        Effect.fnUntraced(function* (role) {
          if (!role.sessionID) return { role, output: "" }
          const messages = yield* sessions.messages({ sessionID: SessionID.make(role.sessionID) }).pipe(Effect.orDie)
          const output = messages
            .filter((message) => message.info.role === "assistant")
            .map(messageText)
            .filter((text) => text.length > 0)
            .at(-1)
          return { role, output: output ?? "" }
        }),
        { concurrency: "unbounded" },
      )
      const synthesis = yield* projects
        .createSession({
          projectID: current.projectID,
          directory,
          title: `${current.title}: Synthesis`,
          agent: defaultAgent,
          model: {
            providerID: synthesisModel.providerID,
            id: synthesisModel.modelID,
          },
          hidden: true,
          metadata: {
            opencodex: {
              swarmID,
              role: "synthesis",
            },
          },
        })
        .pipe(Effect.orDie)
      yield* db
        .update(OpencodeXSwarmTable)
        .set({ synthesis_session_id: synthesis.id, time_updated: Date.now() })
        .where(eq(OpencodeXSwarmTable.id, swarmID))
        .run()
        .pipe(Effect.orDie)
      yield* event(swarmID, {
        sessionID: synthesis.id,
        kind: "swarm.synthesis.started",
        message: "Synthesis session started",
      })
      const synthesized = yield* prompt
        .prompt({
          sessionID: synthesis.id,
          agent: defaultAgent,
          model: synthesisModel,
          parts: [
            {
              type: "text",
              text: synthesisPrompt({ swarm: current, roles: roleOutputs }),
            },
          ],
        })
        .pipe(
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              const message = errorMessage(Cause.squash(cause))
              yield* jobs
                .fail({
                  jobID: synthesisJob.id,
                  owner,
                  failure: { code: "SWARM_SYNTHESIS_FAILED", message },
                })
                .pipe(Effect.ignore)
              yield* event(swarmID, {
                sessionID: synthesis.id,
                kind: "swarm.synthesis.failed",
                message,
              })
              yield* updateRunStatus(swarmID, run.id, "failed", "Swarm synthesis failed", synthesis.id)
              return false
            }),
          ),
        )
      if (!synthesized) return
      yield* jobs.succeed({ jobID: synthesisJob.id, owner, result: { sessionID: synthesis.id } }).pipe(Effect.orDie)
      yield* event(swarmID, {
        sessionID: synthesis.id,
        kind: "swarm.synthesis.completed",
        message: "Synthesis completed",
      })
      yield* updateRunStatus(swarmID, run.id, "completed", "Swarm completed", synthesis.id)
    })

    const create = Effect.fn("OpencodeXSwarm.create")(function* (input: CreateInput) {
      const created = yield* plans.create(input)
      return yield* get(created.id).pipe(Effect.orDie)
    })

    const update = Effect.fn("OpencodeXSwarm.update")(function* (swarmID: string, input: UpdateInput) {
      yield* get(swarmID)
      if (input.roles) {
        const invalid = validateRoles(input.roles)
        if (invalid) return yield* new ValidationError({ message: invalid })
      }
      const now = Date.now()
      yield* db
        .transaction(
          (tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(OpencodeXSwarmTable)
                .set({
                  title: input.title?.trim() || undefined,
                  metadata_json: input.metadata ? serializeMetadata(input.metadata) : undefined,
                  time_updated: now,
                })
                .where(eq(OpencodeXSwarmTable.id, swarmID))
                .run()
              if (!input.roles) return
              yield* tx.delete(OpencodeXSwarmRoleTable).where(eq(OpencodeXSwarmRoleTable.swarm_id, swarmID)).run()
              yield* Effect.forEach(
                input.roles,
                (role, index) =>
                  tx
                    .insert(OpencodeXSwarmRoleTable)
                    .values({
                      id: `swr_${Identifier.ascending()}`,
                      swarm_id: swarmID,
                      name: role.name,
                      agent: role.agent,
                      skill: role.skill,
                      provider_id: role.providerID,
                      model_id: role.modelID,
                      model_profile: role.modelProfile,
                      status: "planned",
                      instructions: role.instructions,
                      sort_order: index,
                      metadata_json: serializeMetadata(role.metadata),
                      time_created: now,
                      time_updated: now,
                    })
                    .run(),
                { discard: true },
              )
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
      yield* event(swarmID, { kind: "swarm.updated", message: "Swarm configuration updated" })
      return yield* get(swarmID)
    })

    const cancelSessionTree: (sessionID: string) => Effect.Effect<void> = Effect.fn("OpencodeXSwarm.cancelSessionTree")(
      function* (sessionID: string) {
        const id = SessionID.make(sessionID)
        yield* prompt.cancel(id).pipe(Effect.ignore)
        const backgroundJobs = yield* background.list()
        yield* Effect.forEach(
          backgroundJobs.filter((job) => {
            if (job.status !== "running") return false
            if (job.id === sessionID) return true
            if (job.metadata?.sessionId === sessionID) return true
            return job.metadata?.parentSessionId === sessionID
          }),
          (job) => background.cancel(job.id),
          { concurrency: "unbounded", discard: true },
        )
        const children = yield* sessions.children(id).pipe(Effect.catchCause(() => Effect.succeed([])))
        yield* Effect.forEach(children, (child) => cancelSessionTree(child.id), {
          concurrency: "unbounded",
          discard: true,
        })
      },
    )

    const executeWorker = Effect.fn("OpencodeXSwarm.executeWorker")(function* (input: {
      swarm: Info
      runID: string
      role: Role
      jobID: string
      agentRunID: string
      directory: string
      coordination?: string
      variant?: string
    }) {
      const owner = swarmJobOwner(input.runID, input.role.id)
      const claimed = yield* jobs.claim({ jobID: input.jobID, owner, leaseMs: 2 * 60 * 60 * 1_000 }).pipe(Effect.option)
      if (Option.isNone(claimed)) return
      yield* jobs.start(input.jobID, owner).pipe(Effect.orDie)
      const execution = Effect.gen(function* () {
        const model = selectedRoleModel(input.role) ?? (yield* defaultModel())
        const agent = input.role.agent
          ? yield* agents.get(input.role.agent).pipe(
              Effect.as(input.role.agent),
              Effect.catchCause(() => agents.defaultAgent().pipe(Effect.orDie)),
            )
          : yield* agents.defaultAgent().pipe(Effect.orDie)
        const session = yield* projects
          .createSession({
            projectID: input.swarm.projectID,
            directory: input.directory,
            title: `${input.swarm.title}: ${input.role.name}`,
            agent,
            model: {
              providerID: model.providerID,
              id: model.modelID,
              ...(input.variant ? { variant: input.variant } : {}),
            },
            hidden: true,
            metadata: {
              opencodex: {
                swarmID: input.swarm.id,
                runID: input.runID,
                roleID: input.role.id,
                role: input.role.skill ?? input.role.name,
              },
            },
          })
          .pipe(Effect.orDie)
        yield* jobs.update({ id: input.jobID, sessionID: session.id }).pipe(Effect.orDie)
        yield* Effect.all(
          [
            db
              .update(OpencodeXSwarmAgentRunTable)
              .set({ status: "running", session_id: session.id, started_at: Date.now(), time_updated: Date.now() })
              .where(eq(OpencodeXSwarmAgentRunTable.id, input.agentRunID))
              .run()
              .pipe(Effect.orDie),
            db
              .update(OpencodeXSwarmRoleTable)
              .set({ status: "running", session_id: session.id, job_id: input.jobID, time_updated: Date.now() })
              .where(eq(OpencodeXSwarmRoleTable.id, input.role.id))
              .run()
              .pipe(Effect.orDie),
          ],
          { concurrency: "unbounded", discard: true },
        )
        yield* event(input.swarm.id, {
          runID: input.runID,
          roleID: input.role.id,
          sessionID: session.id,
          kind: "swarm.role.started",
          message: `${input.role.name} job started`,
        })
        yield* prompt.prompt({
          sessionID: session.id,
          agent,
          model,
          variant: input.variant,
          parts: [
            {
              type: "text",
              text: rolePrompt({ swarm: input.swarm, role: input.role, coordination: input.coordination }),
            },
          ],
        })
        yield* jobs.succeed({ jobID: input.jobID, owner, result: { sessionID: session.id } }).pipe(Effect.orDie)
        yield* Effect.all(
          [
            db
              .update(OpencodeXSwarmAgentRunTable)
              .set({ status: "completed", completed_at: Date.now(), time_updated: Date.now() })
              .where(eq(OpencodeXSwarmAgentRunTable.id, input.agentRunID))
              .run()
              .pipe(Effect.orDie),
            db
              .update(OpencodeXSwarmRoleTable)
              .set({ status: "completed", time_updated: Date.now() })
              .where(eq(OpencodeXSwarmRoleTable.id, input.role.id))
              .run()
              .pipe(Effect.orDie),
          ],
          { concurrency: "unbounded", discard: true },
        )
        yield* event(input.swarm.id, {
          runID: input.runID,
          roleID: input.role.id,
          sessionID: session.id,
          kind: "swarm.role.completed",
          message: `${input.role.name} job completed`,
        })
      })
      yield* execution.pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            const message = errorMessage(Cause.squash(cause))
            const cancelled = (yield* jobs.get(input.jobID)).status === "cancelled"
            if (!cancelled) {
              yield* jobs
                .fail({
                  jobID: input.jobID,
                  owner,
                  failure: { code: "SWARM_ROLE_FAILED", message },
                })
                .pipe(Effect.ignore)
            }
            yield* Effect.all(
              [
                db
                  .update(OpencodeXSwarmAgentRunTable)
                  .set({
                    status: cancelled ? "cancelled" : "failed",
                    completed_at: Date.now(),
                    time_updated: Date.now(),
                  })
                  .where(eq(OpencodeXSwarmAgentRunTable.id, input.agentRunID))
                  .run()
                  .pipe(Effect.orDie),
                db
                  .update(OpencodeXSwarmRoleTable)
                  .set({ status: cancelled ? "cancelled" : "failed", time_updated: Date.now() })
                  .where(eq(OpencodeXSwarmRoleTable.id, input.role.id))
                  .run()
                  .pipe(Effect.orDie),
              ],
              { concurrency: "unbounded", discard: true },
            )
            yield* event(input.swarm.id, {
              runID: input.runID,
              roleID: input.role.id,
              kind: cancelled ? "swarm.role.cancelled" : "swarm.role.failed",
              message,
            })
          }),
        ),
      )
      yield* completeIfFinished(input.swarm.id)
    })

    const createRun = Effect.fn("OpencodeXSwarm.createRun")(function* (
      swarmID: string,
      input: { prompt: string; agent?: string; mode?: "build" | "plan"; variant?: string },
    ) {
      const swarm = yield* get(swarmID)
      if (swarm.status === "cancelled")
        return yield* new ValidationError({ message: "Cancelled swarms cannot run tasks." })
      const invalid = validateRoles(swarm.roles)
      if (invalid) return yield* new ValidationError({ message: invalid })
      const orchestrator = swarm.roles.find((role) => isOrchestratorRole(role))
      if (!orchestrator) return yield* new ValidationError({ message: "A swarm requires an Orchestrator role." })
      const project = yield* projects.get(swarm.projectID).pipe(Effect.orDie)
      const directory = project.folders[0]?.path ?? project.project.worktree
      const runID = `swrn_${Identifier.ascending()}`
      const now = Date.now()
      const mode = executionMode(input)
      const model = selectedRoleModel(orchestrator) ?? (yield* defaultModel())
      const requestedAgent = input.agent
        ? yield* agents.get(input.agent).pipe(
            Effect.as(input.agent),
            Effect.catchCause(() => Effect.succeed(undefined)),
          )
        : undefined
      const orchestratorAgent =
        requestedAgent ?? orchestrator.agent ?? (yield* agents.defaultAgent().pipe(Effect.orDie))
      const orchestratorJob = yield* jobs.create({
        kind: "swarm.orchestrator",
        title: `${swarm.title}: Orchestrator`,
        source: "swarm",
        projectID: swarm.projectID,
        swarmID,
        roleID: orchestrator.id,
        idempotencyKey: `${runID}:${orchestrator.id}`,
        maxAttempts: 1,
        timeoutAt: now + 2 * 60 * 60 * 1_000,
        metadata: { runID, phase: "orchestrator" },
      })
      const workerPlans = yield* Effect.forEach(
        swarm.roles.filter((role) => role.id !== orchestrator.id),
        Effect.fnUntraced(function* (role) {
          const job = yield* jobs.create({
            kind: "swarm.worker",
            title: `${swarm.title}: ${role.name}`,
            source: "swarm",
            projectID: swarm.projectID,
            parentJobID: orchestratorJob.id,
            swarmID,
            roleID: role.id,
            idempotencyKey: `${runID}:${role.id}`,
            maxAttempts: 1,
            timeoutAt: now + 2 * 60 * 60 * 1_000,
            metadata: { runID, phase: "worker" },
          })
          return { role, job, agentRunID: `swar_${Identifier.ascending()}` }
        }),
        { concurrency: 1 },
      )
      const orchestratorRunID = `swar_${Identifier.ascending()}`
      const session = yield* projects
        .createSession({
          projectID: swarm.projectID,
          directory,
          title: `${swarm.title}: ${defaultTitle(input.prompt)}`,
          agent: orchestratorAgent,
          model: {
            providerID: model.providerID,
            id: model.modelID,
            ...(input.variant ? { variant: input.variant } : {}),
          },
          hidden: true,
          metadata: {
            opencodex: {
              swarmID,
              runID,
              roleID: orchestrator.id,
              role: "orchestrator",
            },
          },
        })
        .pipe(Effect.orDie)
      yield* jobs.update({ id: orchestratorJob.id, sessionID: session.id }).pipe(Effect.orDie)
      yield* db
        .transaction(
          (tx) =>
            Effect.gen(function* () {
              yield* tx
                .insert(OpencodeXSwarmRunTable)
                .values({
                  id: runID,
                  swarm_id: swarmID,
                  opencodex_project_id: swarm.projectID,
                  title: defaultTitle(input.prompt),
                  prompt: input.prompt,
                  status: "running",
                  source: "swarm",
                  orchestrator_session_id: session.id,
                  started_at: now,
                  metadata_json: serializeMetadata({ orchestratorRoleID: orchestrator.id, executionMode: mode }),
                  time_created: now,
                  time_updated: now,
                })
                .run()
              yield* tx
                .update(OpencodeXSwarmTable)
                .set({
                  title: swarm.title === "New swarm" ? defaultTitle(input.prompt) : undefined,
                  prompt: input.prompt,
                  status: "running",
                  started_at: swarm.startedAt ?? now,
                  completed_at: undefined,
                  synthesis_session_id: undefined,
                  time_updated: now,
                })
                .where(eq(OpencodeXSwarmTable.id, swarmID))
                .run()
              yield* tx
                .insert(OpencodeXSwarmAgentRunTable)
                .values({
                  id: orchestratorRunID,
                  run_id: runID,
                  swarm_id: swarmID,
                  role_id: orchestrator.id,
                  status: "queued",
                  prompt: input.prompt,
                  session_id: session.id,
                  job_id: orchestratorJob.id,
                  time_created: now,
                  time_updated: now,
                })
                .run()
              yield* Effect.forEach(
                workerPlans,
                (plan) =>
                  tx
                    .insert(OpencodeXSwarmAgentRunTable)
                    .values({
                      id: plan.agentRunID,
                      run_id: runID,
                      swarm_id: swarmID,
                      role_id: plan.role.id,
                      status: "queued",
                      prompt: input.prompt,
                      job_id: plan.job.id,
                      time_created: now,
                      time_updated: now,
                    })
                    .run(),
                { discard: true },
              )
              yield* Effect.forEach(
                [{ role: orchestrator, job: orchestratorJob }, ...workerPlans],
                (plan) =>
                  tx
                    .update(OpencodeXSwarmRoleTable)
                    .set({
                      status: "queued",
                      session_id: plan.role.id === orchestrator.id ? session.id : null,
                      job_id: plan.job.id,
                      time_updated: now,
                    })
                    .where(eq(OpencodeXSwarmRoleTable.id, plan.role.id))
                    .run(),
                { discard: true },
              )
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
      const owner = swarmJobOwner(runID, orchestrator.id)
      yield* jobs.claim({ jobID: orchestratorJob.id, owner, leaseMs: 2 * 60 * 60 * 1_000 }).pipe(Effect.orDie)
      yield* jobs.start(orchestratorJob.id, owner).pipe(Effect.orDie)
      yield* Effect.all(
        [
          db
            .update(OpencodeXSwarmAgentRunTable)
            .set({ status: "running", started_at: Date.now(), time_updated: Date.now() })
            .where(eq(OpencodeXSwarmAgentRunTable.id, orchestratorRunID))
            .run()
            .pipe(Effect.orDie),
          db
            .update(OpencodeXSwarmRoleTable)
            .set({ status: "running", time_updated: Date.now() })
            .where(eq(OpencodeXSwarmRoleTable.id, orchestrator.id))
            .run()
            .pipe(Effect.orDie),
        ],
        { concurrency: "unbounded", discard: true },
      )
      const run = (yield* get(swarmID)).runs.find((item) => item.id === runID)
      if (!run) return yield* Effect.die(`Swarm run was not persisted: ${runID}`)
      yield* event(swarmID, {
        runID,
        roleID: orchestrator.id,
        sessionID: session.id,
        kind: "swarm.run.started",
        message: "Orchestrator run started",
      })
      yield* Effect.gen(function* () {
        yield* prompt.prompt({
          sessionID: session.id,
          agent: orchestratorAgent,
          model,
          variant: input.variant,
          parts: [
            {
              type: "text",
              text: orchestratorRunPrompt({ swarm, run, orchestrator, roles: swarm.roles, mode }),
            },
          ],
        })
        yield* jobs.succeed({ jobID: orchestratorJob.id, owner, result: { sessionID: session.id } }).pipe(Effect.orDie)
        yield* Effect.all(
          [
            db
              .update(OpencodeXSwarmAgentRunTable)
              .set({ status: "completed", completed_at: Date.now(), time_updated: Date.now() })
              .where(eq(OpencodeXSwarmAgentRunTable.id, orchestratorRunID))
              .run()
              .pipe(Effect.orDie),
            db
              .update(OpencodeXSwarmRoleTable)
              .set({ status: "completed", time_updated: Date.now() })
              .where(eq(OpencodeXSwarmRoleTable.id, orchestrator.id))
              .run()
              .pipe(Effect.orDie),
          ],
          { concurrency: "unbounded", discard: true },
        )
        yield* event(swarmID, {
          runID,
          roleID: orchestrator.id,
          sessionID: session.id,
          kind: "swarm.run.turn.completed",
          message: "Orchestrator turn completed",
        })
        const messages = yield* sessions.messages({ sessionID: session.id }).pipe(Effect.orDie)
        const coordination = messages
          .filter((message) => message.info.role === "assistant")
          .map(messageText)
          .filter((text) => text.length > 0)
          .at(-1)
        yield* Effect.forEach(
          workerPlans,
          (plan) =>
            executeWorker({
              swarm: { ...swarm, prompt: input.prompt },
              runID,
              role: plan.role,
              jobID: plan.job.id,
              agentRunID: plan.agentRunID,
              directory,
              coordination,
              variant: input.variant,
            }),
          { concurrency: "unbounded", discard: true },
        )
        yield* completeIfFinished(swarmID)
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            const message = errorMessage(Cause.squash(cause))
            yield* jobs
              .fail({
                jobID: orchestratorJob.id,
                owner,
                failure: { code: "SWARM_ORCHESTRATOR_FAILED", message },
              })
              .pipe(Effect.ignore)
            yield* Effect.forEach(workerPlans, (plan) => jobs.cancel(plan.job.id).pipe(Effect.ignore), {
              concurrency: "unbounded",
              discard: true,
            })
            const failedAt = Date.now()
            yield* Effect.all(
              [
                db
                  .update(OpencodeXSwarmAgentRunTable)
                  .set({ status: "failed", completed_at: failedAt, time_updated: failedAt })
                  .where(eq(OpencodeXSwarmAgentRunTable.id, orchestratorRunID))
                  .run()
                  .pipe(Effect.orDie),
                db
                  .update(OpencodeXSwarmAgentRunTable)
                  .set({ status: "cancelled", completed_at: failedAt, time_updated: failedAt })
                  .where(
                    inArray(
                      OpencodeXSwarmAgentRunTable.id,
                      workerPlans.map((plan) => plan.agentRunID),
                    ),
                  )
                  .run()
                  .pipe(Effect.orDie),
                db
                  .update(OpencodeXSwarmRoleTable)
                  .set({ status: "failed", time_updated: failedAt })
                  .where(eq(OpencodeXSwarmRoleTable.id, orchestrator.id))
                  .run()
                  .pipe(Effect.orDie),
                db
                  .update(OpencodeXSwarmRoleTable)
                  .set({ status: "cancelled", time_updated: failedAt })
                  .where(
                    inArray(
                      OpencodeXSwarmRoleTable.id,
                      workerPlans.map((plan) => plan.role.id),
                    ),
                  )
                  .run()
                  .pipe(Effect.orDie),
              ],
              { concurrency: "unbounded", discard: true },
            )
            yield* event(swarmID, {
              runID,
              roleID: orchestrator.id,
              sessionID: session.id,
              kind: "swarm.run.failed",
              message,
            })
            yield* updateRunStatus(swarmID, runID, "failed", "Orchestrator run failed", session.id)
          }),
        ),
        Effect.forkIn(scope, { startImmediately: true }),
      )
      return yield* get(swarmID)
    })

    const start = Effect.fn("OpencodeXSwarm.start")(function* (swarmID: string) {
      const swarm = yield* get(swarmID)
      const planned = swarm.runs.find((run) => run.status === "planned")
      if (planned) return yield* createRun(swarmID, { prompt: planned.prompt })
      if (!swarm.prompt.trim())
        return yield* new ValidationError({ message: "Assign a task before starting this swarm." })
      return yield* createRun(swarmID, { prompt: swarm.prompt })
    })

    const assignTask = Effect.fn("OpencodeXSwarm.assignTask")(function* (swarmID: string, input: AssignTaskInput) {
      const promptText = input.prompt.trim()
      if (!promptText) return yield* new ValidationError({ message: "Swarm run prompt cannot be empty." })
      yield* event(swarmID, { kind: "swarm.task.assigned", message: "Task assigned to swarm team" })
      return yield* createRun(swarmID, {
        prompt: promptText,
        agent: input.agent,
        mode: input.mode,
        variant: input.variant,
      })
    })

    const cancel = Effect.fn("OpencodeXSwarm.cancel")(function* (swarmID: string) {
      const swarm = yield* get(swarmID)
      const now = Date.now()
      yield* db
        .update(OpencodeXSwarmTable)
        .set({ status: "cancelled", completed_at: now, time_updated: now })
        .where(eq(OpencodeXSwarmTable.id, swarmID))
        .run()
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        swarm.runs.filter((run) => run.status !== "completed" && run.status !== "cancelled"),
        (run) =>
          Effect.gen(function* () {
            if (run.orchestratorSessionID) yield* cancelSessionTree(run.orchestratorSessionID)
            yield* Effect.forEach(
              run.agents.filter((agentRun) => agentRun.status !== "completed" && agentRun.status !== "cancelled"),
              (agentRun) =>
                Effect.gen(function* () {
                  if (agentRun.sessionID) yield* cancelSessionTree(agentRun.sessionID)
                  if (agentRun.jobID) yield* jobs.cancel(agentRun.jobID).pipe(Effect.ignore)
                  yield* db
                    .update(OpencodeXSwarmAgentRunTable)
                    .set({ status: "cancelled", completed_at: Date.now(), time_updated: Date.now() })
                    .where(eq(OpencodeXSwarmAgentRunTable.id, agentRun.id))
                    .run()
                    .pipe(Effect.orDie)
                }),
              { concurrency: "unbounded", discard: true },
            )
            yield* db
              .update(OpencodeXSwarmRunTable)
              .set({ status: "cancelled", completed_at: Date.now(), time_updated: Date.now() })
              .where(eq(OpencodeXSwarmRunTable.id, run.id))
              .run()
              .pipe(Effect.orDie)
          }),
        { concurrency: "unbounded", discard: true },
      )
      yield* Effect.forEach(
        swarm.roles.filter((role) => role.status !== "completed" && role.status !== "cancelled"),
        (role) =>
          Effect.gen(function* () {
            if (role.sessionID) yield* cancelSessionTree(role.sessionID)
            yield* db
              .update(OpencodeXSwarmRoleTable)
              .set({ status: "cancelled", time_updated: Date.now() })
              .where(eq(OpencodeXSwarmRoleTable.id, role.id))
              .run()
              .pipe(Effect.orDie)
          }),
        { concurrency: "unbounded", discard: true },
      )
      yield* Effect.forEach(
        (yield* jobs.list()).filter((job) => job.swarmID === swarmID),
        (job) => jobs.cancel(job.id).pipe(Effect.ignore),
        { concurrency: "unbounded", discard: true },
      )
      yield* event(swarmID, { kind: "swarm.cancelled", message: "Swarm cancelled" })
      return yield* get(swarmID)
    })

    const remove = Effect.fn("OpencodeXSwarm.remove")(function* (swarmID: string) {
      const swarm = yield* get(swarmID)
      yield* Effect.forEach(
        swarm.runs,
        (run) =>
          Effect.gen(function* () {
            if (run.orchestratorSessionID) yield* cancelSessionTree(run.orchestratorSessionID)
            yield* Effect.forEach(
              run.agents,
              (agentRun) =>
                Effect.gen(function* () {
                  if (agentRun.sessionID) yield* cancelSessionTree(agentRun.sessionID)
                  if (agentRun.jobID) yield* jobs.cancel(agentRun.jobID).pipe(Effect.ignore)
                }),
              { concurrency: "unbounded", discard: true },
            )
          }),
        { concurrency: "unbounded", discard: true },
      )
      yield* Effect.forEach(
        swarm.roles.filter((role) => role.status !== "completed" && role.status !== "cancelled"),
        (role) =>
          Effect.gen(function* () {
            if (role.sessionID) yield* cancelSessionTree(role.sessionID)
          }),
        { concurrency: "unbounded", discard: true },
      )
      yield* Effect.forEach(
        (yield* jobs.list()).filter((job) => job.swarmID === swarmID),
        (job) => jobs.cancel(job.id).pipe(Effect.ignore),
        { concurrency: "unbounded", discard: true },
      )
      yield* db.delete(OpencodeXSwarmTable).where(eq(OpencodeXSwarmTable.id, swarmID)).run().pipe(Effect.orDie)
      yield* stateEvents.publish(StateEvent.Deleted, { swarmID })
      return true
    })

    const addRole = Effect.fn("OpencodeXSwarm.addRole")(function* (swarmID: string, input: AddRoleInput) {
      const swarm = yield* get(swarmID)
      const invalid = validateRoles([...swarm.roles, input.role])
      if (invalid) return yield* new ValidationError({ message: invalid })
      const now = Date.now()
      yield* db
        .insert(OpencodeXSwarmRoleTable)
        .values({
          id: `swr_${Identifier.ascending()}`,
          swarm_id: swarmID,
          name: input.role.name,
          agent: input.role.agent,
          skill: input.role.skill,
          provider_id: input.role.providerID,
          model_id: input.role.modelID,
          model_profile: input.role.modelProfile,
          status: "planned",
          instructions: input.role.instructions,
          sort_order: swarm.roles.length,
          metadata_json: serializeMetadata(input.role.metadata),
          time_created: now,
          time_updated: now,
        })
        .run()
        .pipe(Effect.orDie)
      yield* event(swarmID, { kind: "swarm.role.added", message: `${input.role.name} added` })
      return yield* get(swarmID)
    })

    const updateRole = Effect.fn("OpencodeXSwarm.updateRole")(function* (
      swarmID: string,
      roleID: string,
      input: UpdateRoleInput,
    ) {
      const swarm = yield* get(swarmID)
      if (!swarm.roles.some((role) => role.id === roleID)) return yield* new RoleNotFoundError({ swarmID, roleID })
      const invalid = validateRoles(
        swarm.roles.map((role) =>
          role.id === roleID
            ? {
                ...role,
                name: input.name ?? role.name,
                instructions: input.instructions ?? role.instructions,
              }
            : role,
        ),
      )
      if (invalid) return yield* new ValidationError({ message: invalid })
      yield* db
        .update(OpencodeXSwarmRoleTable)
        .set({
          name: input.name,
          agent: input.agent,
          skill: input.skill,
          provider_id: input.providerID,
          model_id: input.modelID,
          model_profile: input.modelProfile,
          instructions: input.instructions,
          metadata_json: serializeMetadata(input.metadata),
          time_updated: Date.now(),
        })
        .where(eq(OpencodeXSwarmRoleTable.id, roleID))
        .run()
        .pipe(Effect.orDie)
      yield* event(swarmID, { roleID, kind: "swarm.role.updated", message: "Role updated" })
      return yield* get(swarmID)
    })

    const reconcileInterruptedRuns = Effect.fn("OpencodeXSwarm.reconcileInterruptedRuns")(function* () {
      const [swarms, jobList] = yield* Effect.all([list(), jobs.list()], { concurrency: "unbounded" })
      yield* Effect.forEach(
        swarms.flatMap((swarm) =>
          swarm.runs.filter((run) => ["queued", "running"].includes(run.status)).map((run) => ({ swarm, run })),
        ),
        ({ swarm, run }) => {
          const related = jobList.filter((job) => job.swarmID === swarm.id && job.metadata?.runID === run.id)
          if (related.length === 0 || related.some((job) => ["claimed", "running"].includes(job.status)))
            return Effect.void
          const synthesis = related.find((job) => job.kind === "swarm.synthesis" && job.status === "succeeded")
          if (synthesis) {
            const sessionID =
              synthesis.result && typeof synthesis.result.sessionID === "string"
                ? SessionID.make(synthesis.result.sessionID)
                : undefined
            return updateRunStatus(swarm.id, run.id, "completed", "Recovered completed swarm run", sessionID)
          }
          return updateRunStatus(swarm.id, run.id, "failed", "Interrupted swarm run requires an explicit retry")
        },
        { concurrency: 1, discard: true },
      )
    })

    yield* reconcileInterruptedRuns().pipe(Effect.catchTag("OpencodeX.Swarm.NotFoundError", () => Effect.void))

    return Service.of({ list, get, create, update, start, assignTask, cancel, remove, addRole, updateRole })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Agent.defaultLayer),
    Layer.provide(BackgroundJob.defaultLayer),
    Layer.provide(Database.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(OpencodeXJob.defaultLayer),
    Layer.provide(OpencodeXProject.defaultLayer),
    Layer.provide(readLayer.pipe(Layer.provide(Database.defaultLayer))),
    Layer.provide(
      planLayer.pipe(
        Layer.provide(Database.defaultLayer),
        Layer.provide(EventV2Bridge.defaultLayer),
        Layer.provide(OpencodeXProject.defaultLayer),
      ),
    ),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionPrompt.defaultLayer),
  ),
)

export * as OpencodeXSwarm from "./swarm"

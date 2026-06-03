import {
  OpencodeXSwarmAgentRunTable,
  OpencodeXSwarmEventTable,
  OpencodeXSwarmRoleTable,
  OpencodeXSwarmRunTable,
  OpencodeXSwarmTable,
} from "@opencode-ai/core/opencodex/sql"
import { Database } from "@opencode-ai/core/database/database"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Identifier } from "@opencode-ai/core/util/identifier"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXProject } from "@/opencodex/project"
import { Project } from "@/project/project"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionPrompt } from "@/session/prompt"
import { Cause, Context, Effect, Layer, Scope, Schema, Types } from "effect"
import { eq } from "drizzle-orm"

const Metadata = Schema.Record(Schema.String, Schema.Unknown)
const decodeMetadata = Schema.decodeUnknownSync(Schema.fromJsonString(Metadata))

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
export type Event = Types.DeepMutable<Schema.Schema.Type<typeof Event>>

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
export type Role = Types.DeepMutable<Schema.Schema.Type<typeof Role>>

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
export type AgentRun = Types.DeepMutable<Schema.Schema.Type<typeof AgentRun>>

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
export type Run = Types.DeepMutable<Schema.Schema.Type<typeof Run>>

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
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

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
export type RoleInput = Types.DeepMutable<Schema.Schema.Type<typeof RoleInput>>

export const CreateInput = Schema.Struct({
  projectID: Schema.String,
  title: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  source: Schema.optional(OpencodeXJob.Source),
  createdBy: Schema.optional(Schema.String),
  roles: Schema.optional(Schema.Array(RoleInput)),
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXSwarmCreateInput" })
export type CreateInput = Types.DeepMutable<Schema.Schema.Type<typeof CreateInput>>

export const UpdateInput = Schema.Struct({
  title: Schema.optional(Schema.String),
  roles: Schema.optional(Schema.Array(RoleInput)),
  metadata: Schema.optional(Metadata),
}).annotate({ identifier: "OpencodeXSwarmUpdateInput" })
export type UpdateInput = Types.DeepMutable<Schema.Schema.Type<typeof UpdateInput>>

export const AssignTaskInput = Schema.Struct({
  prompt: Schema.String,
  agent: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
}).annotate({ identifier: "OpencodeXSwarmAssignTaskInput" })
export type AssignTaskInput = Types.DeepMutable<Schema.Schema.Type<typeof AssignTaskInput>>

export const AddRoleInput = Schema.Struct({
  role: RoleInput,
}).annotate({ identifier: "OpencodeXSwarmAddRoleInput" })
export type AddRoleInput = Types.DeepMutable<Schema.Schema.Type<typeof AddRoleInput>>

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
export type UpdateRoleInput = Types.DeepMutable<Schema.Schema.Type<typeof UpdateRoleInput>>

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("OpencodeX.Swarm.NotFoundError", {
  swarmID: Schema.String,
}) {}

export class RoleNotFoundError extends Schema.TaggedErrorClass<RoleNotFoundError>()("OpencodeX.Swarm.RoleNotFoundError", {
  swarmID: Schema.String,
  roleID: Schema.String,
}) {}

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

function serializeMetadata(metadata: Record<string, unknown> | undefined) {
  return metadata ? JSON.stringify(metadata) : undefined
}

function defaultTitle(prompt?: string) {
  const firstLine = prompt?.trim().split(/\r?\n/)[0] ?? "New swarm"
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine || "New swarm"
}

function defaultRoles(prompt?: string): RoleInput[] {
  const task = prompt?.trim()
  return [
    {
      name: "Orchestrator",
      skill: "orchestrator",
      instructions: task
        ? `Coordinate the swarm, identify dependencies between roles, and produce a handoff that explains how the role outputs should be combined for this request:\n\n${task}`
        : "Coordinate the swarm, identify dependencies between roles, and produce a final handoff for assigned tasks.",
    },
    {
      name: "Product Manager",
      skill: "product-manager",
      instructions: task
        ? `Clarify the product goal, user workflows, acceptance criteria, and tradeoffs for this request:\n\n${task}`
        : "Clarify the product goal, user workflows, acceptance criteria, and tradeoffs for assigned tasks.",
    },
    {
      name: "Architect",
      skill: "architect",
      instructions: task
        ? `Identify the technical design, integration points, data flow, and implementation risks for this request:\n\n${task}`
        : "Identify the technical design, integration points, data flow, and implementation risks for assigned tasks.",
    },
    {
      name: "Senior Engineer",
      skill: "senior-engineer",
      instructions: task
        ? `Plan or implement the engineering work for this request, using architect and PM handoffs when available:\n\n${task}`
        : "Plan or implement engineering work for assigned tasks, using architect and PM handoffs when available.",
    },
    {
      name: "QA Engineer",
      skill: "qa-engineer",
      instructions: task
        ? `Define validation strategy, edge cases, and regression risks for this request:\n\n${task}`
        : "Define validation strategy, edge cases, and regression risks for assigned tasks.",
    },
    {
      name: "Code Reviewer",
      skill: "code-reviewer",
      instructions: task
        ? `Review completed or proposed work for correctness, maintainability, regressions, and missing validation:\n\n${task}`
        : "Review completed or proposed work for correctness, maintainability, regressions, and missing validation on assigned tasks.",
    },
  ]
}

function isOrchestratorRole(role: RoleInput) {
  return role.skill === "orchestrator" || role.name.trim().toLowerCase() === "orchestrator"
}

function validateRoles(roles: RoleInput[]) {
  if (roles.length < 2) return "A swarm requires at least two agents: one Orchestrator and one other role."
  if (roles.length > 10) return "A swarm can run at most 10 agents."
  if (!isOrchestratorRole(roles[0]!)) {
    return "A swarm requires the first role to be the Orchestrator."
  }
  if (!roles.some((role) => !isOrchestratorRole(role))) {
    return "A swarm requires at least one non-Orchestrator role."
  }
  if (roles.some((role) => role.name.trim().length === 0)) return "Every swarm role needs a name."
  if (roles.some((role) => role.instructions.trim().length === 0)) return "Every swarm role needs instructions."
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
    status: row.status as RoleStatus,
    instructions: row.instructions,
    sortOrder: row.sort_order,
    sessionID: row.session_id ?? undefined,
    jobID: row.job_id ?? undefined,
    metadata: row.metadata_json ? decodeMetadata(row.metadata_json) : undefined,
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
    metadata: row.metadata_json ? decodeMetadata(row.metadata_json) : undefined,
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
    status: row.status as RoleStatus,
    prompt: row.prompt,
    sessionID: row.session_id ?? undefined,
    jobID: row.job_id ?? undefined,
    metadata: row.metadata_json ? decodeMetadata(row.metadata_json) : undefined,
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
    status: row.status as Status,
    source: row.source as OpencodeXJob.Source,
    orchestratorSessionID: row.orchestrator_session_id ?? undefined,
    resultSessionID: row.result_session_id ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    metadata: row.metadata_json ? decodeMetadata(row.metadata_json) : undefined,
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
    status: latestRun?.status ?? (input.swarm.status as Status),
    source: input.swarm.source as OpencodeXJob.Source,
    createdBy: input.swarm.created_by ?? undefined,
    synthesisSessionID: latestRun?.resultSessionID ?? input.swarm.synthesis_session_id ?? undefined,
    startedAt: latestRun?.startedAt ?? input.swarm.started_at ?? undefined,
    completedAt: latestRun?.completedAt ?? input.swarm.completed_at ?? undefined,
    metadata: input.swarm.metadata_json ? decodeMetadata(input.swarm.metadata_json) : undefined,
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

function rolePrompt(input: { swarm: Info; role: Role }) {
  const skill = input.role.skill ? `Use the "${input.role.skill}" role skill if it is available.` : undefined
  return [
    `You are running as the "${input.role.name}" role in an OpencodeX swarm.`,
    "",
    "Swarm goal:",
    input.swarm.prompt,
    "",
    "Role instructions:",
    input.role.instructions,
    "",
    skill,
    "Work independently and produce a concise handoff for the rest of the swarm.",
    "Do not wait for other roles unless your role instructions explicitly require it.",
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

function orchestratorRunPrompt(input: { swarm: Info; run: Run; orchestrator: Role; roles: Role[] }) {
  return [
    `You are the "${input.orchestrator.name}" orchestrator for an OpencodeX swarm team.`,
    "",
    "The user can only query you. Specialist agents are private workers behind you.",
    "Break the request into role-specific prompts, delegate only to the team members needed, relay useful findings between workers, and synthesize the final answer for the user.",
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
    "",
    "Use the task tool to start private worker sessions for specific team members.",
    'When a role does not specify an agent, use the "general" subagent and include that role\'s instructions in the prompt.',
    "Use background=true for independent work when that option is available; otherwise use foreground delegation for the most important worker first.",
    "Do not tell the user to inspect worker sessions. Summarize worker findings yourself.",
    "",
    "When complete, provide:",
    "Decision summary:",
    "Work completed:",
    "Key role findings:",
    "Risks:",
    "Open questions:",
    "Recommended next action:",
    "Artifacts:",
  ].join("\n")
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

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const projects = yield* OpencodeXProject.Service
    const jobs = yield* OpencodeXJob.Service
    const background = yield* BackgroundJob.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const scope = yield* Scope.Scope

    const event = Effect.fn("OpencodeXSwarm.event")(function* (
      swarmID: string,
      input: {
        runID?: string
        roleID?: string
        sessionID?: string
        kind: string
        message: string
        metadata?: Record<string, unknown>
      },
    ) {
      const now = Date.now()
      return yield* db
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

    const get = Effect.fn("OpencodeXSwarm.get")(function* (swarmID: string) {
      const swarm = yield* db
        .select()
        .from(OpencodeXSwarmTable)
        .where(eq(OpencodeXSwarmTable.id, swarmID))
        .get()
        .pipe(Effect.orDie)
      if (!swarm) return yield* new NotFoundError({ swarmID })
      const roles = yield* db
        .select()
        .from(OpencodeXSwarmRoleTable)
        .where(eq(OpencodeXSwarmRoleTable.swarm_id, swarmID))
        .orderBy(OpencodeXSwarmRoleTable.sort_order, OpencodeXSwarmRoleTable.time_created)
        .all()
        .pipe(Effect.orDie)
      const runs = yield* db
        .select()
        .from(OpencodeXSwarmRunTable)
        .where(eq(OpencodeXSwarmRunTable.swarm_id, swarmID))
        .orderBy(OpencodeXSwarmRunTable.time_created)
        .all()
        .pipe(Effect.orDie)
      const agentRuns = yield* db
        .select()
        .from(OpencodeXSwarmAgentRunTable)
        .where(eq(OpencodeXSwarmAgentRunTable.swarm_id, swarmID))
        .orderBy(OpencodeXSwarmAgentRunTable.time_created)
        .all()
        .pipe(Effect.orDie)
      const events = yield* db
        .select()
        .from(OpencodeXSwarmEventTable)
        .where(eq(OpencodeXSwarmEventTable.swarm_id, swarmID))
        .orderBy(OpencodeXSwarmEventTable.time_created)
        .all()
        .pipe(Effect.orDie)
      return hydrate({ swarm, roles, runs, agentRuns, events })
    })

    const list = Effect.fn("OpencodeXSwarm.list")(function* () {
      return yield* Effect.forEach(
        (yield* db.select().from(OpencodeXSwarmTable).orderBy(OpencodeXSwarmTable.time_updated).all().pipe(Effect.orDie))
          .map((swarm) => swarm.id)
          .toReversed(),
        get,
        { concurrency: "unbounded" },
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
      sessionID?: string,
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
      if (current.roles.some((role) => ["planned", "queued", "running"].includes(role.status))) return
      if (current.roles.some((role) => role.status === "failed")) {
        yield* updateSwarmStatus(swarmID, "failed", "Swarm finished with failed roles")
        return
      }
      if (current.synthesisSessionID) {
        yield* updateSwarmStatus(swarmID, "completed", "Swarm completed")
        return
      }
      const project = yield* projects.get(current.projectID).pipe(Effect.orDie)
      const directory = project.folders[0]?.path ?? project.project.worktree
      const defaultAgent = yield* agents.defaultAgent().pipe(Effect.orDie)
      const synthesisModel = current.roles.map(selectedRoleModel).find((model) => model !== undefined) ?? (yield* defaultModel())
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
      const synthesis = yield* projects.createSession({
        projectID: current.projectID,
        directory,
        title: `${current.title}: Synthesis`,
        agent: defaultAgent,
        model: {
          providerID: synthesisModel.providerID,
          id: synthesisModel.modelID,
        },
        metadata: {
          opencodex: {
            swarmID,
            role: "synthesis",
          },
        },
      }).pipe(Effect.orDie)
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
      const synthesized = yield* prompt.prompt({
        sessionID: synthesis.id,
        agent: defaultAgent,
        model: synthesisModel,
        parts: [
          {
            type: "text",
            text: synthesisPrompt({ swarm: current, roles: roleOutputs }),
          },
        ],
      }).pipe(
        Effect.as(true),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            const message = errorMessage(Cause.squash(cause))
            yield* event(swarmID, {
              sessionID: synthesis.id,
              kind: "swarm.synthesis.failed",
              message,
            })
            yield* updateSwarmStatus(swarmID, "failed", "Swarm synthesis failed")
            return false
          }),
        ),
      )
      if (!synthesized) return
      yield* event(swarmID, {
        sessionID: synthesis.id,
        kind: "swarm.synthesis.completed",
        message: "Synthesis completed",
      })
      yield* updateSwarmStatus(swarmID, "completed", "Swarm completed")
    })

    const markFailedIfNoRunningRoles = Effect.fn("OpencodeXSwarm.markFailedIfNoRunningRoles")(function* (
      swarmID: string,
    ) {
      const current = yield* get(swarmID)
      if (current.status === "cancelled") return
      if (current.roles.some((role) => ["planned", "queued", "running"].includes(role.status))) return
      yield* updateSwarmStatus(swarmID, "failed", "Swarm failed")
    })

    const create = Effect.fn("OpencodeXSwarm.create")(function* (input: CreateInput) {
      yield* projects.get(input.projectID)
      const swarmID = `swm_${Identifier.ascending()}`
      const now = Date.now()
      const roles = input.roles && input.roles.length > 0 ? input.roles : defaultRoles(input.prompt)
      const promptText = input.prompt?.trim() ?? ""
      const invalid = validateRoles(roles)
      if (invalid) return yield* new ValidationError({ message: invalid })
      yield* db
        .transaction(
          (tx) =>
            Effect.gen(function* () {
              yield* tx
                .insert(OpencodeXSwarmTable)
                .values({
                  id: swarmID,
                  opencodex_project_id: input.projectID,
                  title: input.title?.trim() || defaultTitle(promptText),
                  prompt: promptText,
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
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
      yield* event(swarmID, { kind: "swarm.created", message: "Swarm plan created" })
      return yield* get(swarmID)
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

    const cancelSessionTree = Effect.fn("OpencodeXSwarm.cancelSessionTree")(function* (sessionID: string) {
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
      yield* Effect.forEach(children, (child) => cancelSessionTree(child.id), { concurrency: "unbounded", discard: true })
    })

    const createRun = Effect.fn("OpencodeXSwarm.createRun")(function* (
      swarmID: string,
      input: { prompt: string; agent?: string; variant?: string },
    ) {
      const swarm = yield* get(swarmID)
      if (swarm.status === "cancelled") return yield* new ValidationError({ message: "Cancelled swarms cannot run tasks." })
      const invalid = validateRoles(swarm.roles)
      if (invalid) return yield* new ValidationError({ message: invalid })
      const orchestrator = swarm.roles.find((role) => isOrchestratorRole(role))
      if (!orchestrator) return yield* new ValidationError({ message: "A swarm requires an Orchestrator role." })
      const project = yield* projects.get(swarm.projectID).pipe(Effect.orDie)
      const directory = project.folders[0]?.path ?? project.project.worktree
      const runID = `swrn_${Identifier.ascending()}`
      const now = Date.now()
      const model = selectedRoleModel(orchestrator) ?? (yield* defaultModel())
      const requestedAgent = input.agent
        ? yield* agents.get(input.agent).pipe(
            Effect.as(input.agent),
            Effect.catchCause(() => Effect.succeed(undefined)),
          )
        : undefined
      const orchestratorAgent = requestedAgent ?? orchestrator.agent ?? (yield* agents.defaultAgent().pipe(Effect.orDie))
      const session = yield* projects.createSession({
        projectID: swarm.projectID,
        directory,
        title: `${swarm.title}: ${defaultTitle(input.prompt)}`,
        agent: orchestratorAgent,
        model: {
          providerID: model.providerID,
          id: model.modelID,
          ...(input.variant ? { variant: input.variant } : {}),
        },
        metadata: {
          opencodex: {
            swarmID,
            runID,
            roleID: orchestrator.id,
            role: "orchestrator",
          },
        },
      }).pipe(Effect.orDie)
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
                  metadata_json: serializeMetadata({ orchestratorRoleID: orchestrator.id }),
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
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
      const run = hydrateRun(
        {
          id: runID,
          swarm_id: swarmID,
          opencodex_project_id: swarm.projectID,
          title: defaultTitle(input.prompt),
          prompt: input.prompt,
          status: "running",
          source: "swarm",
          orchestrator_session_id: session.id,
          result_session_id: null,
          started_at: now,
          completed_at: null,
          metadata_json: serializeMetadata({ orchestratorRoleID: orchestrator.id }),
          time_created: now,
          time_updated: now,
        },
        [],
      )
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
              text: orchestratorRunPrompt({ swarm, run, orchestrator, roles: swarm.roles }),
            },
          ],
        })
        yield* db
          .update(OpencodeXSwarmRunTable)
          .set({ result_session_id: session.id, time_updated: Date.now() })
          .where(eq(OpencodeXSwarmRunTable.id, runID))
          .run()
          .pipe(Effect.orDie)
        yield* db
          .update(OpencodeXSwarmTable)
          .set({ synthesis_session_id: session.id, time_updated: Date.now() })
          .where(eq(OpencodeXSwarmTable.id, swarmID))
          .run()
          .pipe(Effect.orDie)
        yield* event(swarmID, {
          runID,
          roleID: orchestrator.id,
          sessionID: session.id,
          kind: "swarm.run.turn.completed",
          message: "Orchestrator turn completed",
        })
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            const message = errorMessage(Cause.squash(cause))
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
      if (!swarm.prompt.trim()) return yield* new ValidationError({ message: "Assign a task before starting this swarm." })
      return yield* createRun(swarmID, { prompt: swarm.prompt })
    })

    const assignTask = Effect.fn("OpencodeXSwarm.assignTask")(function* (swarmID: string, input: AssignTaskInput) {
      const promptText = input.prompt.trim()
      if (!promptText) return yield* new ValidationError({ message: "Swarm run prompt cannot be empty." })
      yield* event(swarmID, { kind: "swarm.task.assigned", message: "Task assigned to swarm team" })
      return yield* createRun(swarmID, { prompt: promptText, agent: input.agent, variant: input.variant })
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
        swarm.roles
          .map((role) => role.jobID)
          .filter((jobID): jobID is string => jobID !== undefined),
        (jobID) => jobs.cancel(jobID).pipe(Effect.ignore),
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
        swarm.roles
          .map((role) => role.jobID)
          .filter((jobID): jobID is string => jobID !== undefined),
        (jobID) => jobs.cancel(jobID).pipe(Effect.ignore),
        { concurrency: "unbounded", discard: true },
      )
      yield* db.delete(OpencodeXSwarmTable).where(eq(OpencodeXSwarmTable.id, swarmID)).run().pipe(Effect.orDie)
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

    return Service.of({ list, get, create, update, start, assignTask, cancel, remove, addRole, updateRole })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Agent.defaultLayer),
  Layer.provide(BackgroundJob.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(OpencodeXJob.defaultLayer),
  Layer.provide(OpencodeXProject.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(SessionPrompt.defaultLayer),
)

export * as OpencodeXSwarm from "./swarm"

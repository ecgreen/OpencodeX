import {
  OpencodeXSwarmAgentRunTable,
  OpencodeXSwarmEventTable,
  OpencodeXSwarmRoleTable,
  OpencodeXSwarmRunTable,
  OpencodeXSwarmTable,
} from "@opencode-ai/core/opencodex/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { OpencodeXJob } from "@/opencodex/job"
import { Effect, Option, Schema } from "effect"
import {
  Metadata,
  RoleStatus,
  Status,
  type AgentRun,
  type Event,
  type Info,
  type Role,
  type RoleInput,
  type Run,
} from "./swarm-schema"

const decodeMetadata = Schema.decodeUnknownOption(Schema.fromJsonString(Metadata))

function metadata(value: string | null) {
  return value ? Option.getOrUndefined(decodeMetadata(value)) : undefined
}

export function waitForAbort(signal: AbortSignal) {
  return Effect.callback<never, Error>((resume) => {
    const abort = () => resume(Effect.fail(new Error(String(signal.reason ?? "Swarm job cancelled"))))
    if (signal.aborted) {
      abort()
      return Effect.void
    }
    signal.addEventListener("abort", abort, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", abort))
  })
}
export function serializeMetadata(metadata: Record<string, unknown> | undefined) {
  return metadata ? JSON.stringify(metadata) : undefined
}

export function defaultTitle(prompt?: string) {
  const firstLine = prompt?.trim().split(/\r?\n/)[0] ?? "New swarm"
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine || "New swarm"
}

export function defaultRoles(prompt: string): RoleInput[] {
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

export function isOrchestratorRole(role: RoleInput) {
  return role.skill === "orchestrator" || role.name.trim().toLowerCase() === "orchestrator"
}

export function validateRoles(roles: readonly RoleInput[]) {
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

export function hydrateRole(row: typeof OpencodeXSwarmRoleTable.$inferSelect): Role {
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

export function hydrate(input: {
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

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export function swarmJobOwner(runID: string, phase: string) {
  return `local:${process.pid}:swarm:${runID}:${phase}`
}

export function rolePrompt(input: { swarm: Info; role: Role; coordination?: string }) {
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

export function executionMode(input: { agent?: string; mode?: "build" | "plan" }) {
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

export function orchestratorRunPrompt(input: {
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

export function messageText(message: { parts: { type: string; text?: string; synthetic?: boolean }[] }) {
  return message.parts
    .filter((part) => part.type === "text" && !part.synthetic && part.text?.trim())
    .map((part) => part.text?.trim())
    .filter((text): text is string => text !== undefined && text.length > 0)
    .join("\n")
}

export function selectedRoleModel(role: Role) {
  if (!role.providerID || !role.modelID) return undefined
  return {
    providerID: ProviderV2.ID.make(role.providerID),
    modelID: ProviderV2.ModelID.make(role.modelID),
  }
}

export function synthesisPrompt(input: {
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

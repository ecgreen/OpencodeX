import {
  OpencodeXSwarmEventTable,
  OpencodeXSwarmRoleTable,
  OpencodeXSwarmTable,
} from "@opencode-ai/core/opencodex/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { OpencodeXJob } from "@/opencodex/job"
import { Option, Schema } from "effect"
import { Metadata, RoleStatus, Status, type Event, type Info, type Role, type RoleInput } from "./swarm-schema"

const decodeMetadata = Schema.decodeUnknownOption(Schema.fromJsonString(Metadata))

function metadata(value: string | null) {
  return value ? Option.getOrUndefined(decodeMetadata(value)) : undefined
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
    variant: row.variant ?? undefined,
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
    roleID: row.role_id ?? undefined,
    sessionID: row.session_id ?? undefined,
    kind: row.kind,
    message: row.message,
    metadata: metadata(row.metadata_json),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export function hydrate(input: {
  swarm: typeof OpencodeXSwarmTable.$inferSelect
  roles: (typeof OpencodeXSwarmRoleTable.$inferSelect)[]
  events: (typeof OpencodeXSwarmEventTable.$inferSelect)[]
}): Info {
  return {
    id: input.swarm.id,
    projectID: input.swarm.opencodex_project_id ?? undefined,
    title: input.swarm.title,
    prompt: input.swarm.prompt,
    status: Schema.decodeUnknownSync(Status)(input.swarm.status),
    source: Schema.decodeUnknownSync(OpencodeXJob.Source)(input.swarm.source),
    createdBy: input.swarm.created_by ?? undefined,
    synthesisSessionID: input.swarm.synthesis_session_id ?? undefined,
    startedAt: input.swarm.started_at ?? undefined,
    completedAt: input.swarm.completed_at ?? undefined,
    metadata: metadata(input.swarm.metadata_json),
    roles: input.roles.map(hydrateRole),
    events: input.events.map(hydrateEvent),
    timeCreated: input.swarm.time_created,
    timeUpdated: input.swarm.time_updated,
  }
}

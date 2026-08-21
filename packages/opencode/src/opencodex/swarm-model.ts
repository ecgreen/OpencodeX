import { OpencodeXSwarmEventTable, OpencodeXSwarmRoleTable, OpencodeXSwarmTable } from "@opencode-ai/core/opencodex/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { OpencodeXJob } from "@/opencodex/job"
import { Option, Schema } from "effect"
import {
  FallbackModel,
  Metadata,
  RoleStatus,
  Status,
  type Event,
  type Info,
  type Role,
  type RoleInput,
} from "./swarm-schema"

const decodeMetadata = Schema.decodeUnknownOption(Schema.fromJsonString(Metadata))
const decodeFallbackModels = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeFallbackModel = Schema.decodeUnknownOption(FallbackModel)

function metadata(value: string | null) {
  return value ? Option.getOrUndefined(decodeMetadata(value)) : undefined
}

export function serializeMetadata(metadata: Record<string, unknown> | undefined) {
  return metadata ? JSON.stringify(metadata) : undefined
}

export function normalizeRole<T extends RoleInput>(role: T): T {
  return {
    ...role,
    ...(role.variant === "default" ? { variant: undefined } : {}),
    ...(role.fallbackModels
      ? {
          fallbackModels: role.fallbackModels.map((model) => ({
            ...model,
            ...(model.variant === "default" ? { variant: undefined } : {}),
          })),
        }
      : {}),
  }
}

export function serializeFallbackModels(models: RoleInput["fallbackModels"]) {
  return JSON.stringify(models ?? [])
}

export function hydrateFallbackModels(value: string, primary?: { providerID: string; modelID: string }) {
  const seen = new Set(primary ? [`${primary.providerID}\u0000${primary.modelID}`] : [])
  const decoded = Option.getOrUndefined(decodeFallbackModels(value))
  if (!Array.isArray(decoded)) return []
  return decoded
    .flatMap((value) => {
      const model = Option.getOrUndefined(decodeFallbackModel(value))
      if (!model) return []
      const providerID = ProviderV2.ID.make(model.providerID.trim())
      const modelID = ProviderV2.ModelID.make(model.modelID.trim())
      if (!providerID || !modelID || providerID === "swarm") return []
      const key = `${providerID}\u0000${modelID}`
      if (seen.has(key)) return []
      seen.add(key)
      return [
        {
          providerID,
          modelID,
          ...(model.variant?.trim() && model.variant.trim() !== "default" ? { variant: model.variant.trim() } : {}),
        },
      ]
    })
    .slice(0, 4)
}

export function mergeRoleFallbacks(roles: readonly RoleInput[], existing: readonly Role[]) {
  // A client that sends fallbackModels on any role understands the field, so
  // its roster is authoritative. Requiring every role to carry it would treat a
  // freshly added role - which has no fallbacks to send - as an old client and
  // reject renames and deletions the payload already spelled out in full.
  const explicit = roles.some((role) => role.fallbackModels !== undefined)
  // Roles pair by normalized name, never by array index: a roster that
  // reorders roles while omitting fallbackModels must keep every stored
  // chain, so only a rename or deletion of a chain-carrying role is a
  // compatibility question.
  const incompatible = existing.some((previous) => {
    if (!previous.fallbackModels.length) return false
    if (explicit) return false
    return !roles.some((role) => roleName(previous.name) === roleName(role.name))
  })
  if (incompatible) {
    return {
      error:
        "This swarm has model fallbacks that cannot be safely updated by this client. Refresh or use a current client.",
    } as const
  }
  return {
    roles: roles.map((role) => {
      const normalized = normalizeRole(role)
      if (normalized.fallbackModels !== undefined) return normalized
      const previous = existing.find((item) => roleName(item.name) === roleName(normalized.name))
      if (!previous) return normalized
      return { ...normalized, fallbackModels: previous.fallbackModels }
    }),
  } as const
}

function roleName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
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
  const names = roles.map((role) => roleName(role.name))
  if (new Set(names).size !== names.length) return "Every swarm role needs a unique name."
  for (const role of roles) {
    if ((role.fallbackModels?.length ?? 0) > 4) return `Role "${role.name}" can use at most 4 fallback models.`
    if (!role.fallbackModels?.length) continue
    if (isOrchestratorRole(role)) return "The Orchestrator cannot use fallback models."
    if (!role.providerID || !role.modelID) return `Role "${role.name}" needs a complete primary model before fallbacks.`
    if (role.fallbackModels.some((model) => !model.providerID.trim() || !model.modelID.trim())) {
      return `Role "${role.name}" has an incomplete model fallback.`
    }
    const models = [
      { providerID: role.providerID, modelID: role.modelID, variant: role.variant },
      ...role.fallbackModels,
    ]
    if (role.fallbackModels.some((model) => model.providerID === "swarm")) {
      return `Role "${role.name}" cannot use the swarm provider as a fallback.`
    }
    const tuples = models.map((model) => `${model.providerID}\u0000${model.modelID}`)
    if (new Set(tuples).size !== tuples.length) return `Role "${role.name}" has a duplicate model fallback.`
  }
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
    fallbackModels:
      row.sort_order === 0
        ? []
        : hydrateFallbackModels(
            row.fallback_models,
            row.provider_id && row.model_id ? { providerID: row.provider_id, modelID: row.model_id } : undefined,
          ),
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

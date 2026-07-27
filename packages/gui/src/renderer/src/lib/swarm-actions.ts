import type { OpencodeXSwarm, OpencodeXSwarmRoleInput, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "./store"

/**
 * A swarm is used like a model, so its live status is simply whether any
 * session currently running on it is busy.
 */
export function swarmIsWorking(swarm: Pick<OpencodeXSwarm, "id">, snapshot?: GuiSnapshot) {
  return swarmSessions(snapshot?.sessions ?? [], swarm.id).some((session) => {
    const status = snapshot?.sessionStatus[session.id]?.type
    return status === "busy" || status === "retry"
  })
}

export function swarmDisplayTimeUpdated(swarm: OpencodeXSwarm) {
  return numericTime(swarm.timeUpdated)
}

export function projectLabel(project: GuiSnapshot["projects"][number]) {
  return project.name ?? project.project.name ?? project.project.worktree ?? project.id
}

export function projectLabelByID(projects: GuiSnapshot["projects"], projectID: string) {
  const project = projects.find((project) => project.id === projectID)
  return project ? projectLabel(project) : projectID
}

export function sessionSwarmID(session: Session) {
  const opencodex = session.metadata?.opencodex
  if (typeof opencodex !== "object" || opencodex === null || !("swarmID" in opencodex)) return undefined
  return typeof opencodex.swarmID === "string" ? opencodex.swarmID : undefined
}

/**
 * Sessions running on a swarm, newest first. A swarm is selected like a model,
 * so its sessions are simply the ones whose model routes to `swarm/<id>`.
 */
export function swarmSessions(sessions: Session[], swarmID: string) {
  return sessions
    .filter((session) => session.model?.providerID === "swarm" && session.model.id === swarmID && !session.parentID)
    .toSorted((a, b) => b.time.updated - a.time.updated)
}

export function isSwarmSession(session: Session) {
  return sessionSwarmID(session) !== undefined
}

export type SwarmRolePreset = {
  name: string
  skill: string
  description: string
  default?: boolean
}

export const ORCHESTRATOR_SWARM_ROLE_PRESET: SwarmRolePreset = {
  name: "Orchestrator",
  skill: "orchestrator",
  description: "Coordinates the swarm, manages dependencies, and plans synthesis.",
  default: true,
}

export const SWARM_ROLE_PRESETS: SwarmRolePreset[] = [
  {
    name: "Product Manager",
    skill: "product-manager",
    description: "Frames goals, workflows, acceptance criteria, and tradeoffs.",
    default: true,
  },
  {
    name: "Designer",
    skill: "designer",
    description: "Reviews UI/UX flows, visual hierarchy, interaction states, and accessibility.",
    default: true,
  },
  {
    name: "Architect",
    skill: "architect",
    description: "Designs integration boundaries, data flow, and rollout risks.",
    default: true,
  },
  {
    name: "Senior Engineer",
    skill: "senior-engineer",
    description: "Plans or implements the concrete engineering work.",
    default: true,
  },
  {
    name: "QA Engineer",
    skill: "qa-engineer",
    description: "Defines validation, edge cases, and regression coverage.",
    default: true,
  },
  {
    name: "Code Reviewer",
    skill: "code-reviewer",
    description: "Reviews for bugs, regressions, maintainability, and missing tests.",
    default: true,
  },
  {
    name: "Docs Engineer",
    skill: "docs-engineer",
    description: "Produces guides, API docs, migration notes, and release docs.",
  },
  {
    name: "Release Engineer",
    skill: "release-engineer",
    description: "Plans packaging, changelog, rollout, and rollback steps.",
  },
  {
    name: "Security Reviewer",
    skill: "security-reviewer",
    description: "Reviews trust boundaries, permissions, secrets, and automation safety.",
  },
]

export const SWARM_ROLE_PRESET_OPTIONS = [ORCHESTRATOR_SWARM_ROLE_PRESET, ...SWARM_ROLE_PRESETS]

/**
 * A new swarm starts with an unconfigured orchestrator: every role's model is
 * an explicit choice, never inherited from the session or an agent default.
 */
export function defaultSwarmRoles(): OpencodeXSwarmRoleInput[] {
  return [presetRoleInput(ORCHESTRATOR_SWARM_ROLE_PRESET)]
}

export function nextSwarmRolePreset(roles: readonly Pick<OpencodeXSwarmRoleInput, "skill" | "name">[]) {
  const used = new Set(roles.map((role) => role.skill ?? role.name.trim().toLowerCase().replace(/\s+/g, "-")))
  return SWARM_ROLE_PRESETS.find((preset) => !used.has(preset.skill))
}

export function swarmProviderSelectionKey(roles: readonly Pick<OpencodeXSwarmRoleInput, "providerID">[]) {
  return [...new Set(roles.flatMap((role) => role.providerID ? [role.providerID] : []))].toSorted().join("\0")
}

export function swarmRolePresetBySkill(skill: string | undefined) {
  return SWARM_ROLE_PRESET_OPTIONS.find((preset) => preset.skill === skill)
}

export function presetRoleInput(preset: SwarmRolePreset, model: { providerID?: string; modelID?: string } = {}): OpencodeXSwarmRoleInput {
  return roleInput({
    name: preset.name,
    skill: preset.skill,
    providerID: model.providerID,
    modelID: model.modelID,
  })
}

export function roleInput(input: Partial<OpencodeXSwarmRoleInput> & { name: string }): OpencodeXSwarmRoleInput {
  return {
    name: input.name.trim() || "Specialist",
    agent: cleanOptional(input.agent),
    skill: cleanOptional(input.skill),
    providerID: cleanOptional(input.providerID),
    modelID: cleanOptional(input.modelID),
    modelProfile: cleanOptional(input.modelProfile),
    instructions: input.instructions?.trim() ?? "",
    metadata: input.metadata,
  }
}

export function numericTime(value: number | string | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function cleanOptional(value: string | undefined) {
  const next = value?.trim()
  return next ? next : undefined
}

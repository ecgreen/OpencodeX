import type { OpencodeXSwarmRole, SwarmRoleDraft, SwarmRolePreset } from "./opencodex-operations-types"

let swarmRoleDraftID = 0

export const ORCHESTRATOR_PRESET: SwarmRolePreset = {
  name: "Orchestrator",
  skill: "orchestrator",
  description: "Coordinates the swarm, manages dependencies, and plans synthesis.",
}

export const SWARM_ROLE_PRESETS: SwarmRolePreset[] = [
  { name: "Product Manager", skill: "product-manager", description: "Frames goals, workflows, acceptance criteria, and tradeoffs." },
  { name: "Designer", skill: "designer", description: "Reviews UI/UX flows, visual hierarchy, interaction states, and accessibility." },
  { name: "Architect", skill: "architect", description: "Designs integration boundaries, data flow, and rollout risks." },
  { name: "Senior Engineer", skill: "senior-engineer", description: "Plans or implements the concrete engineering work." },
  { name: "QA Engineer", skill: "qa-engineer", description: "Defines validation, edge cases, and regression coverage." },
  { name: "Code Reviewer", skill: "code-reviewer", description: "Reviews for bugs, regressions, maintainability, and missing tests." },
  { name: "Docs Engineer", skill: "docs-engineer", description: "Produces guides, API docs, migration notes, and release docs." },
  { name: "Release Engineer", skill: "release-engineer", description: "Plans packaging, changelog, rollout, and rollback steps." },
  { name: "Security Reviewer", skill: "security-reviewer", description: "Reviews trust boundaries, permissions, secrets, and automation safety." },
]

export function opencodeXSwarmExecutionMode(agentName?: string) {
  return agentName === "plan" ? "plan" : "build"
}

export function createRoleDraft(preset: SwarmRolePreset, model?: { providerID: string; modelID: string }): SwarmRoleDraft {
  return {
    ...preset,
    draftID: `${preset.skill}:${++swarmRoleDraftID}`,
    customInstructions: "",
    providerID: model?.providerID,
    modelID: model?.modelID,
  }
}

export function roleDraftFromSwarmRole(role: OpencodeXSwarmRole): SwarmRoleDraft {
  return {
    draftID: role.id,
    name: role.name,
    skill: role.skill ?? role.agent ?? role.name.trim().toLowerCase().replace(/\s+/g, "-"),
    description: role.instructions,
    customInstructions: role.instructions,
    providerID: role.providerID,
    modelID: role.modelID,
    existing: true,
  }
}

export function roleInstructions(role: SwarmRoleDraft) {
  const base = `Use the built-in "${role.skill}" swarm role skill markdown as the default guidance.`
  if (role.existing) return role.customInstructions.trim() || base
  const custom = role.customInstructions.trim()
  return custom ? `${base}\n\nAdditional custom instructions:\n${custom}` : base
}

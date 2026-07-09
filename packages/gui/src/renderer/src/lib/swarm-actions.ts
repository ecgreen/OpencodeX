import type { Agent, OpencodeXSwarm, OpencodeXSwarmRoleInput, OpencodeXSwarmRun, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "./store"

export type SwarmExecutionMode = "build" | "plan"

export function opencodeXSwarmExecutionMode(agentName?: string): SwarmExecutionMode {
  return agentName === "plan" ? "plan" : "build"
}

export function swarmRunUpdated(run: Pick<OpencodeXSwarmRun, "timeUpdated" | "completedAt" | "startedAt">) {
  return numericTime(run.timeUpdated) || numericTime(run.completedAt) || numericTime(run.startedAt)
}

export function swarmRuns(swarm: Pick<OpencodeXSwarm, "runs">) {
  return swarm.runs.toSorted((a, b) => swarmRunUpdated(b) - swarmRunUpdated(a))
}

export function currentSwarmRun(swarm: OpencodeXSwarm) {
  return swarmRuns(swarm)[0]
}

export function swarmRunSessionID(run: OpencodeXSwarmRun) {
  return run.resultSessionID ?? run.orchestratorSessionID ?? run.agents.find((agent) => agent.sessionID)?.sessionID
}

export function isActiveSwarmStatus(status: string) {
  return ["planned", "queued", "running", "approval_needed", "blocked", "input_needed", "needs_review", "in_progress"].includes(status)
}

export function swarmDisplayStatus(swarm: OpencodeXSwarm, snapshot?: GuiSnapshot) {
  const run = currentSwarmRun(swarm)
  const sessionID = run ? swarmRunSessionID(run) : undefined
  const sessionStatus = sessionID ? snapshot?.sessionStatus[sessionID]?.type : undefined
  if (sessionStatus && sessionStatus !== "idle") return sessionStatus
  return run?.status ?? swarm.status
}

export function swarmDisplayPrompt(swarm: OpencodeXSwarm) {
  return currentSwarmRun(swarm)?.prompt ?? swarm.prompt
}

export function swarmDisplayTimeUpdated(swarm: OpencodeXSwarm) {
  return swarmRunUpdated(currentSwarmRun(swarm) ?? swarm)
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
  if (typeof opencodex !== "object" || opencodex === null || !("swarmID" in opencodex)) return
  return typeof opencodex.swarmID === "string" ? opencodex.swarmID : undefined
}

export function isSwarmSession(session: Session) {
  return sessionSwarmID(session) !== undefined
}

export function primaryAgents(agents: Agent[]) {
  return agents.filter((agent) => agent.mode === "primary" || agent.mode === "all")
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

export function defaultSwarmRoles(input: { agents: Agent[]; providerID?: string; modelID?: string }): OpencodeXSwarmRoleInput[] {
  const agents = primaryAgents(input.agents)
  const orchestrator = agents.find((agent) => agent.name === "orchestrator")
  return [
    presetRoleInput(ORCHESTRATOR_SWARM_ROLE_PRESET, {
      providerID: input.providerID ?? orchestrator?.model?.providerID,
      modelID: input.modelID ?? orchestrator?.model?.modelID,
    }),
  ]
}

export function nextSwarmRolePreset(roles: readonly Pick<OpencodeXSwarmRoleInput, "skill" | "name">[]) {
  const used = new Set(roles.map((role) => role.skill ?? role.name.trim().toLowerCase().replace(/\s+/g, "-")))
  return SWARM_ROLE_PRESETS.find((preset) => !used.has(preset.skill))
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

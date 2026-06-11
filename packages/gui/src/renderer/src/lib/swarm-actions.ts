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

export function defaultSwarmRoles(input: { agents: Agent[]; providerID?: string; modelID?: string }): OpencodeXSwarmRoleInput[] {
  const agents = primaryAgents(input.agents)
  const orchestrator = agents.find((agent) => agent.name === "orchestrator") ?? agents[0]
  const specialist = agents.find((agent) => agent.name !== orchestrator?.name)
  return [
    roleInput({
      name: "Orchestrator",
      agent: orchestrator?.name,
      skill: "orchestrator",
      providerID: input.providerID ?? orchestrator?.model?.providerID,
      modelID: input.modelID ?? orchestrator?.model?.modelID,
      instructions: "Coordinate the swarm, break down the task, and synthesize the final result.",
    }),
    roleInput({
      name: "Specialist",
      agent: specialist?.name,
      skill: specialist?.name ?? "specialist",
      providerID: input.providerID ?? specialist?.model?.providerID,
      modelID: input.modelID ?? specialist?.model?.modelID,
      instructions: "Handle delegated implementation or research work and report concise findings.",
    }),
  ]
}

export function roleInput(input: Partial<OpencodeXSwarmRoleInput> & { name: string }): OpencodeXSwarmRoleInput {
  return {
    name: input.name.trim() || "Specialist",
    agent: cleanOptional(input.agent),
    skill: cleanOptional(input.skill),
    providerID: cleanOptional(input.providerID),
    modelID: cleanOptional(input.modelID),
    modelProfile: cleanOptional(input.modelProfile),
    instructions: input.instructions?.trim() || "Use the configured role guidance and report progress clearly.",
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

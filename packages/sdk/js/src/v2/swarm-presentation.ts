export type ClientSwarmRunLike = {
  id?: string
  status?: string
  resultSessionID?: string
  synthesisSessionID?: string
  orchestratorSessionID?: string
  agents?: readonly { sessionID?: string }[]
  timeUpdated?: number | string
  completedAt?: number | string
  timeCompleted?: number | string
  startedAt?: number | string
  timeStarted?: number | string
  timeCreated?: number | string
}

export type ClientSwarmLike<Run extends ClientSwarmRunLike = ClientSwarmRunLike> = {
  status?: string
  runs?: readonly Run[]
  currentRun?: Run
  latestRun?: Run
  currentRunID?: string
  activeRunID?: string
  latestRunID?: string
  runID?: string
}

const active = new Set([
  "planned",
  "queued",
  "running",
  "cancelling",
  "retrying",
  "approval_needed",
  "blocked",
  "input_needed",
  "needs_review",
  "in_progress",
])

const terminal = new Set(["completed", "partially_failed", "failed", "cancelled"])

export function isActiveSwarmStatus(status: string) {
  return active.has(status)
}

export function isTerminalSwarmStatus(status: string) {
  return terminal.has(status)
}

export function clientSwarmRunUpdated(run: ClientSwarmRunLike) {
  return (
    clientSwarmTime(run.timeUpdated) ||
    clientSwarmTime(run.completedAt) ||
    clientSwarmTime(run.timeCompleted) ||
    clientSwarmTime(run.startedAt) ||
    clientSwarmTime(run.timeStarted) ||
    clientSwarmTime(run.timeCreated)
  )
}

export function clientSwarmRuns<Run extends ClientSwarmRunLike>(swarm: ClientSwarmLike<Run>) {
  return [...(swarm.runs ?? [])].sort((left, right) => clientSwarmRunUpdated(right) - clientSwarmRunUpdated(left))
}

export function currentClientSwarmRun<Run extends ClientSwarmRunLike>(swarm: ClientSwarmLike<Run>) {
  const preferredID = swarm.currentRunID ?? swarm.activeRunID ?? swarm.latestRunID ?? swarm.runID
  return (
    (preferredID ? swarm.runs?.find((run) => run.id === preferredID) : undefined) ??
    swarm.currentRun ??
    swarm.latestRun ??
    clientSwarmRuns(swarm)[0]
  )
}

export function activeClientSwarmRun<Run extends ClientSwarmRunLike>(swarm: ClientSwarmLike<Run>) {
  return clientSwarmRuns(swarm).find((run) => isActiveSwarmStatus(run.status ?? ""))
}

export function clientSwarmDisplayStatus(swarm: ClientSwarmLike) {
  const activeRun = activeClientSwarmRun(swarm)
  if (activeRun) return activeRun.status ?? "running"
  const current = currentClientSwarmRun(swarm)
  if (current) return current.status ?? swarm.status ?? "planned"
  if (swarm.status === "running") return "planned"
  return swarm.status ?? "planned"
}

export function clientSwarmRunSessionID(run: ClientSwarmRunLike) {
  return (
    run.resultSessionID ??
    run.synthesisSessionID ??
    run.orchestratorSessionID ??
    run.agents?.find((agent) => agent.sessionID)?.sessionID
  )
}

export function clientSwarmStatusLabel(status: string) {
  if (status === "partially_failed") return "Partially failed"
  if (status === "in_progress") return "In progress"
  if (status === "input_needed") return "Input needed"
  if (status === "approval_needed") return "Approval needed"
  if (status === "needs_review") return "Needs review"
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ")
}

function clientSwarmTime(value: number | string | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

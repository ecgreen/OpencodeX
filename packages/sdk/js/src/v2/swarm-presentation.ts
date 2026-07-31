export type ClientSwarmStatusLike = {
  status?: string
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

export function clientSwarmDisplayStatus(swarm: ClientSwarmStatusLike) {
  return swarm.status ?? "planned"
}

export function clientSwarmStatusLabel(status: string) {
  if (status === "partially_failed") return "Partially failed"
  if (status === "in_progress") return "In progress"
  if (status === "input_needed") return "Input needed"
  if (status === "approval_needed") return "Approval needed"
  if (status === "needs_review") return "Needs review"
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ")
}

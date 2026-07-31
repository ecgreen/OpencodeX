import type { OpencodeXGoal, OpencodeXGoalNode, Session } from "@opencode-ai/sdk/v2/client"

/**
 * How a goal's graph reads on the session page. The server owns the graph; this
 * only decides the order rows appear in, what each row says, and which tone it
 * wears - so the panel itself stays declarative and this stays testable.
 */

export type GoalNodeTone = "idle" | "running" | "done" | "failed" | "skipped" | "attention"

export type GoalNodeRow = {
  node: OpencodeXGoalNode
  /** 1 for a loop's body members, so the panel can indent the cluster. */
  depth: number
  tone: GoalNodeTone
  /** Executor and dependencies, in the order a reader scans them. */
  detail: string
  /** Present only once the node has actually run somewhere. */
  sessionID?: string
}

export type GoalProgress = {
  total: number
  settled: number
  running: number
  failed: number
  percent: number
}

const TONES: Record<string, GoalNodeTone> = {
  planned: "idle",
  ready: "idle",
  dispatched: "running",
  running: "running",
  done: "done",
  failed: "failed",
  skipped: "skipped",
  cancelled: "skipped",
  awaiting_approval: "attention",
}

export function goalNodeTone(status: string): GoalNodeTone {
  return TONES[status] ?? "idle"
}

/** The goal this session owns, if any. A session owns at most one at a time. */
export function sessionGoal(session: Session | undefined, goals: readonly OpencodeXGoal[]) {
  if (!session) return undefined
  const owned = goals.filter((goal) => goal.ownerSessionID === session.id)
  if (owned.length === 0) return undefined
  // The live one, else the most recent - a finished goal still deserves its
  // graph on screen so the reader can audit what ran.
  return owned.find((goal) => !isGoalSettled(goal)) ?? owned.toSorted((a, b) => b.timeUpdated - a.timeUpdated)[0]
}

export function isGoalSettled(goal: Pick<OpencodeXGoal, "status">) {
  return ["completed", "failed", "cancelled"].includes(goal.status)
}

/**
 * Rows in reading order: top-level nodes by plan order, each loop immediately
 * followed by its body, so the cluster reads as one thing.
 */
export function goalNodeRows(goal: OpencodeXGoal): GoalNodeRow[] {
  const byOrder = (a: OpencodeXGoalNode, b: OpencodeXGoalNode) => a.sortOrder - b.sortOrder
  const rows: GoalNodeRow[] = []
  for (const node of goal.nodes.filter((item) => !item.parentNodeID).toSorted(byOrder)) {
    rows.push(row(goal, node, 0))
    if (node.kind !== "loop") continue
    for (const member of goal.nodes.filter((item) => item.parentNodeID === node.id).toSorted(byOrder)) {
      rows.push(row(goal, member, 1))
    }
  }
  return rows
}

function row(goal: OpencodeXGoal, node: OpencodeXGoalNode, depth: number): GoalNodeRow {
  return {
    node,
    depth,
    tone: goalNodeTone(node.status),
    detail: nodeDetail(goal, node),
    sessionID: node.sessionID ?? undefined,
  }
}

function nodeDetail(goal: OpencodeXGoal, node: OpencodeXGoalNode) {
  const parts: string[] = []
  const executor = executorLabel(node)
  if (executor) parts.push(executor)
  if (node.kind === "loop" && node.loop) {
    parts.push(`iteration ${node.loop.iteration || 1} of ${node.loop.maxIterations}`)
  }
  if (node.kind === "gate") parts.push("needs your approval")
  const dependencies = goal.edges
    .filter((edge) => edge.toNodeID === node.id)
    .map((edge) => goal.nodes.find((item) => item.id === edge.fromNodeID)?.title ?? edge.fromNodeID)
  if (dependencies.length > 0) parts.push(`after ${dependencies.join(", ")}`)
  return parts.join(" · ")
}

export function executorLabel(node: OpencodeXGoalNode) {
  const executor = node.executor
  if (!executor) return undefined
  if (executor.type === "swarm_role") return executor.role
  if (executor.type === "agent") return executor.agent
  return executor.modelID ?? "default model"
}

export function goalProgress(goal: OpencodeXGoal): GoalProgress {
  const settled = goal.nodes.filter((node) => ["done", "skipped", "cancelled"].includes(node.status)).length
  const failed = goal.nodes.filter((node) => node.status === "failed").length
  const running = goal.nodes.filter((node) => ["dispatched", "running"].includes(node.status)).length
  const total = goal.nodes.length
  return {
    total,
    settled: settled + failed,
    running,
    failed,
    percent: total === 0 ? 0 : Math.round(((settled + failed) / total) * 100),
  }
}

/** One line under the title: what the graph is doing, in the user's terms. */
export function goalHeadline(goal: OpencodeXGoal): string {
  if (goal.statusReason) return goal.statusReason
  const progress = goalProgress(goal)
  switch (goal.status) {
    case "completed": {
      const skipped = goal.nodes.filter((node) => ["skipped", "cancelled"].includes(node.status)).length
      // "Every step finished" would be a lie when some were skipped - a
      // rejected gate settles its cone without running it.
      if (skipped > 0) {
        return `${progress.total - skipped} ${progress.total - skipped === 1 ? "step" : "steps"} ran, ${skipped} skipped.`
      }
      return `Every step finished. ${progress.total} ${progress.total === 1 ? "step" : "steps"} ran.`
    }
    case "failed":
      return failureReason(goal) ?? "A step failed and the rest could not continue."
    case "cancelled":
      return "Cancelled before the graph finished."
    case "blocked":
      return "Waiting for you to approve a step."
    case "paused":
      return "Paused: the budget for this goal is spent."
    case "draft":
    case "planned":
      return `Planned: ${progress.total} ${progress.total === 1 ? "step" : "steps"}, not started yet.`
    default:
      return progress.running > 0
        ? `${progress.running} running, ${progress.settled} of ${progress.total} done.`
        : `${progress.settled} of ${progress.total} done.`
  }
}

function failureReason(goal: OpencodeXGoal) {
  const failed = goal.nodes.find((node) => node.status === "failed")
  if (!failed) return undefined
  return failed.failureReason ? `${failed.title} failed: ${failed.failureReason}` : `${failed.title} failed.`
}

/** Gates waiting on a human, which is the only thing a goal ever asks for. */
export function goalGates(goal: OpencodeXGoal) {
  return goal.nodes.filter((node) => node.status === "awaiting_approval")
}

export function goalNodeForSession(goal: OpencodeXGoal | undefined, sessionID: string) {
  return goal?.nodes.find((node) => node.sessionID === sessionID)
}

/**
 * Goals that need a human right now, for the project attention surface: a
 * parked gate, a spent budget, or a failure waiting on re-planning. Standing
 * goals have no session, so this is the only place they can raise a hand.
 */
export function attentionGoals(goals: readonly OpencodeXGoal[], projectID: string) {
  return goals.filter((goal) => goal.projectID === projectID && ["blocked", "paused", "failed"].includes(goal.status))
}

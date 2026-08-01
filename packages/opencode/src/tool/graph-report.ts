import { ProviderV2 } from "@opencode-ai/core/provider"
import type { Executor, Info, Node } from "@/opencodex/goal-schema"

/**
 * How a graph reads back to the planner that authored it. Pure, because this
 * text is the planner's only view of work that ran in other sessions - it has
 * to carry the shape of the graph, each node's outcome, and the reports
 * themselves.
 */

export type ExecutorParam = {
  readonly role?: string
  readonly agent?: string
  readonly providerID?: string
  readonly modelID?: string
  readonly skill?: string
  readonly instructions?: string
}

/**
 * Flat tool parameters become the tagged executor the graph stores. Naming a
 * role wins, because on a swarm that is the specific thing the planner meant.
 */
export function resolveExecutorParam(param: ExecutorParam): Executor {
  const providerID = param.providerID ? ProviderV2.ID.make(param.providerID) : undefined
  const modelID = param.modelID ? ProviderV2.ModelID.make(param.modelID) : undefined
  if (param.role?.trim()) return { type: "swarm_role", role: param.role.trim() }
  if (param.agent?.trim()) {
    return {
      type: "agent",
      agent: param.agent.trim(),
      providerID,
      modelID,
      skill: param.skill,
      instructions: param.instructions,
    }
  }
  return { type: "model", providerID, modelID, skill: param.skill, instructions: param.instructions }
}

export function goalOutcome(goal: Pick<Info, "status">) {
  switch (goal.status) {
    case "completed":
      return "Completed"
    case "failed":
      return "Failed"
    case "cancelled":
      return "Cancelled"
    case "paused":
      return "Paused"
    case "blocked":
      return "Waiting for approval"
    default:
      return "Running"
  }
}

export function describeGoal(goal: Info, options: { includeResults: boolean }): string {
  const sections = [
    `# ${goal.title}`,
    `Status: ${goal.status}${goal.statusReason ? ` - ${goal.statusReason}` : ""}`,
    goal.statement,
    ...(goal.successCriteria.length > 0
      ? ["", "Success criteria:", ...goal.successCriteria.map((item) => `- ${item}`)]
      : []),
    "",
    "## Graph",
    ...topLevel(goal).map((node) => describeNode(goal, node, "")),
  ]
  if (options.includeResults) {
    const reported = goal.nodes.filter((node) => node.result?.trim() || node.failureReason?.trim())
    if (reported.length > 0) {
      sections.push("", "## Reports")
      for (const node of reported) {
        sections.push(
          "",
          `### ${node.title} [${node.id}]`,
          node.failureReason?.trim() ? `FAILED: ${node.failureReason.trim()}` : node.result!.trim(),
        )
      }
    }
  }
  if (goal.status === "blocked") {
    const gates = goal.nodes.filter((node) => node.status === "awaiting_approval")
    sections.push("", `Waiting on approval for: ${gates.map((node) => node.title).join(", ")}.`)
  }
  return sections.join("\n")
}

function topLevel(goal: Info) {
  return goal.nodes.filter((node) => !node.parentNodeID).toSorted((a, b) => a.sortOrder - b.sortOrder)
}

function describeNode(goal: Info, node: Node, indent: string): string {
  const dependencies = goal.edges
    .filter((edge) => edge.toNodeID === node.id)
    .map((edge) => (edge.kind === "feeds" ? `${edge.fromNodeID} (feeds)` : edge.fromNodeID))
  const lines = [
    `${indent}- [${node.status}] ${node.title} \`${node.id}\`${describeExecutor(node)}${
      dependencies.length > 0 ? ` - after ${dependencies.join(", ")}` : ""
    }`,
  ]
  if (node.kind === "loop" && node.loop) {
    lines[0] += ` - iteration ${node.loop.iteration}/${node.loop.maxIterations}`
    const body = goal.nodes
      .filter((item) => item.parentNodeID === node.id)
      .toSorted((a, b) => a.sortOrder - b.sortOrder)
    for (const member of body) {
      lines.push(describeNode(goal, member, `${indent}  `))
    }
  }
  return lines.join("\n")
}

function describeExecutor(node: Node) {
  const executor = node.executor
  if (node.kind === "gate") return " (gate: needs approval)"
  if (!executor) return ""
  if (executor.type === "swarm_role") return ` (${executor.role})`
  if (executor.type === "agent") return ` (${executor.agent})`
  return executor.modelID ? ` (${executor.modelID})` : ""
}

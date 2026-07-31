import type { NodeKind } from "./goal-schema"

/**
 * How a node's prompt is built. Pure, because "what did this agent receive" is
 * the thing users audit - the assembly order is a contract, not an
 * implementation detail, and the dispatcher persists the exact output.
 *
 * Layer order: the executor's definition first (skill body, then its standing
 * instructions), then the goal it serves, then the specific task, then the
 * upstream results piped in by `feeds` edges, then - inside a loop - what the
 * last iteration got wrong.
 */

export type ContextBlock = {
  readonly title: string
  readonly result: string
}

export type PromptInput = {
  readonly skill?: string
  readonly instructions?: string
  readonly goal: {
    readonly statement: string
    readonly successCriteria?: readonly string[]
  }
  readonly node: {
    readonly kind: NodeKind
    readonly title: string
    readonly brief: string
  }
  readonly context?: readonly ContextBlock[]
  readonly iteration?: {
    readonly number: number
    readonly maxIterations: number
    readonly report: string
  }
}

/**
 * The verdict contract for check nodes. Checks decide whether a loop exits and
 * whether a goal is met, so an ambiguous "looks good to me" is a bug: the
 * structured output tool is what the runtime actually reads.
 */
export const CHECK_INSTRUCTION = [
  "# How to report",
  "You are a check. Verify the claim above against the actual state of the work - run the commands, read the files, look at the evidence. Do not take an upstream report's word for it.",
  "Then return your verdict with the StructuredOutput tool:",
  '- `pass`: true only when every part of the claim holds. When in doubt, fail.',
  "- `summary`: one sentence a human can act on.",
  "- `findings`: each specific thing that is wrong, precise enough to fix without rediscovering it. Empty when passing.",
].join("\n")

export function buildNodePrompt(input: PromptInput): string {
  const sections: string[] = []
  const skill = input.skill?.trim()
  const instructions = input.instructions?.trim()
  if (skill) sections.push(skill)
  if (instructions) sections.push(instructions)
  sections.push(goalSection(input.goal))
  sections.push(taskSection(input.node))
  for (const block of input.context ?? []) {
    const result = block.result.trim()
    if (result) sections.push(`# Context from: ${block.title}\n${result}`)
  }
  const iteration = input.iteration
  if (iteration) sections.push(iterationSection(iteration))
  if (input.node.kind === "check") sections.push(CHECK_INSTRUCTION)
  return sections.join("\n\n")
}

function goalSection(goal: PromptInput["goal"]) {
  const criteria = (goal.successCriteria ?? []).map((item) => item.trim()).filter(Boolean)
  return [
    "# Goal",
    goal.statement.trim(),
    ...(criteria.length > 0 ? ["", "This goal is met when:", ...criteria.map((item) => `- ${item}`)] : []),
  ].join("\n")
}

function taskSection(node: PromptInput["node"]) {
  return [`# Your task: ${node.title.trim()}`, node.brief.trim()].join("\n")
}

function iterationSection(iteration: NonNullable<PromptInput["iteration"]>) {
  return [
    `# Iteration ${iteration.number} of at most ${iteration.maxIterations}`,
    "A previous pass did not satisfy the exit check. Address this, do not start over:",
    iteration.report.trim(),
  ].join("\n")
}

/** The brief handed to a planner asked to turn a goal into a graph. */
export function buildPlannerBrief(input: {
  readonly statement: string
  readonly successCriteria?: readonly string[]
  readonly roles?: readonly { readonly name: string; readonly description?: string }[]
  readonly agents?: readonly string[]
}): string {
  const criteria = (input.successCriteria ?? []).map((item) => item.trim()).filter(Boolean)
  return [
    "<goal-plan>",
    "You are planning a task graph for this goal. Author the plan with the graph_plan tool before doing any of the work yourself.",
    "",
    "Goal:",
    input.statement.trim(),
    ...(criteria.length > 0 ? ["", "Success criteria:", ...criteria.map((item) => `- ${item}`)] : []),
    ...(input.roles && input.roles.length > 0
      ? [
          "",
          "Executors available (use {\"type\":\"swarm_role\",\"role\":\"<name>\"}):",
          ...input.roles.map((role) => `- ${role.name}${role.description ? `: ${role.description}` : ""}`),
        ]
      : []),
    ...(input.agents && input.agents.length > 0
      ? ["", "Agents available (use {\"type\":\"agent\",\"agent\":\"<name>\"}):", ...input.agents.map((agent) => `- ${agent}`)]
      : []),
    "",
    "How to plan well:",
    "- Give every node a brief that is self-contained. The executor sees the goal, its task, and whatever you pipe in - never this conversation.",
    "- Nodes with no dependency between them run at the same time, so do not chain work that could be parallel.",
    "- Use a `feeds` edge when a node needs an upstream result in its prompt; use `requires` when it only needs the work finished.",
    "- End with a `check` whose verdict decides whether the success criteria hold, and a `synthesis` node when results must be reconciled.",
    "- Use a `loop` when work must repeat until a criterion holds: give it body nodes plus a `check` as its exit, and the check's findings feed the next pass.",
    "- Use a `gate` where a human must approve before the work continues.",
    "</goal-plan>",
  ].join("\n")
}

export * as GoalPrompt from "./goal-prompt"

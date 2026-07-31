/**
 * The briefing that turns an ordinary session into a swarm session. When the
 * user selects a swarm as their model, the turn runs on the orchestrator's
 * real model and this text is injected as a hidden (synthetic) part of the
 * user message: the orchestrator learns its team and delegates each specialist
 * as a subagent via the task tool - all inside the one session the user is in.
 *
 * Pure so the exact wording and roster shaping are testable.
 */

export const SWARM_BRIEFING_MARK = "<swarm-briefing"

export type BriefingRole = {
  name: string
  skill?: string
  agent?: string
  instructions?: string
  providerID?: string
  modelID?: string
}

export type BriefingInput = {
  swarmID: string
  title: string
  roles: BriefingRole[]
  /**
   * How the orchestrator delegates. A Claude Code orchestrator runs inside the
   * CLI, where the native task tool would spawn Claude's own subagents on
   * Claude's models; it gets an OpencodeX delegation tool instead.
   */
  delegation?: "task-tool" | "delegate-tool"
}

/** Subagent type used when a role does not name a registered agent. */
const DEFAULT_SUBAGENT = "general"
/** Kept in sync with the transport's DELEGATE_TOOL_NAME by a test. */
const DELEGATE_TOOL_REFERENCE = "the mcp__opencodex_swarm__delegate tool"

export function buildSwarmBriefing(input: BriefingInput): string | undefined {
  if (input.roles.length === 0) return undefined
  const [orchestrator, ...specialists] = input.roles
  const viaDelegateTool = input.delegation === "delegate-tool"
  return [
    `${SWARM_BRIEFING_MARK} swarm="${input.title}">`,
    `You are the orchestrator of the "${input.title}" swarm for this session. The user talks only to you; you coordinate the team and own the final answer.`,
    ...(orchestrator?.instructions?.trim() ? ["", "Your orchestrator instructions:", orchestrator.instructions.trim()] : []),
    "",
    specialists.length > 0
      ? `Your team (delegate with ${viaDelegateTool ? DELEGATE_TOOL_REFERENCE : "the task tool"}):`
      : "You have no specialist roles configured; handle the request yourself.",
    ...specialists.map((role) => specialistLine(role, viaDelegateTool)),
    "",
    "Delegation rules:",
    ...(viaDelegateTool
      ? [
          `- Delegate with ${DELEGATE_TOOL_REFERENCE}: pass the exact role name plus a prompt containing the role's instructions, the exact scope, expected output, and whether files may be edited.`,
          "- Each role runs as its own OpencodeX session on the model configured for it, and its report is returned to you.",
          "- Do not use the built-in Task tool; it is unavailable here and would bypass the team's model routing.",
        ]
      : [
          `- Delegate with the task tool: subagent_type as listed, the role name in the description, and a prompt containing the role's instructions plus the exact scope, expected output, and whether files may be edited.`,
          `- Pass the listed model value on each task call so every specialist runs on its configured model.`,
          "- Each specialist runs in its own subagent session that the user can open from the transcript; keep prompts self-contained.",
        ]),
    "- Run independent roles in parallel by making several calls in one turn; sequence only where outputs depend on each other.",
    // Delegating one specialist at a time is fine for small work. Past a few
    // steps the orchestrator should state the shape of the work once and let
    // the graph run it, which is also what makes the plan visible to the user.
    "- For work with several parts, prefer the graph_plan tool: declare the whole task graph once and the team is delegated automatically, in parallel where the graph allows, with loops that repeat until their check passes.",
    "- Synthesize the team's results yourself: reconcile conflicts, state decisions, risks, and next actions in your final reply.",
    "- Skip delegation entirely when the request is trivial or conversational.",
    "</swarm-briefing>",
  ].join("\n")
}

function specialistLine(role: BriefingRole, viaDelegateTool: boolean) {
  const model = role.providerID && role.modelID ? `${role.providerID}/${role.modelID}` : undefined
  return [
    `- ${role.name}`,
    // The delegate tool resolves the agent and model from the role itself, so
    // only the task tool needs them spelled out on every call.
    ...(viaDelegateTool ? [] : [`subagent_type="${role.agent?.trim() || DEFAULT_SUBAGENT}"`]),
    ...(model && !viaDelegateTool ? [`model="${model}"`] : []),
    ...(role.skill ? [`skill: ${role.skill}`] : []),
    ...(role.instructions?.trim() ? [`instructions: ${collapse(role.instructions)}`] : []),
  ].join("; ")
}

function collapse(text: string) {
  return text.trim().replace(/\s+/g, " ")
}

/**
 * Resolves the role a delegation call named. Models do not reliably echo the
 * roster's casing or spacing back, so matching is lenient about both.
 */
export function matchSwarmRole<T extends { name: string }>(roles: readonly T[], name: string) {
  const wanted = normalizeRoleName(name)
  if (!wanted) return undefined
  return roles.find((role) => normalizeRoleName(role.name) === wanted)
}

function normalizeRoleName(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "")
}

export * as SwarmBriefing from "./swarm-briefing"

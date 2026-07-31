import { describe, expect, test } from "bun:test"
import { SWARM_BRIEFING_MARK, buildSwarmBriefing, matchSwarmRole } from "../../src/opencodex/swarm-briefing"
import { DELEGATE_TOOL_NAME } from "../../src/opencodex/claude-transport"
import { normalizeToolName } from "../../src/opencodex/claude-mapper"
import { swarmProviderInfo, swarmRoutes, swarmModelRoute, isSwarmProvider } from "../../src/provider/swarm-provider"

const roles = [
  { name: "Orchestrator", skill: "orchestrator", instructions: "Coordinate carefully.", providerID: "anthropic", modelID: "claude-fable-5" },
  { name: "Designer", skill: "designer", instructions: "Review flows.\nBe strict.", providerID: "openai", modelID: "gpt-5.2" },
  { name: "QA Engineer", agent: "explore", providerID: "anthropic", modelID: "claude-haiku-4-5" },
]

describe("swarm briefing", () => {
  test("hands the orchestrator its team with per-role models and subagent types", () => {
    const briefing = buildSwarmBriefing({ swarmID: "swm_1", title: "Feature Team", roles })!
    expect(briefing.startsWith(SWARM_BRIEFING_MARK)).toBe(true)
    expect(briefing).toContain('orchestrator of the "Feature Team" swarm')
    expect(briefing).toContain("Your orchestrator instructions:\nCoordinate carefully.")
    // Specialists are listed with everything the task tool call needs,
    // including the swarm_role that ties each child back to its team member.
    expect(briefing).toContain('- Designer; swarm_role="Designer"; subagent_type="general"; model="openai/gpt-5.2"; skill: designer; instructions: Review flows. Be strict.')
    // A role naming a real agent delegates to that agent.
    expect(briefing).toContain('- QA Engineer; swarm_role="QA Engineer"; subagent_type="explore"; model="anthropic/claude-haiku-4-5"')
    // Fanning a role out into several parallel copies is explicitly allowed.
    expect(briefing).toContain("delegate that role several times in parallel")
    // The orchestrator itself is never listed as a delegate.
    expect(briefing).not.toContain('- Orchestrator;')
  })

  test("an orchestrator-only swarm is told to work alone", () => {
    const briefing = buildSwarmBriefing({ swarmID: "swm_1", title: "Solo", roles: roles.slice(0, 1) })!
    expect(briefing).toContain("no specialist roles configured")
  })

  test("no roles yields no briefing", () => {
    expect(buildSwarmBriefing({ swarmID: "swm_1", title: "Empty", roles: [] })).toBeUndefined()
  })
})

describe("swarm facade provider", () => {
  const swarms = [{ id: "swm_1", title: "Feature Team" }, { id: "swm_2", title: "Docs Crew" }]
  const roleRows = [
    { swarm_id: "swm_1", provider_id: "anthropic", model_id: "claude-fable-5" },
    { swarm_id: "swm_1", provider_id: "openai", model_id: "gpt-5.2" },
    { swarm_id: "swm_2", provider_id: null, model_id: null },
  ]

  test("each swarm becomes a selectable model named after it", () => {
    const info = swarmProviderInfo(swarmRoutes(swarms, roleRows))
    expect(isSwarmProvider(info.id)).toBe(true)
    expect(Object.keys(info.models)).toEqual(["swm_1", "swm_2"])
    expect(info.models["swm_1"].name).toBe("Feature Team")
  })

  test("the facade rides the orchestrator route for model resolution", () => {
    const info = swarmProviderInfo(swarmRoutes(swarms, roleRows))
    expect(swarmModelRoute(info.models["swm_1"])).toEqual({ providerID: "anthropic", modelID: "claude-fable-5" })
    // A swarm whose orchestrator has no model cannot resolve - the session
    // surfaces a model-not-found error instead of guessing.
    expect(swarmModelRoute(info.models["swm_2"])).toBeUndefined()
  })

  test("the first role by sort order is the orchestrator", () => {
    const routes = swarmRoutes(swarms, roleRows)
    expect(routes[0]).toMatchObject({ swarmID: "swm_1", roleCount: 2, orchestrator: { providerID: "anthropic", modelID: "claude-fable-5" } })
  })
})

describe("claude subscription roles", () => {
  test("a specialist can run on the Claude subscription", () => {
    // Specialists are delegated as subagent sessions, and the session loop
    // routes a claude-code model to the CLI driver regardless of parentage, so
    // the briefing passes the route through untouched.
    const briefing = buildSwarmBriefing({
      swarmID: "swm_1",
      title: "Team",
      roles: [
        { name: "Orchestrator", providerID: "anthropic", modelID: "claude-fable-5" },
        { name: "Reviewer", providerID: "claude-code", modelID: "sonnet" },
      ],
    })!
    expect(briefing).toContain('- Reviewer; swarm_role="Reviewer"; subagent_type="general"; model="claude-code/sonnet"')
  })

  test("an orchestrator on the Claude subscription keeps its route", () => {
    // The session loop reads this route and hands the turn to the CLI driver
    // rather than the AI SDK.
    const info = swarmProviderInfo(
      swarmRoutes([{ id: "swm_1", title: "Team" }], [{ swarm_id: "swm_1", provider_id: "claude-code", model_id: "sonnet" }]),
    )
    expect(swarmModelRoute(info.models["swm_1"])).toEqual({ providerID: "claude-code", modelID: "sonnet" })
  })
})

describe("claude code orchestrator", () => {
  const roles = [
    { name: "Orchestrator", providerID: "claude-code", modelID: "opus[1m]", instructions: "Lead." },
    { name: "Designer", skill: "designer", providerID: "openai", modelID: "gpt-5.2" },
  ]

  test("delegates through the OpencodeX tool instead of Claude's own subagents", () => {
    const briefing = buildSwarmBriefing({ swarmID: "swm_1", title: "Team", roles, delegation: "delegate-tool" })!
    expect(briefing).toContain(DELEGATE_TOOL_NAME)
    expect(briefing).toContain("Do not use the built-in Task tool")
    // The delegate tool resolves agent and model from the role, so the roster
    // does not repeat them on every call.
    expect(briefing).toContain("- Designer; skill: designer")
    expect(briefing).not.toContain("subagent_type=")
    expect(briefing).not.toContain('model="openai/gpt-5.2"')
  })

  test("an API orchestrator still uses the native task tool", () => {
    const briefing = buildSwarmBriefing({ swarmID: "swm_1", title: "Team", roles, delegation: "task-tool" })!
    expect(briefing).toContain("the task tool")
    expect(briefing).toContain('subagent_type="general"; model="openai/gpt-5.2"')
    expect(briefing).not.toContain(DELEGATE_TOOL_NAME)
  })

  test("the delegate tool renders as a normal subtask card", () => {
    // Pins the mapper's lookup key against the transport's actual tool name.
    expect(normalizeToolName(DELEGATE_TOOL_NAME)).toBe("task")
  })
})

describe("matchSwarmRole", () => {
  const roles = [{ name: "Senior Engineer" }, { name: "QA Engineer" }]

  test("tolerates the casing and spacing a model actually sends back", () => {
    // Observed live: the CLI called the tool with "designer" for role "Designer".
    expect(matchSwarmRole(roles, "senior engineer")?.name).toBe("Senior Engineer")
    expect(matchSwarmRole(roles, "  QA Engineer  ")?.name).toBe("QA Engineer")
    expect(matchSwarmRole(roles, "senior-engineer")?.name).toBe("Senior Engineer")
    expect(matchSwarmRole(roles, "SeniorEngineer")?.name).toBe("Senior Engineer")
  })

  test("returns nothing for an unknown or empty role", () => {
    expect(matchSwarmRole(roles, "Product Manager")).toBeUndefined()
    expect(matchSwarmRole(roles, "   ")).toBeUndefined()
  })
})

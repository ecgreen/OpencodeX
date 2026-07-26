import { describe, expect, test } from "bun:test"
import type { OpencodeXSwarm, Session } from "@opencode-ai/sdk/v2/client"
import {
  defaultSwarmRoles,
  nextSwarmRolePreset,
  roleInput,
  swarmIsWorking,
  swarmRolePresetBySkill,
  swarmProviderSelectionKey,
} from "../src/renderer/src/lib/swarm-actions"
import { defaultTeamRun, sessionSwarm, swarmTeamChildren, swarmTeamView, teamMemberForSession } from "../src/renderer/src/lib/swarm-team"
import type { GuiSnapshot } from "../src/renderer/src/lib/store"

describe("GUI swarm action helpers", () => {
  test("normalizes role payloads without empty optional fields", () => {
    expect(roleInput({ name: "  Lead  ", agent: " ", providerID: "opencode", modelID: " zen ", instructions: "  Coordinate " })).toEqual({
      name: "Lead",
      providerID: "opencode",
      modelID: "zen",
      instructions: "Coordinate",
      agent: undefined,
      skill: undefined,
      modelProfile: undefined,
      metadata: undefined,
    })
    expect(roleInput({ name: "  Lead  " }).instructions).toBe("")
  })

  test("starts new swarms with an unconfigured orchestrator", () => {
    // Models are never inherited - the user picks one explicitly per role.
    expect(defaultSwarmRoles().map((role) => [role.name, role.skill, role.providerID, role.modelID])).toEqual([
      ["Orchestrator", "orchestrator", undefined, undefined],
    ])
    expect(defaultSwarmRoles()[0]?.instructions).toBe("")
  })

  test("adds remaining specialist presets before falling back to custom roles", () => {
    expect(nextSwarmRolePreset([{ name: "Product Manager", skill: "product-manager" }])?.name).toBe("Designer")
    expect(nextSwarmRolePreset([
      { name: "Product Manager", skill: "product-manager" },
      { name: "Designer", skill: "designer" },
      { name: "Architect", skill: "architect" },
      { name: "Senior Engineer", skill: "senior-engineer" },
      { name: "QA Engineer", skill: "qa-engineer" },
      { name: "Code Reviewer", skill: "code-reviewer" },
    ])?.name).toBe("Docs Engineer")
  })

  test("finds role presets by skill for the GUI skill picker", () => {
    expect(swarmRolePresetBySkill("designer")?.name).toBe("Designer")
    expect(swarmRolePresetBySkill("unknown")).toBeUndefined()
  })

  test("keeps the provider selection identity stable when roles share providers", () => {
    expect(swarmProviderSelectionKey([{ providerID: "opencode" }])).toBe(
      swarmProviderSelectionKey([{ providerID: "opencode" }, { providerID: "opencode" }]),
    )
    expect(swarmProviderSelectionKey([{ providerID: "z" }, { providerID: "a" }])).toBe(
      swarmProviderSelectionKey([{ providerID: "a" }, { providerID: "z" }]),
    )
  })

  test("a swarm is working when any session on it is busy", () => {
    const snapshot = {
      projects: [],
      sessions: [session({ id: "s1", model: { providerID: "swarm", id: "swm_1" } })],
      sessionStatus: { s1: { type: "busy" } },
    } as unknown as GuiSnapshot
    expect(swarmIsWorking({ id: "swm_1" }, snapshot)).toBe(true)
    expect(swarmIsWorking({ id: "swm_2" }, snapshot)).toBe(false)
  })
})

describe("swarm team view", () => {
  const swarm = {
    id: "swm_1",
    title: "Feature Team",
    roles: [
      { name: "Orchestrator" },
      { name: "Designer", skill: "designer" },
      { name: "QA Engineer", agent: "explore" },
    ],
  } as OpencodeXSwarm

  test("the session's swarm comes from its model route", () => {
    const active = session({ id: "s1", model: { providerID: "swarm", id: "swm_1" } })
    expect(sessionSwarm(active, [swarm])?.title).toBe("Feature Team")
    expect(sessionSwarm(session({ id: "s2" }), [swarm])).toBeUndefined()
  })

  test("children group under roles by tag first, title second", () => {
    const children = [
      // Delegate-tool child: tagged with the role it ran as.
      session({ id: "c1", parentID: "s1", title: "Designer (swarm role)", updated: 3, metadata: { opencodex: { swarmID: "swm_1", swarmRole: "Designer" } } }),
      // Task-tool child: the role name only appears in the title.
      session({ id: "c2", parentID: "s1", title: "qa-engineer: verify flows (@explore subagent)", updated: 2 }),
      // Unrelated subagent still surfaces instead of hiding work.
      session({ id: "c3", parentID: "s1", title: "Research competitors (@general subagent)", updated: 1 }),
    ]
    const view = swarmTeamView({ swarm, children, sessionStatus: { c1: { type: "busy" } } as GuiSnapshot["sessionStatus"] })
    expect(view.members.map((member) => [member.name, member.runs.map((run) => run.id)])).toEqual([
      ["Designer", ["c1"]],
      ["QA Engineer", ["c2"]],
      ["Other agents", ["c3"]],
    ])
    expect(view.members[0].busy).toBe(true)
    expect(view.members[0].runs[0].title).toBe("Designer")
    expect(view.members[1].busy).toBe(false)
  })

  test("the strip opens the busy run first, else the newest", () => {
    const member = {
      key: "designer",
      name: "Designer",
      busy: true,
      runs: [
        { id: "new", title: "Designer", updated: 5, busy: false },
        { id: "working", title: "Designer", updated: 1, busy: true },
      ],
    }
    expect(defaultTeamRun(member)?.id).toBe("working")
    expect(defaultTeamRun({ ...member, runs: member.runs.map((run) => ({ ...run, busy: false })) })?.id).toBe("new")
  })

  test("member lookup and child filtering stay scoped to the parent", () => {
    const children = swarmTeamChildren(
      [session({ id: "c1", parentID: "s1" }), session({ id: "c2", parentID: "other" }), session({ id: "s1" })],
      "s1",
    )
    expect(children.map((child) => child.id)).toEqual(["c1"])
    const view = swarmTeamView({
      swarm,
      children: [session({ id: "c1", parentID: "s1", title: "Designer (swarm role)" })],
      sessionStatus: {} as GuiSnapshot["sessionStatus"],
    })
    expect(teamMemberForSession(view, "c1")?.name).toBe("Designer")
    expect(teamMemberForSession(view, "missing")).toBeUndefined()
  })
})

function session(input: { id: string; parentID?: string; title?: string; updated?: number; model?: { providerID: string; id: string }; metadata?: Record<string, unknown> }): Session {
  return {
    id: input.id,
    parentID: input.parentID,
    title: input.title ?? "Session",
    model: input.model,
    metadata: input.metadata,
    time: { created: 1, updated: input.updated ?? 1 },
  } as unknown as Session
}

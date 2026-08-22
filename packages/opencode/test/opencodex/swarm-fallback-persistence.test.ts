import { expect } from "bun:test"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"
import { OpencodeXSwarm } from "../../src/opencodex/swarm"
import { testEffect } from "../lib/effect"

const it = testEffect(OpencodeXSwarm.defaultLayer)
const primary = { providerID: ProviderV2.ID.make("anthropic"), modelID: ProviderV2.ModelID.make("primary") }
const fallback = { providerID: ProviderV2.ID.make("openai"), modelID: ProviderV2.ModelID.make("backup") }

it.instance("persists fallbacks across every swarm role mutation path", () =>
  Effect.gen(function* () {
    const swarms = yield* OpencodeXSwarm.Service
    const created = yield* swarms.create({
      roles: [
        { name: "Orchestrator", instructions: "coordinate" },
        { name: "Builder", instructions: "build", ...primary, fallbackModels: [fallback] },
      ],
    })
    expect(created.roles[1]?.fallbackModels).toEqual([fallback])

    const renamed = yield* Effect.flip(
      swarms.update(created.id, {
        roles: [
          { name: "Orchestrator", instructions: "coordinate" },
          { name: "Renamed Builder", instructions: "build", ...primary },
        ],
      }),
    )
    expect(renamed).toMatchObject({ message: expect.stringContaining("current client") })

    // Reordering no longer trips the legacy-client guard - chains pair by
    // normalized name, not index (see swarm-model-fallback.test.ts) - so the
    // only objection left to this roster is orchestrator-first validation.
    const reordered = yield* Effect.flip(
      swarms.update(created.id, {
        roles: [
          { name: "Builder", instructions: "build", ...primary },
          { name: "Orchestrator", instructions: "coordinate" },
        ],
      }),
    )
    expect(reordered).toMatchObject({ message: expect.stringContaining("Orchestrator") })

    const preserved = yield* swarms.update(created.id, {
      roles: [
        { name: "Orchestrator", instructions: "coordinate" },
        { name: " builder ", instructions: "build again", ...primary },
      ],
    })
    expect(preserved.roles[1]?.fallbackModels).toEqual([fallback])

    const cleared = yield* swarms.update(created.id, {
      roles: [
        { name: "Orchestrator", instructions: "coordinate" },
        { name: "Builder", instructions: "build", ...primary, fallbackModels: [] },
      ],
    })
    expect(cleared.roles[1]?.fallbackModels).toEqual([])

    const added = yield* swarms.addRole(created.id, {
      role: { name: "Reviewer", instructions: "review", ...primary, fallbackModels: [fallback] },
    })
    const reviewer = added.roles.find((role) => role.name === "Reviewer")!
    expect(reviewer.fallbackModels).toEqual([fallback])

    const updated = yield* swarms.updateRole(created.id, reviewer.id, { fallbackModels: [], variant: "default" })
    expect(updated.roles.find((role) => role.id === reviewer.id)).toMatchObject({
      fallbackModels: [],
      variant: undefined,
    })

    const shifting = yield* swarms.create({
      roles: [
        { name: "Orchestrator", instructions: "coordinate" },
        { name: "Analyst", instructions: "analyze", ...primary },
        { name: "Builder", instructions: "build", ...primary, fallbackModels: [fallback] },
      ],
    })
    // Chains pair by normalized name, so an old client removing or inserting
    // a preceding role no longer shifts a chain off its role - the update is
    // safe and the stored chain survives in place.
    const removedPrecedingRole = yield* swarms.update(shifting.id, {
      roles: [
        { name: "Orchestrator", instructions: "coordinate" },
        { name: "Builder", instructions: "build", ...primary },
      ],
    })
    expect(removedPrecedingRole.roles.find((role) => role.name === "Builder")?.fallbackModels).toEqual([fallback])

    const insertedPrecedingRole = yield* swarms.update(shifting.id, {
      roles: [
        { name: "Orchestrator", instructions: "coordinate" },
        { name: "Researcher", instructions: "research", ...primary },
        { name: "Analyst", instructions: "analyze", ...primary },
        { name: "Builder", instructions: "build", ...primary },
      ],
    })
    expect(insertedPrecedingRole.roles.find((role) => role.name === "Builder")?.fallbackModels).toEqual([fallback])
    expect(insertedPrecedingRole.roles.find((role) => role.name === "Researcher")?.fallbackModels).toEqual([])

    // A rename without the field from an old client still cannot carry the
    // chain over and stays rejected (covered above); deletion of the
    // chain-carrying role itself is the other rejection path.
    const removedChainRole = yield* Effect.flip(
      swarms.update(shifting.id, {
        roles: [
          { name: "Orchestrator", instructions: "coordinate" },
          { name: "Analyst", instructions: "analyze", ...primary },
        ],
      }),
    )
    expect(removedChainRole).toMatchObject({ message: expect.stringContaining("current client") })

    const explicitlyMoved = yield* swarms.update(shifting.id, {
      roles: [
        { name: "Orchestrator", instructions: "coordinate", fallbackModels: [] },
        { name: "Builder", instructions: "build", ...primary, fallbackModels: [fallback] },
      ],
    })
    expect(explicitlyMoved.roles[1]?.fallbackModels).toEqual([fallback])

    // A fallback-aware client adding a role sends no fallbackModels for it -
    // that must not downgrade the rest of the roster to "old client" and
    // reject a rename the same payload already spells out in full.
    const renamedBesideNewRole = yield* swarms.update(shifting.id, {
      roles: [
        { name: "Orchestrator", instructions: "coordinate", fallbackModels: [] },
        { name: "Systems Builder", instructions: "build", ...primary, fallbackModels: [fallback] },
        { name: "Docs Engineer", instructions: "document", ...primary },
      ],
    })
    expect(renamedBesideNewRole.roles.map((role) => [role.name, role.fallbackModels])).toEqual([
      ["Orchestrator", []],
      ["Systems Builder", [fallback]],
      ["Docs Engineer", []],
    ])
  }),
)

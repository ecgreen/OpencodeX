import { describe, expect, test } from "bun:test"
import { ProviderV2 } from "@opencode-ai/core/provider"
import {
  hydrateFallbackModels,
  mergeRoleFallbacks,
  normalizeRole,
  validateRoles,
} from "../../src/opencodex/swarm-model"
import type { Role, RoleInput } from "../../src/opencodex/swarm-schema"

describe("swarm role model fallbacks", () => {
  test("normalizes default variants and malformed storage", () => {
    const normalized = normalizeRole(
      role({
        variant: "default",
        fallbackModels: [{ providerID: provider("openai"), modelID: model("gpt-5"), variant: "default" }],
      }),
    )
    expect(normalized.variant).toBeUndefined()
    expect(normalized.fallbackModels?.[0]?.variant).toBeUndefined()
    expect(hydrateFallbackModels("not json")).toEqual([])
    expect(hydrateFallbackModels('{"providerID":"openai"}')).toEqual([])
  })

  test("requires a complete primary and rejects swarm or duplicate fallbacks", () => {
    expect(
      validateRoles(team(role({ providerID: undefined, modelID: undefined, fallbackModels: [fallback()] }))),
    ).toContain("complete primary")
    expect(validateRoles(team(role({ fallbackModels: [{ ...fallback(), providerID: provider("swarm") }] })))).toContain(
      "swarm provider",
    )
    expect(
      validateRoles(team(role({ fallbackModels: [{ providerID: provider("anthropic"), modelID: model("primary") }] }))),
    ).toContain("duplicate")
    expect(
      validateRoles(team(role({ fallbackModels: [{ providerID: provider(""), modelID: model("backup") }] }))),
    ).toContain("incomplete")
    expect(
      validateRoles([
        { ...role({ name: "Orchestrator", fallbackModels: [fallback()] }), skill: "orchestrator" },
        role(),
      ]),
    ).toContain("Orchestrator")
  })

  test("sanitizes persisted chains before execution", () => {
    expect(
      hydrateFallbackModels(
        JSON.stringify([
          { providerID: "anthropic", modelID: "primary" },
          { malformed: true },
          { providerID: " swarm ", modelID: "nested" },
          { providerID: "", modelID: "empty" },
          { providerID: " openai ", modelID: " backup ", variant: " default " },
          { providerID: "openai", modelID: "backup" },
          { providerID: "google", modelID: "backup-2" },
          { providerID: "xai", modelID: "backup-3" },
          { providerID: "groq", modelID: "backup-4" },
          { providerID: "mistral", modelID: "backup-5" },
        ]),
        { providerID: "anthropic", modelID: "primary" },
      ),
    ).toEqual([
      { providerID: provider("openai"), modelID: model("backup") },
      { providerID: provider("google"), modelID: model("backup-2") },
      { providerID: provider("xai"), modelID: model("backup-3") },
      { providerID: provider("groq"), modelID: model("backup-4") },
    ])
  })

  test("allows an ordered distinct fallback chain", () => {
    expect(
      validateRoles(team(role({ fallbackModels: [fallback(), { ...fallback(), modelID: model("backup-2") }] }))),
    ).toBeUndefined()
  })

  test("rejects the same provider and model even with a different variant", () => {
    expect(
      validateRoles(
        team(
          role({
            variant: "high",
            fallbackModels: [{ providerID: provider("anthropic"), modelID: model("primary"), variant: "low" }],
          }),
        ),
      ),
    ).toContain("duplicate")
  })

  test("preserves omitted fallbacks by normalized role name", () => {
    const existing = storedRole(" Specialist ", [fallback()])
    expect(mergeRoleFallbacks([role({ name: "specialist" })], [existing])).toMatchObject({
      roles: [{ fallbackModels: [fallback()] }],
    })
    expect(mergeRoleFallbacks([role({ name: "specialist", fallbackModels: [] })], [existing])).toMatchObject({
      roles: [{ fallbackModels: [] }],
    })
    expect(mergeRoleFallbacks([role({ name: "different" })], [existing])).toHaveProperty("error")
  })

  test("preserves stored chains when a client reorders roles without sending fallbackModels", () => {
    const stored = [storedRole("Planner", []), storedRole("Specialist", [fallback()])]
    // The chain-carrying role moves to index 0; index pairing would drop it.
    const merged = mergeRoleFallbacks(
      [role({ name: "specialist", fallbackModels: [fallback()] }), role({ name: "planner" })],
      stored,
    )
    expect(merged).toMatchObject({
      roles: [{ fallbackModels: [fallback()] }, { fallbackModels: [] }],
    })
    // Same reorder from an old client that sends the field on no role at all.
    const legacy = mergeRoleFallbacks([role({ name: "specialist" }), role({ name: "planner" })], stored)
    expect(legacy).toMatchObject({
      roles: [{ fallbackModels: [fallback()] }, { fallbackModels: [] }],
    })
  })

  test("rejects normalized role-name collisions before legacy fallback merging", () => {
    expect(
      validateRoles([
        { name: "Orchestrator", instructions: "coordinate" },
        role({ name: "Code Reviewer" }),
        role({ name: "code-reviewer" }),
      ]),
    ).toContain("unique name")
  })

  test("caps role fallback chains at four models", () => {
    expect(
      validateRoles(
        team(
          role({
            fallbackModels: Array.from({ length: 5 }, (_, index) => ({
              providerID: provider("openai"),
              modelID: model(`backup-${index}`),
            })),
          }),
        ),
      ),
    ).toContain("at most 4")
  })
})

function provider(value: string) {
  return ProviderV2.ID.make(value)
}

function model(value: string) {
  return ProviderV2.ModelID.make(value)
}

function fallback() {
  return { providerID: provider("openai"), modelID: model("backup") }
}

function role(overrides: Partial<RoleInput> = {}): RoleInput {
  return {
    name: "Specialist",
    instructions: "work",
    providerID: provider("anthropic"),
    modelID: model("primary"),
    ...overrides,
  }
}

function team(specialist: RoleInput): RoleInput[] {
  return [{ name: "Orchestrator", instructions: "coordinate" }, specialist]
}

function storedRole(name: string, fallbackModels: Role["fallbackModels"]): Role {
  return {
    id: "role_1",
    swarmID: "swarm_1",
    name,
    fallbackModels,
    status: "planned",
    instructions: "work",
    sortOrder: 0,
    timeCreated: 1,
    timeUpdated: 1,
  }
}

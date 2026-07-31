import { describe, expect, test } from "bun:test"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { resolveExecutor, type SwarmRoleRow } from "../../src/opencodex/goal-executor"
import { advanceSchedule, scheduleDue } from "../../src/opencodex/goal-reconcile"
import type { Status } from "../../src/opencodex/goal-schema"

const roles: SwarmRoleRow[] = [
  { name: "Orchestrator", provider_id: "anthropic", model_id: "claude-fable-5" },
  {
    name: "Code Reviewer",
    skill: "reviewer",
    agent: "explore",
    instructions: "  Be strict.  ",
    provider_id: "openai",
    model_id: "gpt-5.2",
  },
  { name: "Docs", provider_id: null, model_id: null },
]

const fallback = { providerID: "anthropic", modelID: "claude-sonnet-5" }

function resolved(result: ReturnType<typeof resolveExecutor>) {
  if ("error" in result) throw new Error(result.error)
  return result.executor
}

describe("executor resolution", () => {
  test("a swarm role brings its own model, agent, skill, and instructions", () => {
    const executor = resolved(
      resolveExecutor({ executor: { type: "swarm_role", role: "Code Reviewer" }, kind: "task", roles }),
    )
    expect(executor).toEqual({
      label: "Code Reviewer",
      roleName: "Code Reviewer",
      providerID: "openai",
      modelID: "gpt-5.2",
      agent: "explore",
      skill: "reviewer",
      instructions: "Be strict.",
    })
  })

  test("role names match as leniently as delegation already does", () => {
    for (const name of ["code reviewer", "CODE_REVIEWER", "  Code-Reviewer "]) {
      expect(resolved(resolveExecutor({ executor: { type: "swarm_role", role: name }, kind: "task", roles })).roleName).toBe(
        "Code Reviewer",
      )
    }
  })

  test("an unknown role says what the team actually has", () => {
    const result = resolveExecutor({ executor: { type: "swarm_role", role: "Archivist" }, kind: "task", roles })
    expect(result).toEqual({
      error: 'Unknown swarm role "Archivist". Available: Orchestrator, Code Reviewer, Docs.',
    })
  })

  test("a role with no model of its own falls back to the goal's", () => {
    expect(
      resolved(resolveExecutor({ executor: { type: "swarm_role", role: "Docs" }, kind: "task", roles, fallback })),
    ).toMatchObject({ providerID: "anthropic", modelID: "claude-sonnet-5" })

    expect(resolveExecutor({ executor: { type: "swarm_role", role: "Docs" }, kind: "task", roles })).toEqual({
      error: 'Swarm role "Docs" has no model configured.',
    })
  })

  test("an agent executor keeps its agent and may name its own model", () => {
    expect(
      resolved(
        resolveExecutor({
          executor: {
            type: "agent",
            agent: "build",
            providerID: ProviderV2.ID.make("openai"),
            modelID: ProviderV2.ModelID.make("gpt-5.2"),
          },
          kind: "task",
          fallback,
        }),
      ),
    ).toEqual({ label: "build", agent: "build", providerID: "openai", modelID: "gpt-5.2", skill: undefined, instructions: undefined })
  })

  test("a bare model executor inherits the goal's model", () => {
    const executor = resolved(resolveExecutor({ executor: { type: "model" }, kind: "check", fallback }))
    expect(executor).toMatchObject({ providerID: "anthropic", modelID: "claude-sonnet-5" })
    // No agent means the session's default, which is what a bare model asks for.
    expect(executor.agent).toBeUndefined()
  })

  test("no model anywhere is a clear error, not a silent default", () => {
    expect(resolveExecutor({ executor: { type: "model" }, kind: "task" })).toEqual({
      error: "No model available for this node: name one on the executor or give the goal a default.",
    })
    expect(resolveExecutor({ kind: "task" })).toEqual({ error: "A task node needs an executor." })
  })

  test("blank instructions do not become an empty prompt layer", () => {
    const executor = resolved(
      resolveExecutor({ executor: { type: "model", instructions: "   " }, kind: "task", fallback }),
    )
    expect(executor.instructions).toBeUndefined()
  })
})

describe("standing goals", () => {
  const schedule = { everyMs: 3_600_000 }
  const goal = (overrides: Partial<Parameters<typeof scheduleDue>[0]["goal"]> = {}) => ({
    status: "completed" as Status,
    schedule,
    nodeCount: 3,
    ...overrides,
  })

  test("a goal that has never run is due immediately", () => {
    expect(scheduleDue({ goal: goal(), now: 1_000 })).toBe(true)
  })

  test("a cadence that has not elapsed is not due", () => {
    expect(scheduleDue({ goal: goal({ schedule: { everyMs: 1_000, nextRunAt: 5_000 } }), now: 4_999 })).toBe(false)
    expect(scheduleDue({ goal: goal({ schedule: { everyMs: 1_000, nextRunAt: 5_000 } }), now: 5_000 })).toBe(true)
  })

  test("a run is never started on top of one already in flight", () => {
    for (const status of ["running", "blocked", "draft"] as Status[]) {
      expect(scheduleDue({ goal: goal({ status }), now: 1_000 })).toBe(false)
    }
    // A failed or paused run still gets its next scheduled attempt.
    for (const status of ["failed", "paused", "cancelled", "planned"] as Status[]) {
      expect(scheduleDue({ goal: goal({ status }), now: 1_000 })).toBe(true)
    }
  })

  test("a goal with no plan, no schedule, or a paused one stays put", () => {
    expect(scheduleDue({ goal: goal({ nodeCount: 0 }), now: 1_000 })).toBe(false)
    expect(scheduleDue({ goal: goal({ schedule: undefined }), now: 1_000 })).toBe(false)
    expect(scheduleDue({ goal: goal({ schedule: { everyMs: 1_000, paused: true } }), now: 1_000 })).toBe(false)
    expect(scheduleDue({ goal: goal({ schedule: { everyMs: 0 } }), now: 1_000 })).toBe(false)
  })

  test("the next run is anchored to this one, so a slow run does not stack up work", () => {
    expect(advanceSchedule({ everyMs: 1_000, nextRunAt: 2_000 }, 9_000)).toEqual({
      everyMs: 1_000,
      lastRunAt: 9_000,
      nextRunAt: 10_000,
    })
  })
})

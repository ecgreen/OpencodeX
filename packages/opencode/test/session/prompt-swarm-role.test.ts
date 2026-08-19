import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit } from "effect"
import { EffectBridge } from "../../src/effect/bridge"
import { ClaudeDelegate } from "../../src/opencodex/claude-delegate"
import * as PromptSwarm from "../../src/session/prompt-swarm"
import type { DelegationRecord } from "../../src/session/delegation-outcome"
import { SessionID } from "../../src/session/schema"

/**
 * The delegated-specialist prompt is assembled from up to three layers:
 * the role's skill body, the role's own instructions, and the task. A
 * specialist never sees the skill tool's inventory, so the skill body has
 * to arrive here or not at all.
 */
describe("swarm role delegation prompt", () => {
  test("prefixes the skill body ahead of instructions and the task", async () => {
    const { runSwarmRole, prompts, stamps } = harness({
      skills: { designer: "You are the designer role. Review flows and states." },
    })

    const report = await Effect.runPromise(
      runSwarmRole({
        sessionID: SessionID.make("ses_parent"),
        swarmID: "swm_1",
        roles: [role({ name: "Designer", skill: "designer", instructions: "Prefer boring layouts." })],
        role: "Designer",
        prompt: "Review the settings page.",
      }),
    )

    expect(report).toEqual({ ok: true, text: "done" })
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toBe(
      "You are the designer role. Review flows and states.\n\nPrefer boring layouts.\n\nReview the settings page.",
    )
    // The run stamped `running` before the prompt and settled through the
    // exit boundary, compare-and-set against its own runID.
    expect(stamps).toHaveLength(2)
    expect(stamps[0]).toMatchObject({
      record: { phase: "running", parentSessionID: "ses_parent", attempt: 1 },
    })
    expect(stamps[1]).toMatchObject({
      record: { phase: "settled", outcome: "completed", summary: "done" },
      expectRunID: stamps[0].record.runID,
    })
  })

  test("sends instructions and task alone when the role has no skill", async () => {
    const { runSwarmRole, prompts } = harness({ skills: {} })

    await Effect.runPromise(
      runSwarmRole({
        sessionID: SessionID.make("ses_parent"),
        swarmID: "swm_1",
        roles: [role({ name: "Migrator", skill: null, instructions: "Always plan a rollback." })],
        role: "Migrator",
        prompt: "Move the user table.",
      }),
    )

    expect(prompts[0]).toBe("Always plan a rollback.\n\nMove the user table.")
  })

  test("skips an unregistered skill slug instead of failing the delegation", async () => {
    const { runSwarmRole, prompts } = harness({ skills: {} })

    await Effect.runPromise(
      runSwarmRole({
        sessionID: SessionID.make("ses_parent"),
        swarmID: "swm_1",
        roles: [role({ name: "Specialist", skill: "no-such-skill", instructions: "" })],
        role: "Specialist",
        prompt: "Do the task.",
      }),
    )

    expect(prompts[0]).toBe("Do the task.")
  })
})

describe("swarm role delegation validation", () => {
  test("rejects an unknown role without creating or stamping child work", async () => {
    const { runSwarmRole, prompts, stamps } = harness({ skills: {} })

    expect(await Effect.runPromise(run(runSwarmRole, { role: "Unknown" }))).toEqual({
      ok: false,
      reason: "rejected",
    })
    expect(prompts).toHaveLength(0)
    expect(stamps).toHaveLength(0)
  })

  test.each([
    ["provider", role({ name: "Specialist", skill: null, instructions: "", providerID: null })],
    ["model", role({ name: "Specialist", skill: null, instructions: "", modelID: null })],
  ])("rejects a role missing its %s configuration", async (_field, configuredRole) => {
    const { runSwarmRole, prompts, stamps } = harness({ skills: {} })

    expect(await Effect.runPromise(run(runSwarmRole, { roles: [configuredRole] }))).toEqual({
      ok: false,
      reason: "rejected",
    })
    expect(prompts).toHaveLength(0)
    expect(stamps).toHaveLength(0)
  })
})

/**
 * The stamp is the graph's only witness to how a role run ended, so every
 * exit shape must settle it: assistant error, typed failure, defect, and
 * interruption alike.
 */
describe("swarm role delegation stamping", () => {
  test("an assistant-level error settles the run as errored", async () => {
    const { runSwarmRole, stamps } = harness({
      skills: {},
      promptResult: Effect.succeed({
        info: { role: "assistant", error: { name: "UnknownError", data: { message: "boom" } } },
        parts: [],
      }),
    })

    const report = await Effect.runPromise(run(runSwarmRole))
    expect(report).toEqual({ ok: false, reason: "errored" })
    expect(stamps[1]).toMatchObject({ record: { phase: "settled", outcome: "errored" } })
  })

  test("synthetic-only output becomes a structured error", async () => {
    const { runSwarmRole, stamps } = harness({
      skills: {},
      promptResult: Effect.succeed({
        info: { role: "assistant", error: undefined },
        parts: [{ type: "text", text: "generated placeholder", synthetic: true }],
      }),
    })

    expect(await Effect.runPromise(run(runSwarmRole))).toEqual({ ok: false, reason: "empty-output" })
    expect(stamps[1]).toMatchObject({
      record: {
        phase: "settled",
        outcome: "errored",
        summary: "The delegated role completed without a usable report.",
      },
    })
  })

  test("literal empty and whitespace output becomes a structured error", async () => {
    const { runSwarmRole, stamps } = harness({
      skills: {},
      promptResult: Effect.succeed({
        info: { role: "assistant", error: undefined },
        parts: [
          { type: "text", text: "", synthetic: false },
          { type: "text", text: "  \n\t", synthetic: false },
        ],
      }),
    })

    expect(await Effect.runPromise(run(runSwarmRole))).toEqual({ ok: false, reason: "empty-output" })
    expect(stamps[1]).toMatchObject({ record: { phase: "settled", outcome: "errored" } })
  })

  test("assistant errors expose and persist only a generic message", async () => {
    const secret = "sk-live-provider-secret"
    const { runSwarmRole, stamps } = harness({
      skills: {},
      promptResult: Effect.succeed({
        info: {
          role: "assistant",
          error: { data: { message: `provider failed with ${secret}` } },
        },
        parts: [],
      }),
    })

    const result = await Effect.runPromise(run(runSwarmRole))
    expect(result).toEqual({ ok: false, reason: "errored" })
    expect(stamps[1]).toMatchObject({
      record: { phase: "settled", outcome: "errored", summary: "The delegated role failed." },
    })
    expect(JSON.stringify({ result, stamp: stamps[1] })).not.toContain(secret)
  })

  test("a typed prompt failure settles the run as errored and still dies", async () => {
    const { runSwarmRole, stamps } = harness({
      skills: {},
      promptResult: Effect.fail(new Error("provider down")),
    })

    const exit = await Effect.runPromiseExit(run(runSwarmRole))
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(stamps[1]).toMatchObject({ record: { phase: "settled", outcome: "errored" } })
  })

  test("a defect settles the run as errored", async () => {
    const { runSwarmRole, stamps } = harness({
      skills: {},
      promptResult: Effect.die(new Error("defect")),
    })

    const exit = await Effect.runPromiseExit(run(runSwarmRole))
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(stamps[1]).toMatchObject({ record: { phase: "settled", outcome: "errored" } })
  })

  test("interruption settles the run as cancelled", async () => {
    const { runSwarmRole, stamps } = harness({
      skills: {},
      promptResult: Effect.interrupt,
    })

    const exit = await Effect.runPromiseExit(run(runSwarmRole))
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(stamps[1]).toMatchObject({ record: { phase: "settled", outcome: "cancelled" } })
  })

  test("request abort waits for the cancelled stamp before resolving", async () => {
    const ready = await Effect.runPromise(Deferred.make<void>())
    const controller = new AbortController()
    const { runSwarmRole, stamps } = harness({
      skills: {},
      promptResult: Effect.gen(function* () {
        yield* Deferred.succeed(ready, undefined)
        return yield* Effect.never
      }),
    })
    const capability = ClaudeDelegate.capability(await Effect.runPromise(EffectBridge.make()), {
      roles: [{ name: "Specialist" }],
      run: (input) =>
        runSwarmRole({
          sessionID: SessionID.make("ses_parent"),
          swarmID: "swm_1",
          roles: [role({ name: "Specialist", skill: null, instructions: "" })],
          role: input.role,
          prompt: input.prompt,
        }),
    })

    const callback = capability.run({ role: "Specialist", prompt: "Do the task.", signal: controller.signal })
    await Effect.runPromise(Deferred.await(ready))
    controller.abort()

    expect(await callback).toEqual({ ok: false, reason: "cancelled" })
    expect(stamps[1]).toMatchObject({ record: { phase: "settled", outcome: "cancelled" } })
  })

  test("pre-aborted capability does not create child work, finalizers, or stamps", async () => {
    const controller = new AbortController()
    const events: string[] = []
    controller.abort()
    const { runSwarmRole, prompts, stamps } = harness({ skills: {} })
    const capability = ClaudeDelegate.capability(await Effect.runPromise(EffectBridge.make()), {
      roles: [{ name: "Specialist" }],
      run: (input) => {
        events.push("created")
        return runSwarmRole({
          sessionID: SessionID.make("ses_parent"),
          swarmID: "swm_1",
          roles: [role({ name: "Specialist", skill: null, instructions: "" })],
          role: input.role,
          prompt: input.prompt,
        }).pipe(Effect.ensuring(Effect.sync(() => events.push("finalized"))))
      },
    })

    expect(
      await capability.run({ role: "Specialist", prompt: "Do the task.", signal: controller.signal }),
    ).toEqual({ ok: false, reason: "cancelled" })
    expect(events).toEqual([])
    expect(prompts).toHaveLength(0)
    expect(stamps).toHaveLength(0)
  })

  test("a failure before the prompt begins still settles the created child", async () => {
    const { runSwarmRole, prompts, stamps } = harness({
      skills: {},
      skillFailure: Effect.die(new Error("skill store down")),
    })

    const exit = await Effect.runPromiseExit(
      run(runSwarmRole, { roles: [role({ name: "Specialist", skill: "specialist", instructions: "" })] }),
    )
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(prompts).toHaveLength(0)
    expect(stamps[0]).toMatchObject({ record: { phase: "running" } })
    expect(stamps[1]).toMatchObject({ record: { phase: "settled", outcome: "errored" } })
  })
})

function run(
  runSwarmRole: ReturnType<typeof PromptSwarm.make>["runSwarmRole"],
  overrides: { roles?: PromptSwarm.SwarmRoleRow[]; role?: string } = {},
) {
  return runSwarmRole({
    sessionID: SessionID.make("ses_parent"),
    swarmID: "swm_1",
    roles: overrides.roles ?? [role({ name: "Specialist", skill: null, instructions: "" })],
    role: overrides.role ?? "Specialist",
    prompt: "Do the task.",
  })
}

function role(input: {
  name: string
  skill: string | null
  instructions: string
  providerID?: string | null
  modelID?: string | null
}): PromptSwarm.SwarmRoleRow {
  return {
    name: input.name,
    agent: null,
    skill: input.skill,
    instructions: input.instructions,
    provider_id: input.providerID === undefined ? "anthropic" : input.providerID,
    model_id: input.modelID === undefined ? "claude-sonnet-5" : input.modelID,
    variant: null,
  }
}

/**
 * runSwarmRole touches sessions, skills, and prompt; the database dep is only
 * read by the briefing path, so a bare object stands in for it here.
 */
function harness(input: {
  skills: Record<string, string>
  /** Overrides what the child prompt resolves to, for exit-shape tests. */
  promptResult?: Effect.Effect<unknown, unknown>
  /** Overrides the skill lookup, for pre-prompt failure tests. */
  skillFailure?: Effect.Effect<never>
}) {
  const prompts: string[] = []
  const stamps: Array<{ record: DelegationRecord; expectRunID?: string }> = []
  const deps = {
    claudeDriver: {} as never,
    database: {} as never,
    sessions: {
      get: () => Effect.succeed({ permission: undefined, metadata: { opencodex: { swarmID: "swm_1" } } }),
      create: () => Effect.succeed({ id: "ses_child" }),
      stampDelegation: (write: { sessionID: string; record: DelegationRecord; expectRunID?: string }) => {
        stamps.push({ record: write.record, ...(write.expectRunID ? { expectRunID: write.expectRunID } : {}) })
        return Effect.succeed(true)
      },
    } as never,
    skills: {
      get: (name: string) =>
        input.skillFailure ??
        Effect.succeed(
          input.skills[name] !== undefined
            ? { name, location: "builtin", content: input.skills[name] }
            : undefined,
        ),
    } as never,
    prompt: (promptInput: { parts: Array<{ type: string; text?: string }> }) => {
      if (input.promptResult) return input.promptResult
      const text = promptInput.parts.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n")
      prompts.push(text)
      return Effect.succeed({
        info: { role: "assistant", error: undefined },
        parts: [{ type: "text", text: "done", synthetic: false }],
      })
    },
  }
  const { runSwarmRole } = PromptSwarm.make(deps as never)
  return { runSwarmRole, prompts, stamps }
}

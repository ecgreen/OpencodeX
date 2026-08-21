import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
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

    expect(report).toBe("done")
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

describe("swarm role model fallback", () => {
  test("tries configured models in order and stops on success", async () => {
    const { runSwarmRole, models, prompts, loops, userMessages } = harness({
      skills: {},
      promptResults: [failure("insufficient_quota"), success("fallback worked")],
    })
    const report = await Effect.runPromise(
      run(runSwarmRole, {
        roles: [role({ name: "Specialist", skill: null, instructions: "", fallbacks: true })],
      }),
    )
    expect(report).toBe("fallback worked")
    expect(models).toEqual(["anthropic/claude-sonnet-5", "openai/gpt-5"])
    expect(prompts).toHaveLength(1)
    expect(loops()).toBe(1)
    expect(userMessages()).toBe(1)
  })

  test("stops on partial text and returns the primary failure", async () => {
    const partial = failure("quota_exceeded")
    partial.parts = [{ type: "text", text: "partial", synthetic: false }] as never
    const { runSwarmRole, models } = harness({ skills: {}, promptResults: [partial, success("unused")] })
    const report = await Effect.runPromise(
      run(runSwarmRole, { roles: [role({ name: "Specialist", skill: null, instructions: "", fallbacks: true })] }),
    )
    expect(report).toContain("failed")
    expect(models).toEqual(["anthropic/claude-sonnet-5"])
  })

  test("returns the final error after exhausting the ordered chain", async () => {
    const { runSwarmRole, models } = harness({
      skills: {},
      promptResults: [failure("quota_exceeded"), failure("usage_limit_reached")],
    })
    const report = await Effect.runPromise(
      run(runSwarmRole, { roles: [role({ name: "Specialist", skill: null, instructions: "", fallbacks: true })] }),
    )
    expect(report).toContain("usage_limit_reached")
    expect(models).toHaveLength(2)
  })

  test("a prior tool part in the same persisted turn permanently blocks fallback", async () => {
    const { runSwarmRole, models, prompts, loops, userMessages } = harness({
      skills: {},
      priorAssistantParts: [[{ type: "tool", state: { status: "completed" } }]],
      promptResults: [failure("insufficient_quota"), success("must not run")],
    })
    const report = await Effect.runPromise(
      run(runSwarmRole, { roles: [role({ name: "Specialist", skill: null, instructions: "", fallbacks: true })] }),
    )
    expect(report).toContain("failed")
    expect(models).toEqual(["anthropic/claude-sonnet-5"])
    expect(prompts).toHaveLength(1)
    expect(loops()).toBe(0)
    expect(userMessages()).toBe(1)
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
    expect(report).toContain('Role "Specialist" failed')
    expect(stamps[1]).toMatchObject({ record: { phase: "settled", outcome: "errored" } })
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
  overrides: { roles?: PromptSwarm.SwarmRoleRow[] } = {},
) {
  return runSwarmRole({
    sessionID: SessionID.make("ses_parent"),
    swarmID: "swm_1",
    roles: overrides.roles ?? [role({ name: "Specialist", skill: null, instructions: "" })],
    role: "Specialist",
    prompt: "Do the task.",
  })
}

function role(input: { name: string; skill: string | null; instructions: string; fallbacks?: boolean }): PromptSwarm.SwarmRoleRow {
  return {
    name: input.name,
    agent: null,
    skill: input.skill,
    instructions: input.instructions,
    provider_id: "anthropic",
    model_id: "claude-sonnet-5",
    variant: null,
    fallback_models: input.fallbacks
      ? JSON.stringify([{ providerID: "openai", modelID: "gpt-5" }])
      : "[]",
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
  promptResults?: SessionLegacy.WithParts[]
  priorAssistantParts?: Array<Array<Record<string, unknown>>>
  /** Overrides the skill lookup, for pre-prompt failure tests. */
  skillFailure?: Effect.Effect<never>
}) {
  const prompts: string[] = []
  const models: string[] = []
  const stamps: Array<{ record: DelegationRecord; expectRunID?: string }> = []
  const turn: SessionLegacy.WithParts[] = []
  let loopCount = 0
  const record = (result: SessionLegacy.WithParts, parentID: string) => {
    const message = {
      ...result,
      info: { ...result.info, id: `msg_assistant_${turn.length}`, parentID },
    } as SessionLegacy.WithParts
    turn.push(message)
    return message
  }
  const deps = {
    claudeDriver: {} as never,
    database: {} as never,
    sessions: {
      get: () => Effect.succeed({ permission: undefined, metadata: { opencodex: { swarmID: "swm_1" } } }),
      create: () => Effect.succeed({ id: "ses_child" }),
      messageWithChildren: () => Effect.succeed([...turn]),
      updateMessage: (message: SessionLegacy.Info) => {
        const index = turn.findIndex((item) => item.info.id === message.id)
        if (index >= 0) turn[index] = { ...turn[index]!, info: message }
        if (message.role === "user") models.push(`${message.model.providerID}/${message.model.modelID}`)
        return Effect.succeed(message)
      },
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
    prompt: (promptInput: { messageID?: string; model?: { providerID: string; modelID: string }; parts: Array<{ type: string; text?: string }> }) => {
      if (promptInput.model) models.push(`${promptInput.model.providerID}/${promptInput.model.modelID}`)
      const messageID = promptInput.messageID ?? "msg_user"
      turn.push({
        info: { id: messageID, role: "user", model: promptInput.model },
        parts: promptInput.parts,
      } as unknown as SessionLegacy.WithParts)
      const text = promptInput.parts.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n")
      prompts.push(text)
      for (const parts of input.priorAssistantParts ?? []) record(failure("insufficient_quota", parts), messageID)
      if (input.promptResults?.length) return Effect.succeed(record(input.promptResults.shift()!, messageID))
      if (input.promptResult) return input.promptResult
      return Effect.succeed({
        info: { role: "assistant", error: undefined },
        parts: [{ type: "text", text: "done", synthetic: false }],
      })
    },
    loop: (loopInput: { messageID?: string }) => {
      loopCount++
      return Effect.succeed(record(input.promptResults?.shift() ?? success("done"), loopInput.messageID ?? "msg_user"))
    },
  }
  const { runSwarmRole } = PromptSwarm.make(deps as never)
  return {
    runSwarmRole,
    prompts,
    models,
    stamps,
    loops: () => loopCount,
    userMessages: () => turn.filter((message) => message.info.role === "user").length,
  }
}

function failure(code: string, parts: Array<Record<string, unknown>> = []): SessionLegacy.WithParts {
  return {
    info: {
      role: "assistant",
      error: new SessionLegacy.APIError({
        message: "request failed",
        responseBody: JSON.stringify({ error: { code } }),
        isRetryable: false,
      }),
    },
    parts,
  } as unknown as SessionLegacy.WithParts
}

function success(text: string): SessionLegacy.WithParts {
  return { info: { role: "assistant", error: undefined }, parts: [{ type: "text", text, synthetic: false }] } as SessionLegacy.WithParts
}

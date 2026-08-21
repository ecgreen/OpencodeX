import { describe, expect, test } from "bun:test"
import { Effect, Exit, Option } from "effect"
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

/**
 * The GUI's transcript link reads `metadata.sessionId` off the parent's tool
 * part - the same stamp the native task tool writes. Without it a delegation
 * row is a dead end: the child session exists in the graph but nothing on the
 * orchestrator's transcript points at it.
 */
describe("swarm role delegation drill-down", () => {
  test("stamps the child session onto the orchestrator's own tool part", async () => {
    const { runSwarmRole, parts } = harness({
      skills: {},
      parentParts: [toolPart({ id: "prt_1", callID: "toolu_1" })],
    })

    await Effect.runPromise(run(runSwarmRole, { toolUseID: "toolu_1" }))

    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      id: "prt_1",
      callID: "toolu_1",
      state: {
        status: "running",
        // Preserved alongside the stamp, not replaced by it.
        metadata: { seen: true, parentSessionId: "ses_parent", sessionId: "ses_child", swarmRole: "Specialist" },
      },
    })
  })

  test("stamps before the role's prompt runs, so a running delegation already links", async () => {
    const order: string[] = []
    const { runSwarmRole } = harness({
      skills: {},
      parentParts: [toolPart({ id: "prt_1", callID: "toolu_1" })],
      onUpdatePart: () => order.push("stamp"),
      onPrompt: () => order.push("prompt"),
    })

    await Effect.runPromise(run(runSwarmRole, { toolUseID: "toolu_1" }))

    expect(order).toEqual(["stamp", "prompt"])
  })

  test("delegates unstamped rather than failing when the call cannot be found", async () => {
    const { runSwarmRole, parts, prompts } = harness({
      skills: {},
      parentParts: [toolPart({ id: "prt_1", callID: "toolu_other" })],
    })

    const report = await Effect.runPromise(run(runSwarmRole, { toolUseID: "toolu_1" }))

    expect(report).toBe("done")
    expect(prompts).toHaveLength(1)
    expect(parts).toHaveLength(0)
  })

  test("leaves the part alone when the driver could not correlate a call id", async () => {
    const { runSwarmRole, parts } = harness({
      skills: {},
      parentParts: [toolPart({ id: "prt_1", callID: "toolu_1" })],
    })

    await Effect.runPromise(run(runSwarmRole))

    expect(parts).toHaveLength(0)
  })
})

function toolPart(input: { id: string; callID: string }) {
  return {
    id: input.id,
    sessionID: "ses_parent",
    messageID: "msg_1",
    type: "tool",
    callID: input.callID,
    tool: "task",
    state: { status: "running", input: { role: "Specialist", prompt: "Do the task." }, metadata: { seen: true } },
  }
}

function run(
  runSwarmRole: ReturnType<typeof PromptSwarm.make>["runSwarmRole"],
  overrides: { roles?: PromptSwarm.SwarmRoleRow[]; toolUseID?: string } = {},
) {
  return runSwarmRole({
    sessionID: SessionID.make("ses_parent"),
    swarmID: "swm_1",
    roles: overrides.roles ?? [role({ name: "Specialist", skill: null, instructions: "" })],
    role: "Specialist",
    prompt: "Do the task.",
    ...(overrides.toolUseID ? { toolUseID: overrides.toolUseID } : {}),
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
  /** The parent transcript the delegate call's tool part is looked up in. */
  parentParts?: Array<Record<string, unknown>>
  onUpdatePart?: () => void
  onPrompt?: () => void
}) {
  const prompts: string[] = []
  const models: string[] = []
  const stamps: Array<{ record: DelegationRecord; expectRunID?: string }> = []
  const parts: Array<Record<string, unknown>> = []
  const parentMessage = { info: { id: "msg_1", role: "assistant" }, parts: input.parentParts ?? [] }
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
      findMessage: (_sessionID: string, predicate: (message: typeof parentMessage) => boolean) =>
        Effect.succeed(predicate(parentMessage) ? Option.some(parentMessage) : Option.none()),
      updatePart: (part: Record<string, unknown>) =>
        Effect.sync(() => {
          input.onUpdatePart?.()
          parts.push(part)
          return part
        }),
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
      input.onPrompt?.()
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
    parts,
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

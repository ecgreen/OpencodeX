import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as PromptSwarm from "../../src/session/prompt-swarm"

/**
 * The delegated-specialist prompt is assembled from up to three layers:
 * the role's skill body, the role's own instructions, and the task. A
 * specialist never sees the skill tool's inventory, so the skill body has
 * to arrive here or not at all.
 */
describe("swarm role delegation prompt", () => {
  test("prefixes the skill body ahead of instructions and the task", async () => {
    const { runSwarmRole, prompts } = harness({
      skills: { designer: "You are the designer role. Review flows and states." },
    })

    const report = await Effect.runPromise(
      runSwarmRole({
        sessionID: "ses_parent" as never,
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
  })

  test("sends instructions and task alone when the role has no skill", async () => {
    const { runSwarmRole, prompts } = harness({ skills: {} })

    await Effect.runPromise(
      runSwarmRole({
        sessionID: "ses_parent" as never,
        swarmID: "swm_1",
        roles: [role({ name: "Data Migration Expert", skill: null, instructions: "Always plan a rollback." })],
        role: "Data Migration Expert",
        prompt: "Move the user table.",
      }),
    )

    expect(prompts[0]).toBe("Always plan a rollback.\n\nMove the user table.")
  })

  test("skips an unregistered skill slug instead of failing the delegation", async () => {
    const { runSwarmRole, prompts } = harness({ skills: {} })

    await Effect.runPromise(
      runSwarmRole({
        sessionID: "ses_parent" as never,
        swarmID: "swm_1",
        roles: [role({ name: "Specialist", skill: "no-such-skill", instructions: "" })],
        role: "Specialist",
        prompt: "Do the task.",
      }),
    )

    expect(prompts[0]).toBe("Do the task.")
  })
})

function role(input: { name: string; skill: string | null; instructions: string }): PromptSwarm.SwarmRoleRow {
  return {
    name: input.name,
    agent: null,
    skill: input.skill,
    instructions: input.instructions,
    provider_id: "anthropic",
    model_id: "claude-sonnet-5",
  }
}

/**
 * runSwarmRole touches sessions, skills, and prompt; the database dep is only
 * read by the briefing path, so a bare object stands in for it here.
 */
function harness(input: { skills: Record<string, string> }) {
  const prompts: string[] = []
  const deps = {
    claudeDriver: {} as never,
    database: {} as never,
    sessions: {
      get: () => Effect.succeed({ permission: undefined }),
      create: () => Effect.succeed({ id: "ses_child" }),
    } as never,
    skills: {
      get: (name: string) =>
        Effect.succeed(
          input.skills[name] !== undefined
            ? { name, location: "builtin", content: input.skills[name] }
            : undefined,
        ),
    } as never,
    prompt: (promptInput: { parts: Array<{ type: string; text?: string }> }) => {
      const text = promptInput.parts.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n")
      prompts.push(text)
      return Effect.succeed({
        info: { role: "assistant", error: undefined },
        parts: [{ type: "text", text: "done", synthetic: false }],
      })
    },
  }
  const { runSwarmRole } = PromptSwarm.make(deps as never)
  return { runSwarmRole, prompts }
}

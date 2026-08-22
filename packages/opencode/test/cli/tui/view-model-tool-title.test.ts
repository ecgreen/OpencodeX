import { describe, expect, test } from "bun:test"
import { viewMessageText } from "@tui/component/opencodex-view-model"

/**
 * The swarm delegation tool normalizes onto `task` (claude-mapper.ts) but
 * carries `{role, prompt}` instead of `{subagent_type, description}`, so every
 * delegated role used to read as a bare "Task" in the pane.
 */
describe("TUI task tool titles", () => {
  test("names the delegated role and the opening line of its prompt", () => {
    expect(title({ role: "Goomba - Code", prompt: "Fix the title builder\n\nThen report back" })).toBe(
      "Task Goomba - Code: Fix the title builder",
    )
  })

  test("truncates a long opening line instead of flooding the row", () => {
    expect(title({ role: "Reviewer", prompt: `${"x".repeat(80)} tail` })).toBe(`Task Reviewer: ${"x".repeat(57)}...`)
  })

  test("falls back when a delegation carries no prompt", () => {
    expect(title({ role: "Reviewer" })).toBe("Task Reviewer: delegation")
  })

  test("leaves a native task call in its own shape", () => {
    expect(title({ subagent_type: "review", description: "check changes" })).toBe("Task: check changes")
    // Both shapes present is not something either caller sends; the native one
    // still wins, so nothing that reads today changes.
    expect(title({ role: "Reviewer", subagent_type: "review", description: "check changes" })).toBe(
      "Task: check changes",
    )
  })

  test("falls back to the streamed title when the input says nothing", () => {
    expect(title({})).toBe("streamed")
  })
})

function title(input: Record<string, unknown>) {
  const part = {
    type: "tool",
    tool: "task",
    state: { status: "completed", input, title: "streamed" },
  }
  return viewMessageText({ role: "assistant" } as never, [part] as never)
}

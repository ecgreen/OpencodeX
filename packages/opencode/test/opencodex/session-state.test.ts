import { describe, expect, test } from "bun:test"
import { deriveUiState } from "../../src/opencodex/session-state"

function session(overrides: Partial<{ id: string; parentID: string; updated: number }> = {}) {
  return {
    id: overrides.id ?? "ses_root",
    ...(overrides.parentID ? { parentID: overrides.parentID } : {}),
    time: { created: 1, updated: overrides.updated ?? 100 },
  } as Parameters<typeof deriveUiState>[0]["session"]
}

describe("deriveUiState", () => {
  test("a root session with unreviewed work needs review", () => {
    const state = deriveUiState({ session: session(), permissions: [], questions: [] })
    expect(state.displayStatus).toBe("needs_review")
  })

  test("a delegated child never needs review - finished work reads as settled", () => {
    // Nobody reviews a sub-agent: its parent consumed the report. Deriving
    // needs_review for children parked every finished delegation in "Ready
    // for review" forever, since nothing ever marks them reviewed.
    const state = deriveUiState({
      session: session({ id: "ses_child", parentID: "ses_root" }),
      permissions: [],
      questions: [],
    })
    expect(state.displayStatus).toBe("idle")
  })

  test("a busy child still reads as in progress", () => {
    const state = deriveUiState({
      session: session({ id: "ses_child", parentID: "ses_root" }),
      status: { sessionID: "ses_child", type: "busy" } as never,
      permissions: [],
      questions: [],
    })
    expect(state.displayStatus).toBe("in_progress")
  })

  test("a blocked child still needs input", () => {
    const state = deriveUiState({
      session: session({ id: "ses_child", parentID: "ses_root" }),
      permissions: [{ sessionID: "ses_child" } as never],
      questions: [],
    })
    expect(state.displayStatus).toBe("input_needed")
  })
})

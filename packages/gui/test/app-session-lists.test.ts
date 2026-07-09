import { describe, expect, test } from "bun:test"
import type { GuiSnapshot } from "../src/renderer/src/lib/store"
import { emptySessionOrderState, reconcileSessionOrderState, tuiSidebarSessions } from "../src/renderer/src/lib/app-session-lists"
import { permission, question, session } from "./functional/fixtures"

describe("app session lists", () => {
  test("orders sessions by attention bucket before inactive recency while preserving active queue order", () => {
    const snapshot = guiSnapshot([
      session("inactive-new", { time: { created: 1, updated: 90 } }),
      session("progress-later", { time: { created: 1, updated: 40 } }),
      session("review-later", { time: { created: 1, updated: 30 } }),
      session("feedback-later", { time: { created: 1, updated: 20 } }),
      session("progress-first", { time: { created: 1, updated: 10 } }),
      session("review-first", { time: { created: 1, updated: 5 } }),
      session("feedback-first", { time: { created: 1, updated: 3 } }),
      session("inactive-old", { time: { created: 1, updated: 1 } }),
    ])
    const state = reconcileSessionOrderState(emptySessionOrderState(), snapshot)

    expect(tuiSidebarSessions(snapshot, state).map((item) => item.id)).toEqual([
      "feedback-later",
      "feedback-first",
      "review-later",
      "review-first",
      "progress-later",
      "progress-first",
      "inactive-new",
      "inactive-old",
    ])
  })

  test("keeps running sessions stable when updated timestamps change", () => {
    const first = guiSnapshot([
      session("progress-first", { time: { created: 1, updated: 10 } }),
      session("progress-later", { time: { created: 1, updated: 40 } }),
    ])
    const state = reconcileSessionOrderState(emptySessionOrderState(), first)
    const next = guiSnapshot([
      session("progress-later", { time: { created: 1, updated: 400 } }),
      session("progress-first", { time: { created: 1, updated: 10 } }),
    ])
    const nextState = reconcileSessionOrderState(state, next)

    expect(tuiSidebarSessions(next, nextState).map((item) => item.id)).toEqual([
      "progress-first",
      "progress-later",
    ])
  })
})

function guiSnapshot(sessions: GuiSnapshot["sessions"]): GuiSnapshot {
  return {
    sessions,
    projects: [],
    views: [],
    sessionStatus: {
      "progress-first": { type: "busy" },
      "progress-later": { type: "busy" },
    },
    sessionUiState: {
      "review-first": { sessionID: "review-first", reviewedFiles: [], displayStatus: "needs_review", updated: true },
      "review-later": { sessionID: "review-later", reviewedFiles: [], displayStatus: "needs_review", updated: true },
    },
    permissions: [permission({ id: "permission-feedback-first", sessionID: "feedback-first" })],
    questions: [question({ id: "question-feedback-later", sessionID: "feedback-later" })],
    providers: [],
    swarms: [],
    jobs: [],
  }
}

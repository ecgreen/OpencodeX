import { describe, expect, test } from "bun:test"
import { markViewedSessionUiState } from "../../../../src/cli/cmd/tui/context/session-viewed"
import { deriveStatus } from "../../../../src/cli/cmd/tui/component/opencodex-session-status-core"

describe("opencodex session viewed state", () => {
  test("marks ready sessions seen without clearing review state", () => {
    expect(markViewedSessionUiState(
      "ses_review",
      {
        sessionID: "ses_review",
        seenAt: 20,
        reviewedAt: 30,
        reviewedFiles: ["src/app.ts"],
        displayStatus: "needs_review",
        updated: true,
      },
      200,
      200,
    )).toEqual({
      sessionID: "ses_review",
      seenAt: 200,
      reviewedAt: 30,
      reviewedFiles: ["src/app.ts"],
      displayStatus: "needs_review",
      updated: false,
    })
  })

  test("derives ready visual status only while review work is unseen", () => {
    const state = {
      sessionID: "ses_review",
      seenAt: 20,
      reviewedAt: 30,
      reviewedFiles: ["src/app.ts"],
      displayStatus: "needs_review" as const,
      updated: true,
    }

    expect(deriveStatus("ses_review", sync(state))).toBe("needs_review")
    expect(deriveStatus("ses_review", sync({ ...state, seenAt: 200, updated: false }))).toBe("dormant")
  })
})

function sync(state: Parameters<typeof deriveStatus>[1]["data"]["session_ui_state"][string]): Parameters<typeof deriveStatus>[1] {
  return {
    data: {
      permission: {},
      question: {},
      session_status: {},
      session_ui_state: { [state.sessionID]: state },
      message: {},
      part: {},
    },
  } as Parameters<typeof deriveStatus>[1]
}

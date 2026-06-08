import { describe, expect, test } from "bun:test"
import type { GlobalSession, OpencodeXView, PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "../src/renderer/src/lib/store"
import { deriveSessionStatus, deriveViewStatus, reconcileSessionUiState, type DerivedSessionStatus } from "../src/renderer/src/lib/session-status"
import { deriveStatus as deriveTuiStatus } from "../../opencode/src/cli/cmd/tui/component/opencodex-session-status"

const sessionID = "ses_sync"

describe("GUI session status parity", () => {
  test("derives the same backend states as the TUI", () => {
    const cases = [
      {
        name: "permission",
        snapshot: snapshot({ permissions: [permission()] }),
      },
      {
        name: "question",
        snapshot: snapshot({ questions: [question()] }),
      },
      {
        name: "busy",
        snapshot: snapshot({ sessionStatus: { [sessionID]: { type: "busy" } } }),
      },
      {
        name: "retry",
        snapshot: snapshot({ sessionStatus: { [sessionID]: { type: "retry", attempt: 1, message: "retrying", next: 200 } } }),
      },
      {
        name: "ui input",
        snapshot: snapshot({ sessionUiState: { [sessionID]: uiState("input_needed") } }),
      },
      {
        name: "ui active",
        snapshot: snapshot({ sessionUiState: { [sessionID]: uiState("in_progress") } }),
      },
      {
        name: "ready",
        snapshot: snapshot({ sessionUiState: { [sessionID]: uiState("needs_review") } }),
      },
      {
        name: "idle",
        snapshot: snapshot(),
      },
    ]

    for (const item of cases) {
      expect(deriveSessionStatus(item.snapshot, item.snapshot.sessions[0]), item.name).toBe(guiStatusForTui(deriveTuiStatus(sessionID, tuiSync(item.snapshot))))
    }
  })

  test("reconciles completed backend work into ready for review", () => {
    const current = snapshot({
      sessions: [session(sessionID, 200)],
      sessionUiState: {
        [sessionID]: {
          sessionID,
          seenAt: 50,
          reviewedAt: 50,
          reviewedFiles: [],
          displayStatus: "idle",
          updated: false,
        },
      },
    })

    const next = reconcileSessionUiState(current, sessionID)

    expect(next.sessionUiState[sessionID]?.displayStatus).toBe("needs_review")
    expect(next.sessionUiState[sessionID]?.updated).toBe(true)
    expect(deriveSessionStatus(next, next.sessions[0])).toBe("ready_for_review")
  })

  test("clears stale local in-progress state when viewed after backend work is idle", () => {
    const current = snapshot({
      sessions: [session(sessionID, 100)],
      sessionUiState: {
        [sessionID]: {
          sessionID,
          seenAt: 20,
          reviewedAt: 20,
          reviewedFiles: [],
          displayStatus: "in_progress",
          updated: true,
        },
      },
    })

    const next = reconcileSessionUiState({
      ...current,
      sessionUiState: {
        ...current.sessionUiState,
        [sessionID]: {
          ...current.sessionUiState[sessionID]!,
          seenAt: 200,
          reviewedAt: 200,
        },
      },
    }, sessionID)

    expect(next.sessionUiState[sessionID]?.displayStatus).toBe("idle")
    expect(deriveSessionStatus(next, next.sessions[0])).toBe("dormant")
  })

  test("keeps dashboard and sidebar view status derivation on the same helper", () => {
    const current = snapshot({
      sessions: [session(sessionID, 200), session("ses_review", 300)],
      sessionStatus: { [sessionID]: { type: "busy" } },
      sessionUiState: {
        [sessionID]: uiState("idle"),
        ses_review: uiState("needs_review", "ses_review"),
      },
      views: [view([sessionID, "ses_review"])],
    })

    expect(deriveViewStatus(current.views[0], current)).toBe("in_progress")
  })
})

function guiStatusForTui(status: ReturnType<typeof deriveTuiStatus>): DerivedSessionStatus {
  if (status === "needs_review") return "ready_for_review"
  if (status === "dormant") return "dormant"
  return status
}

function tuiSync(snapshot: GuiSnapshot): Parameters<typeof deriveTuiStatus>[1] {
  return {
    data: {
      permission: groupBySession(snapshot.permissions),
      question: groupBySession(snapshot.questions),
      session_status: snapshot.sessionStatus,
      session_ui_state: snapshot.sessionUiState,
      message: {},
      part: {},
    },
  } as Parameters<typeof deriveTuiStatus>[1]
}

function snapshot(overrides: Partial<GuiSnapshot> = {}): GuiSnapshot {
  return {
    projects: [],
    sessions: [session(sessionID, 100)],
    sessionStatus: {},
    sessionUiState: { [sessionID]: uiState("idle") },
    permissions: [],
    questions: [],
    providers: [],
    agents: [],
    swarms: [],
    jobs: [],
    views: [],
    ...overrides,
  }
}

function session(id: string, updated: number): Session {
  return {
    id,
    slug: id,
    projectID: "proj_test",
    directory: "C:/Work/OpencodeX",
    title: id,
    version: "1.15.13",
    time: { created: 1, updated },
  }
}

function globalSession(id: string): GlobalSession {
  return {
    ...session(id, 100),
    project: null,
  }
}

function view(sessionIDs: string[]): OpencodeXView {
  return {
    id: "view_sync",
    title: "Sync",
    layout: "auto",
    sessions: sessionIDs.map(globalSession),
    sessionIDs,
    timeCreated: 1,
    timeUpdated: 1,
  }
}

function uiState(displayStatus: GuiSnapshot["sessionUiState"][string]["displayStatus"], id = sessionID): GuiSnapshot["sessionUiState"][string] {
  return {
    sessionID: id,
    reviewedAt: 100,
    reviewedFiles: [],
    displayStatus,
    updated: false,
  }
}

function permission(): PermissionRequest {
  return {
    id: "perm_sync",
    sessionID,
    permission: "edit",
    patterns: ["**/*.ts"],
    metadata: {},
    always: [],
  }
}

function question(): QuestionRequest {
  return {
    id: "question_sync",
    sessionID,
    questions: [{ header: "Choice", question: "Pick one", options: [{ label: "A", description: "Option A" }] }],
  }
}

function groupBySession<T extends { sessionID: string }>(items: readonly T[]) {
  return items.reduce<Record<string, T[]>>(
    (result, item) => ({
      ...result,
      [item.sessionID]: [...(result[item.sessionID] ?? []), item],
    }),
    {},
  )
}

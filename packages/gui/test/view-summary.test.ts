import { describe, expect, test } from "bun:test"
import type { GuiSnapshot } from "../src/renderer/src/lib/store"
import { groupedViewSummaries, summarizeView, summarizeViews, viewProjectMeta } from "../src/renderer/src/lib/view-summary"
import { permission, project, question, session, view } from "./functional/fixtures"

describe("GUI view summaries", () => {
  test("groups views with permissions and questions under attention", () => {
    const sessions = [session("s1"), session("s2")]
    const snapshot = snapshotWith({
      sessions,
      permissions: [permission({ sessionID: "s1" })],
      questions: [question({ sessionID: "s2" })],
    })
    const summary = summarizeView({ view: view({ sessionIDs: ["s1", "s2"] }), snapshot, now: 2_000_000_000_000 })

    expect(summary.group).toBe("attention")
    expect(summary.attentionCounts).toMatchObject({ permissions: 1, questions: 1 })
    expect(summary.attentionLabel).toBe("1 permission, 1 question")
  })

  test("groups running views as active", () => {
    const sessions = [session("s1", { time: { created: 1, updated: 1 } })]
    const summary = summarizeView({
      view: view({ sessionIDs: ["s1"], timeUpdated: 1 }),
      snapshot: snapshotWith({ sessions, sessionStatus: { s1: { type: "busy" } } }),
      now: 2_000_000_000_000,
    })

    expect(summary.status).toBe("in_progress")
    expect(summary.group).toBe("active")
  })

  test("counts ready sessions and failed jobs as attention", () => {
    const sessions = [session("s1", { time: { created: 1, updated: 100 } }), session("s2", { time: { created: 1, updated: 100 } })]
    const summary = summarizeView({
      view: view({ sessionIDs: ["s1", "s2"], timeUpdated: 100 }),
      snapshot: snapshotWith({
        sessions,
        sessionUiState: {
          s1: { sessionID: "s1", reviewedFiles: [], reviewedAt: 1, displayStatus: "needs_review", updated: true },
        },
        jobs: [{ id: "job-1", sessionID: "s2", status: "failed", kind: "test" }],
      }),
      now: 2_000_000_000_000,
    })

    expect(summary.group).toBe("attention")
    expect(summary.attentionCounts.ready).toBe(1)
    expect(summary.attentionCounts.failed).toBe(1)
    expect(summary.status).toBe("failed")
  })

  test("counts pending panes without affecting session status", () => {
    const summary = summarizeView({
      view: view({
        sessionIDs: ["s1"],
        metadata: { opencodex: { pendingSessions: [{ id: "new:1", directory: "C:/Work/OpencodeX" }] } },
        timeUpdated: 1,
      }),
      snapshot: snapshotWith({ sessions: [session("s1", { time: { created: 1, updated: 1 } })] }),
      now: 2_000_000_000_000,
    })

    expect(summary.paneCount).toBe(2)
    expect(summary.pendingCount).toBe(1)
    expect(summary.status).toBe("dormant")
  })

  test("dedupes project labels and groups quiet views separately", () => {
    const sessions = [
      session("s1", { time: { created: 1, updated: 1 } }),
      session("s2", { time: { created: 1, updated: 1 } }),
      session("s3", { time: { created: 1, updated: 1 } }),
    ]
    const snapshot = snapshotWith({
      sessions,
      projects: [
        project({ id: "p1", name: "Alpha", sessions: [{ id: "s1" }, { id: "s2" }] }),
        project({ id: "p2", name: "Beta", sessions: [{ id: "s3" }] }),
      ],
    })
    const summaries = summarizeViews({
      views: [
        view({ id: "view-1", sessionIDs: ["s1", "s2", "s3"], timeUpdated: 1 }),
        view({ id: "view-2", sessionIDs: ["s1"], timeUpdated: 2_000_000_000_000 }),
      ],
      snapshot,
      now: 2_000_000_000_000,
    })

    expect(summaries[0].projectLabels).toEqual(["Alpha", "Beta"])
    expect(viewProjectMeta(summaries[0])).toBe("2 projects")
    expect(groupedViewSummaries(summaries).quiet.map((summary) => summary.view.id)).toEqual(["view-1"])
    expect(groupedViewSummaries(summaries).recent.map((summary) => summary.view.id)).toEqual(["view-2"])
  })
})

function snapshotWith(input: Partial<GuiSnapshot>): GuiSnapshot {
  return {
    projects: [],
    sessions: [],
    sessionStatus: {},
    sessionUiState: {},
    sessionSyncRevision: "test",
    permissions: [],
    questions: [],
    providers: [],
    agents: [],
    commands: [],
    lsp: [],
    mcp: {},
    mcpResources: {},
    plugins: [],
    swarms: [],
    jobs: [],
    views: [],
    ...input,
  } as GuiSnapshot
}

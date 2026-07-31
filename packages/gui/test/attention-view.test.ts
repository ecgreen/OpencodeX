// oxlint-disable no-unsafe-type-assertion -- fixtures are deliberately partial: only the fields the view reads
import { describe, expect, test } from "bun:test"
import type { AttentionItem } from "@opencode-ai/sdk/v2/work-item"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "../src/renderer/src/lib/session-api"
import {
  attentionIcon,
  attentionOpenable,
  attentionSession,
  attentionTone,
} from "../src/renderer/src/lib/attention-view"

describe("GUI attention presentation", () => {
  test("resolves an item to the session it stands for", () => {
    // The queue renders this as the session's own card, so the reader sees one
    // session presented one way whether they meet it here or in the lists.
    expect(attentionSession(item({ sessionID: "session-1" }), snapshot())?.id).toBe("session-1")
  })

  test("does not invent a session the snapshot no longer holds", () => {
    expect(attentionSession(item({ sessionID: "session-gone" }), snapshot())).toBeUndefined()
    expect(attentionSession(item({}), snapshot())).toBeUndefined()
  })

  test("only rows with somewhere to go are openable", () => {
    expect(attentionOpenable(item({ sessionID: "session-1" }))).toBe(true)
    expect(attentionOpenable(item({ swarmID: "swarm-1" }))).toBe(true)
    // The stranded-goal shape: no session, no swarm, nothing behind it. This
    // renders as plain text rather than a control the reader cannot press.
    expect(attentionOpenable(item({}))).toBe(false)
  })

  test("each kind carries its own glyph and tone", () => {
    expect(attentionTone(item({ kind: "failure" }))).toBe("failed")
    expect(attentionIcon(item({ kind: "permission" }))).toBe("lock")
    expect(attentionTone(item({ kind: "review" }))).toBe("review")
  })
})

function item(overrides: Partial<AttentionItem>): AttentionItem {
  return {
    id: "failure:job:job-1",
    workItemID: "job:job-1",
    kind: "failure",
    priority: 1,
    title: "Survey the schema",
    detail: "InstanceRef not provided",
    state: "failed",
    updatedAt: 3_000,
    ...overrides,
  }
}

function snapshot(): GuiSnapshot {
  return {
    sessions: [
      {
        id: "session-1",
        slug: "session-1",
        directory: "C:/repo",
        title: "Implement feature",
        version: "1",
        time: { created: 1_000, updated: 2_000 },
      } as Session,
    ],
  } as GuiSnapshot
}

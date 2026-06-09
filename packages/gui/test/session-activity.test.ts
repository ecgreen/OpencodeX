import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { MessageBundle, SessionData } from "../src/renderer/src/lib/store"
import { isLikelyActiveSession, shouldPollVisibleSession } from "../src/renderer/src/lib/session-activity"

const now = 1_000_000

describe("GUI session activity heuristics", () => {
  test("polls backend busy and retry states without loaded message data", () => {
    expect(shouldPollVisibleSession({ type: "busy" }, session("busy", now), undefined, now)).toBe(true)
    expect(shouldPollVisibleSession({ type: "retry", attempt: 1, message: "retrying", next: now + 1_000 }, session("retry", now), undefined, now)).toBe(true)
    expect(shouldPollVisibleSession({ type: "idle" }, session("idle", now), undefined, now)).toBe(false)
  })

  test("ignores stale or completed assistant messages", () => {
    expect(isLikelyActiveSession(session("stale", 1), data([assistant("a1", 1, [textPart("p1")])]), now)).toBe(false)
    expect(isLikelyActiveSession(session("done", now), data([assistant("a2", now, [textPart("p2")], { completed: now })]), now)).toBe(false)
  })

  test("treats running tool and open step assistant messages as active", () => {
    expect(isLikelyActiveSession(session("tool", now), data([assistant("a3", now, [runningToolPart("tool")])]), now)).toBe(true)
    expect(isLikelyActiveSession(session("step", now), data([assistant("a4", now, [stepStartPart("step")])]), now)).toBe(true)
  })
})

function session(id: string, updated: number): Session {
  return { id, directory: "C:\\Work\\OpencodeX", time: { updated } } as Session
}

function data(messages: MessageBundle[]): SessionData {
  return { messages, todos: [], diffs: [] }
}

function assistant(id: string, created: number, parts: MessageBundle["parts"], input: { completed?: number } = {}): MessageBundle {
  return {
    info: {
      id,
      sessionID: id,
      role: "assistant",
      time: {
        created,
        ...(input.completed === undefined ? {} : { completed: input.completed }),
      },
    } as MessageBundle["info"],
    parts,
  }
}

function textPart(id: string): MessageBundle["parts"][number] {
  return { id, sessionID: "session", messageID: "message", type: "text", text: "Working" } as MessageBundle["parts"][number]
}

function runningToolPart(id: string): MessageBundle["parts"][number] {
  return { id, sessionID: "session", messageID: "message", type: "tool", state: { status: "running" } } as MessageBundle["parts"][number]
}

function stepStartPart(id: string): MessageBundle["parts"][number] {
  return { id, sessionID: "session", messageID: "message", type: "step-start" } as MessageBundle["parts"][number]
}

import { describe, expect, test } from "bun:test"
import type { PermissionRequest, QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import {
  buildSafetyQueue,
  describePermission,
  finalQuestionAnswers,
  moveSafetyQueueIndex,
  questionAnswersComplete,
  safetyQueueGroup,
  toggleQuestionAnswer,
} from "../src/renderer/src/lib/safety-present"

describe("GUI safety presentation helpers", () => {
  test("builds a permission-first queue with one entry per question step", () => {
    const queue = buildSafetyQueue(
      [permission({ id: "permission-1" })],
      [question({ id: "question-1", questions: [questionInfo("One?"), questionInfo("Two?")] })],
    )
    expect(queue.map((item) => item.id)).toEqual([
      "permission:permission-1",
      "question:question-1:0",
      "question:question-1:1",
    ])
    expect(queue.flatMap((item) => (item.kind === "question" ? [item.step] : []))).toEqual([0, 1])
    expect(moveSafetyQueueIndex(0, 3, -1)).toBe(2)
    expect(moveSafetyQueueIndex(2, 3, 1)).toBe(0)
  })

  test("the pill reads group-relative and hints at the group queued behind", () => {
    const queue = buildSafetyQueue(
      [permission({ id: "p1" }), permission({ id: "p2" }), permission({ id: "p3" })],
      [question({ id: "q1", questions: [questionInfo("One?"), questionInfo("Two?")] })],
    )
    expect(safetyQueueGroup(queue, 0)).toEqual({ index: 0, total: 3, upNext: "2 questions" })
    expect(safetyQueueGroup(queue, 2)).toEqual({ index: 2, total: 3, upNext: "2 questions" })
    expect(safetyQueueGroup(queue, 3)).toEqual({ index: 0, total: 2, upNext: "3 permissions" })
    expect(safetyQueueGroup(queue, 4)).toEqual({ index: 1, total: 2, upNext: "3 permissions" })
  })

  test("groups read clean when only one kind is pending", () => {
    const permissionsOnly = buildSafetyQueue([permission({ id: "p1" }), permission({ id: "p2" })], [])
    expect(safetyQueueGroup(permissionsOnly, 1)).toEqual({ index: 1, total: 2 })
    const questionsOnly = buildSafetyQueue([], [question({ id: "q1" })])
    expect(safetyQueueGroup(questionsOnly, 0)).toEqual({ index: 0, total: 1 })
  })

  test("describes shell and file permissions without exposing raw input", () => {
    expect(describePermission(permission({ permission: "bash" }), { command: "git status", description: "Check repository state" })).toMatchObject({
      icon: "terminal",
      kind: "bash",
      title: "Check repository state",
      command: "git status",
      summary: [],
    })
  })

  test("drops summary rows that just repeat the heading", () => {
    // "Read README.md" already says the path; a Path row underneath is noise.
    expect(describePermission(permission({ permission: "read" }), { filePath: "README.md" })).toMatchObject({
      icon: "file",
      title: "Read README.md",
      summary: [],
    })
  })

  test("fetch names the host in the heading and keeps the full URL in the body", () => {
    expect(describePermission(permission({ permission: "webfetch" }), { url: "https://example.com/docs/page" })).toMatchObject({
      title: "Fetch example.com",
      summary: [{ label: "URL", value: "https://example.com/docs/page", technical: true }],
    })
  })

  test("toggles single and multiple question answers", () => {
    const empty: QuestionAnswer[] = [[], []]
    expect(toggleQuestionAnswer(empty, 0, "First")).toEqual([["First"], []])
    expect(toggleQuestionAnswer([["First"], []], 0, "Second")).toEqual([["Second"], []])
    expect(toggleQuestionAnswer([["First"], []], 0, "Second", true)).toEqual([["First", "Second"], []])
    expect(toggleQuestionAnswer([["First", "Second"], []], 0, "First", true)).toEqual([["Second"], []])
  })

  test("normalizes custom answers and validates every question", () => {
    expect(finalQuestionAnswers([["One"], []], ["", " custom "])).toEqual([["One"], ["custom"]])
    expect(questionAnswersComplete([["One"], []], ["", " custom "])).toBe(true)
    expect(questionAnswersComplete([["One"], []], ["", " "])).toBe(false)
  })
})

function permission(input: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: "permission-1",
    sessionID: "session-1",
    permission: "edit",
    patterns: [],
    metadata: {},
    always: [],
    ...input,
  }
}

function questionInfo(text: string) {
  return { header: "Confirm", question: text, options: [] }
}

function question(input: Partial<QuestionRequest> = {}): QuestionRequest {
  return {
    id: "question-1",
    sessionID: "session-1",
    questions: [questionInfo("Proceed?")],
    ...input,
  }
}

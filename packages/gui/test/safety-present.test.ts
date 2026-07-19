import { describe, expect, test } from "bun:test"
import type { PermissionRequest, QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import {
  buildSafetyQueue,
  describePermission,
  finalQuestionAnswers,
  moveSafetyQueueIndex,
  questionAnswersComplete,
  toggleQuestionAnswer,
} from "../src/renderer/src/lib/safety-present"

describe("GUI safety presentation helpers", () => {
  test("builds a stable permission-first request queue", () => {
    expect(buildSafetyQueue([permission({ id: "permission-1" })], [question({ id: "question-1" })]).map((item) => item.id)).toEqual([
      "permission:permission-1",
      "question:question-1",
    ])
    expect(moveSafetyQueueIndex(0, 3, -1)).toBe(2)
    expect(moveSafetyQueueIndex(2, 3, 1)).toBe(0)
  })

  test("describes shell and file permissions without exposing raw input", () => {
    expect(describePermission(permission({ permission: "bash" }), { command: "git status", description: "Check repository state" })).toMatchObject({
      icon: "terminal",
      kind: "bash",
      title: "Check repository state",
      command: "git status",
      summary: [],
    })
    expect(describePermission(permission({ permission: "read" }), { filePath: "README.md" })).toMatchObject({
      icon: "file",
      title: "Read README.md",
      summary: [{ label: "Path", value: "README.md", technical: true }],
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

function question(input: Partial<QuestionRequest> = {}): QuestionRequest {
  return {
    id: "question-1",
    sessionID: "session-1",
    questions: [{ header: "Confirm", question: "Proceed?", options: [] }],
    ...input,
  }
}

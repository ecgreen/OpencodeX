import { describe, expect, test } from "bun:test"
import { prepareSessionPromptSubmission } from "../../src/renderer/src/lib/session-prompt"
import { permissionAlwaysConfirmInput, permissionRejectDialog, runPermissionAction, sessionDirectoryForRequest } from "../../src/renderer/src/lib/session-actions"
import { textPrompt } from "../../src/renderer/src/lib/prompt-state"
import { gui, permission, question, session } from "./fixtures"

describe("GUI functional safety workflows", () => {
  test("blocks prompt submission while permissions or questions are pending", () => {
    expect(prepareSessionPromptSubmission({
      gui: gui(),
      route: { name: "session" },
      session: session("session-1"),
      prompt: textPrompt("do work"),
      permissionCount: 1,
      questionCount: 0,
    })).toBeUndefined()
    expect(prepareSessionPromptSubmission({
      gui: gui(),
      route: { name: "session" },
      session: session("session-1"),
      prompt: textPrompt("do work"),
      permissionCount: 0,
      questionCount: 1,
    })).toBeUndefined()
  })

  test("rejects permissions with optional feedback and session directory context", async () => {
    const calls: string[] = []

    await runPermissionAction({
      request: permission(),
      reply: "reject",
      sessions: [session("session-1", { directory: "C:/Work/OpencodeX" })],
      askText: async (input) => {
        calls.push(`ask:${input.title}`)
        return "not this one"
      },
      confirm: async () => true,
      replyPermission: async (requestID, reply, message, directory) => calls.push(`reply:${requestID}:${reply}:${message}:${directory}`),
      refresh: async () => calls.push("refresh"),
    })

    expect(permissionRejectDialog("reject")).toEqual({ title: "Reject Permission", message: "Optional feedback for the agent" })
    expect(calls).toEqual(["ask:Reject Permission", "reply:permission-1:reject:not this one:C:/Work/OpencodeX", "refresh"])
  })

  test("confirms always-allow permissions before sending the reply", async () => {
    const calls: string[] = []
    const request = permission({ always: ["edit **/*.ts", "read docs"] })

    await runPermissionAction({
      request,
      reply: "always",
      sessions: [session("session-1")],
      askText: async () => "unused",
      confirm: async (input) => {
        calls.push(`confirm:${input.title}:${input.message}`)
        return true
      },
      replyPermission: async (requestID, reply, message, directory) => calls.push(`reply:${requestID}:${reply}:${message ?? ""}:${directory}`),
      refresh: async () => calls.push("refresh"),
    })

    expect(permissionAlwaysConfirmInput(request, "always")?.message).toBe("edit **/*.ts\nread docs")
    expect(calls).toEqual([
      "confirm:Always Allow:edit **/*.ts\nread docs",
      "reply:permission-1:always::C:/Work/OpencodeX",
      "refresh",
    ])
  })

  test("finds the session directory for permission and question replies", () => {
    const sessions = [session("session-1", { directory: "C:/One" }), session("session-2", { directory: "C:/Two" })]

    expect(sessionDirectoryForRequest(sessions, permission({ sessionID: "session-2" }))).toBe("C:/Two")
    expect(sessionDirectoryForRequest(sessions, question({ sessionID: "missing" }))).toBeUndefined()
  })
})

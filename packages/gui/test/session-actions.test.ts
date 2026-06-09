import { describe, expect, test } from "bun:test"
import type { PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { moveSessionBlockedMessage, moveSessionConfirmInput, permissionAlwaysConfirmInput, permissionRejectDialog, runMoveSessionAction, runPermissionAction, sessionDirectoryForRequest } from "../src/renderer/src/lib/session-actions"
import type { GuiSnapshot } from "../src/renderer/src/lib/store"

describe("GUI session action decisions", () => {
  test("finds request session directories for permission and question replies", () => {
    const sessions = [session("s1", "C:/One"), session("s2", "C:/Two")]

    expect(sessionDirectoryForRequest(sessions, permission("s2"))).toBe("C:/Two")
    expect(sessionDirectoryForRequest(sessions, question("missing"))).toBeUndefined()
  })

  test("prepares move-session guard and confirmation text", () => {
    expect(moveSessionBlockedMessage([])).toBe("Create or load a project before moving a session.")
    expect(moveSessionBlockedMessage([project()])).toBeUndefined()
    expect(moveSessionConfirmInput(session("s1", "C:/One"), "project-1")).toEqual({
      title: "Move Session",
      message: "Move \"s1\" to this project?\n\nproject-1",
      confirm: "Move",
    })
  })

  test("prepares permission dialogs only for replies that need them", () => {
    const request = permission("s1")

    expect(permissionRejectDialog("reject")).toEqual({ title: "Reject Permission", message: "Optional feedback for the agent" })
    expect(permissionRejectDialog("once")).toBeUndefined()
    expect(permissionAlwaysConfirmInput(request, "always")).toEqual({
      title: "Always Allow",
      message: "edit",
      confirm: "Always Allow",
    })
    expect(permissionAlwaysConfirmInput({ ...request, always: ["write", "read"] }, "always")?.message).toBe("write\nread")
    expect(permissionAlwaysConfirmInput(request, "reject")).toBeUndefined()
  })

  test("runs move-session actions through injected dialogs and backend calls", async () => {
    const calls: string[] = []

    await runMoveSessionAction({
      session: session("s1", "C:/One"),
      projects: [project()],
      alert: (message) => calls.push(`alert:${message}`),
      chooseProjectID: async () => "project-1",
      confirm: async () => true,
      moveSession: async (sessionID, projectID) => calls.push(`move:${sessionID}:${projectID}`),
      refresh: async () => calls.push("refresh"),
    })

    expect(calls).toEqual(["move:s1:project-1", "refresh"])
  })

  test("stops move-session actions when blocked or cancelled", async () => {
    const blockedCalls: string[] = []
    const cancelledCalls: string[] = []

    await runMoveSessionAction({
      session: session("s1", "C:/One"),
      projects: [],
      alert: (message) => blockedCalls.push(message),
      chooseProjectID: async () => "project-1",
      confirm: async () => true,
      moveSession: async () => blockedCalls.push("move"),
      refresh: async () => blockedCalls.push("refresh"),
    })
    await runMoveSessionAction({
      session: session("s1", "C:/One"),
      projects: [project()],
      alert: (message) => cancelledCalls.push(message),
      chooseProjectID: async () => "project-1",
      confirm: async () => false,
      moveSession: async () => cancelledCalls.push("move"),
      refresh: async () => cancelledCalls.push("refresh"),
    })

    expect(blockedCalls).toEqual(["Create or load a project before moving a session."])
    expect(cancelledCalls).toEqual([])
  })

  test("runs permission actions through optional dialogs and request directories", async () => {
    const calls: string[] = []

    await runPermissionAction({
      request: permission("s1"),
      reply: "reject",
      sessions: [session("s1", "C:/One")],
      askText: async () => "not now",
      confirm: async () => true,
      replyPermission: async (requestID, reply, message, directory) => calls.push(`${requestID}:${reply}:${message}:${directory}`),
      refresh: async () => calls.push("refresh"),
    })

    expect(calls).toEqual(["permission-1:reject:not now:C:/One", "refresh"])
  })

  test("stops always-allow permission actions when confirmation is cancelled", async () => {
    const calls: string[] = []

    await runPermissionAction({
      request: permission("s1"),
      reply: "always",
      sessions: [session("s1", "C:/One")],
      askText: async () => "unused",
      confirm: async () => false,
      replyPermission: async () => calls.push("reply"),
      refresh: async () => calls.push("refresh"),
    })

    expect(calls).toEqual([])
  })
})

function session(id: string, directory: string): Session {
  return { id, title: id, directory, time: { updated: 1 } } as Session
}

function permission(sessionID: string): PermissionRequest {
  return {
    id: "permission-1",
    sessionID,
    permission: "edit",
    patterns: [],
    metadata: {},
    always: [],
  }
}

function question(sessionID: string): QuestionRequest {
  return {
    id: "question-1",
    sessionID,
    questions: [],
  }
}

function project(): GuiSnapshot["projects"][number] {
  return {
    id: "project-1",
    name: "Project",
    project: { id: "project-core", name: "Project", time: { created: 1, updated: 1 } },
    folders: [],
    sessions: [],
  }
}

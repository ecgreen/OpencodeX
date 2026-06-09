import type { PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiSnapshot } from "./store"

export type TextDialogInput = { title: string; message?: string; value?: string; multiline?: boolean }
export type ConfirmDialogInput = { title: string; message: string; confirm?: string }

export function sessionDirectoryForRequest(sessions: Session[], request: PermissionRequest | QuestionRequest) {
  return sessions.find((session) => session.id === request.sessionID)?.directory
}

export function moveSessionBlockedMessage(projects: GuiSnapshot["projects"]) {
  return projects.length === 0 ? "Create or load a project before moving a session." : undefined
}

export function moveSessionConfirmInput(session: Session, projectID: string): ConfirmDialogInput {
  return {
    title: "Move Session",
    message: `Move "${session.title}" to this project?\n\n${projectID}`,
    confirm: "Move",
  }
}

export async function runMoveSessionAction(input: {
  session: Session
  projects: GuiSnapshot["projects"]
  alert: (message: string) => void
  chooseProjectID: (projects: GuiSnapshot["projects"]) => Promise<string | undefined>
  confirm: (input: ConfirmDialogInput) => Promise<boolean>
  moveSession: (sessionID: string, projectID: string) => Promise<void>
  refresh: () => Promise<void>
}) {
  const blocked = moveSessionBlockedMessage(input.projects)
  if (blocked) return input.alert(blocked)
  const projectID = await input.chooseProjectID(input.projects)
  if (!projectID) return
  if (!(await input.confirm(moveSessionConfirmInput(input.session, projectID)))) return
  await input.moveSession(input.session.id, projectID)
  await input.refresh()
}

export function permissionRejectDialog(reply: "once" | "always" | "reject"): TextDialogInput | undefined {
  return reply === "reject" ? { title: "Reject Permission", message: "Optional feedback for the agent" } : undefined
}

export function permissionAlwaysConfirmInput(request: PermissionRequest, reply: "once" | "always" | "reject"): ConfirmDialogInput | undefined {
  return reply === "always"
    ? { title: "Always Allow", message: request.always.join("\n") || request.permission, confirm: "Always Allow" }
    : undefined
}

export async function runPermissionAction(input: {
  request: PermissionRequest
  reply: "once" | "always" | "reject"
  sessions: Session[]
  askText: (input: TextDialogInput) => Promise<string | undefined>
  confirm: (input: ConfirmDialogInput) => Promise<boolean>
  replyPermission: (requestID: string, reply: "once" | "always" | "reject", message?: string, directory?: string) => Promise<void>
  refresh: () => Promise<void>
}) {
  const rejectDialog = permissionRejectDialog(input.reply)
  const message = rejectDialog ? await input.askText(rejectDialog) : undefined
  const allowDialog = permissionAlwaysConfirmInput(input.request, input.reply)
  if (allowDialog && !(await input.confirm(allowDialog))) return
  await input.replyPermission(input.request.id, input.reply, message, sessionDirectoryForRequest(input.sessions, input.request))
  await input.refresh()
}

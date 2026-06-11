import type { Session } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "./client"
import { parseModelValue } from "./model-selection"
import { createSession } from "./store"

export type PreparedSessionPromptTarget = {
  target: Session
  createdSessionID?: string
}

export type SessionPromptRoute = { name: "session" | "new-session"; projectID?: string }

export type SessionPromptSubmission = {
  gui: GuiClient
  route: SessionPromptRoute
  session: Session
  text: string
}

export type SessionPromptSendTarget = {
  sessionID: string
  options: { directory?: string; agent?: string; model?: { providerID: string; modelID: string }; variant?: string }
  modelToRemember?: string
}

export async function runSessionPromptAction(input: {
  gui?: GuiClient
  route: { name: string; projectID?: string }
  session?: Session
  text: string
  permissionCount: number
  questionCount: number
  agent: string
  model: string
  variant: string
  setPrompt: (value: string) => void
  setLoadingSessionID: (sessionID: string) => void
  sendPrompt: (sessionID: string, text: string, options: SessionPromptSendTarget["options"]) => Promise<void>
  rememberModel: (model: string) => void
  syncSession: (sessionID: string) => Promise<void>
  refresh: () => Promise<void>
  openCreatedSession: (sessionID: string) => void
  prepareTarget?: (gui: GuiClient, route: SessionPromptRoute, session: Session) => Promise<PreparedSessionPromptTarget>
}) {
  const submission = prepareSessionPromptSubmission({
    gui: input.gui,
    route: input.route,
    session: input.session,
    text: input.text.trim(),
    permissionCount: input.permissionCount,
    questionCount: input.questionCount,
  })
  if (!submission) return
  input.setPrompt("")
  input.setLoadingSessionID(submission.session.id)
  const prepared = await (input.prepareTarget ?? prepareSessionPromptTarget)(submission.gui, submission.route, submission.session)
  const target = prepareSessionPromptSendTarget({
    target: prepared.target,
    agent: input.agent,
    model: input.model,
    variant: input.variant,
  })
  await input.sendPrompt(target.sessionID, submission.text, target.options)
  if (target.modelToRemember) input.rememberModel(target.modelToRemember)
  await input.syncSession(target.sessionID)
  await input.refresh()
  if (prepared.createdSessionID) input.openCreatedSession(prepared.createdSessionID)
}

export function prepareSessionPromptSubmission(input: {
  gui?: GuiClient
  route: { name: string; projectID?: string }
  session?: Session
  text: string
  permissionCount: number
  questionCount: number
}): SessionPromptSubmission | undefined {
  const route = sessionPromptRoute(input.route)
  if (!input.gui || !route || !input.session || !input.text || input.permissionCount > 0 || input.questionCount > 0) return
  return { gui: input.gui, route, session: input.session, text: input.text }
}

export async function prepareSessionPromptTarget(gui: GuiClient, route: SessionPromptRoute, session: Session): Promise<PreparedSessionPromptTarget> {
  if (route.name === "session") return { target: session }
  const created = await createSession(gui, {
    projectID: route.projectID,
    directory: session.directory,
  })
  return { target: created.data ?? session, createdSessionID: created.data?.id }
}

export function prepareSessionPromptSendTarget(input: {
  target: Session
  agent: string
  model: string
  variant: string
}): SessionPromptSendTarget {
  return {
    sessionID: input.target.id,
    options: {
      directory: input.target.directory,
      agent: input.agent || undefined,
      model: parseModelValue(input.model),
      variant: input.variant || undefined,
    },
    modelToRemember: input.model || undefined,
  }
}

function sessionPromptRoute(route: { name: string; projectID?: string }): SessionPromptRoute | undefined {
  if (route.name === "session") return { name: "session" }
  if (route.name === "new-session") return { name: "new-session", projectID: route.projectID }
}

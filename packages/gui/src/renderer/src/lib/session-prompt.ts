import type { Command, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "./client"
import { parseModelValue } from "./model-selection"
import { createSession, type PromptPart } from "./store"
import { promptPartsForSubmit, serverCommandMatch, textPrompt, type GuiPromptInfo } from "./prompt-state"

export type PreparedSessionPromptTarget = {
  target: Session
  createdSessionID?: string
}

export type SessionPromptRoute = { name: "session" | "new-session"; projectID?: string }

export type SessionPromptSubmission = {
  gui: GuiClient
  route: SessionPromptRoute
  session: Session
  prompt: GuiPromptInfo
}

export type SessionPromptSendTarget = {
  sessionID: string
  options: { directory?: string; agent?: string; model?: { providerID: string; modelID: string }; variant?: string; parts?: PromptPart[] }
  modelToRemember?: string
}

export async function runSessionPromptAction(input: {
  gui?: GuiClient
  route: { name: string; projectID?: string }
  session?: Session
  text: string | GuiPromptInfo
  permissionCount: number
  questionCount: number
  agent: string
  model: string
  variant: string
  setPrompt: (value: string) => void
  setLoadingSessionID: (sessionID: string) => void
  sendPrompt: (sessionID: string, text: string, options: SessionPromptSendTarget["options"]) => Promise<void>
  runCommand?: (sessionID: string, command: string, args: string, options: SessionPromptSendTarget["options"]) => Promise<void>
  runShell?: (sessionID: string, command: string, options: SessionPromptSendTarget["options"]) => Promise<void>
  serverCommands?: Command[]
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
    prompt: normalizePromptInput(input.text),
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
    prompt: submission.prompt,
  })
  const command = serverCommandMatch(submission.prompt.input, input.serverCommands ?? [])
  if (submission.prompt.mode === "shell" && input.runShell) await input.runShell(target.sessionID, submission.prompt.input, target.options)
  else if (command && input.runCommand) await input.runCommand(target.sessionID, command.command.name, command.arguments, target.options)
  else await input.sendPrompt(target.sessionID, submission.prompt.input, target.options)
  if (target.modelToRemember) input.rememberModel(target.modelToRemember)
  await input.syncSession(target.sessionID)
  await input.refresh()
  if (prepared.createdSessionID) input.openCreatedSession(prepared.createdSessionID)
}

export function prepareSessionPromptSubmission(input: {
  gui?: GuiClient
  route: { name: string; projectID?: string }
  session?: Session
  prompt: GuiPromptInfo
  permissionCount: number
  questionCount: number
}): SessionPromptSubmission | undefined {
  const route = sessionPromptRoute(input.route)
  if (!input.gui || !route || !input.session || !input.prompt.input.trim() || input.permissionCount > 0 || input.questionCount > 0) return
  return { gui: input.gui, route, session: input.session, prompt: input.prompt }
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
  prompt: GuiPromptInfo
}): SessionPromptSendTarget {
  return {
    sessionID: input.target.id,
    options: {
      directory: input.target.directory,
      agent: input.agent || undefined,
      model: parseModelValue(input.model),
      variant: input.variant || undefined,
      parts: promptPartsForSubmit(input.prompt),
    },
    modelToRemember: input.model || undefined,
  }
}

function sessionPromptRoute(route: { name: string; projectID?: string }): SessionPromptRoute | undefined {
  if (route.name === "session") return { name: "session" }
  if (route.name === "new-session") return { name: "new-session", projectID: route.projectID }
}

function normalizePromptInput(input: string | GuiPromptInfo): GuiPromptInfo {
  if (typeof input !== "string") return input
  const text = input.trim()
  if (!text.startsWith("!")) return textPrompt(text)
  return { input: text.slice(1).trimStart(), parts: [], mode: "shell" }
}

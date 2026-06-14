import type { Command, OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "./client"
import { parseModelValue } from "./model-selection"
import { createSession, deleteSession, updateView, type PromptPart } from "./store"
import { promptPartsForSubmit, serverCommandMatch, textPrompt, type GuiPromptInfo } from "./prompt-state"
import { metadataWithPendingSessions, pendingViewSessions, viewItemID, viewItemSession, type ViewItem } from "./view-items"

export type PreparedViewPromptTarget =
  | { type: "ready"; draftSession: Session; target: Session; focusSessionID?: string }
  | { type: "notice"; message: string }
  | { type: "unavailable" }

export type ViewPromptSubmission = {
  gui: GuiClient
  item: ViewItem
  draftID: string
  prompt: GuiPromptInfo
}

export type ViewPromptSendTarget = {
  sessionID: string
  options: { directory?: string; agent?: string; model?: { providerID: string; modelID: string }; variant?: string; parts?: PromptPart[] }
  modelToRemember?: string
}

export async function runViewPromptAction(input: {
  gui?: GuiClient
  item: ViewItem
  view?: OpencodeXView
  text: string | GuiPromptInfo
  agentForSession: (session: Session) => string
  modelForSession: (session: Session) => string
  variantForSession: (session: Session) => string
  setDraftLoading: (draftID: string, loading: boolean) => void
  setFocusedSessionID: (sessionID: string) => void
  alert: (message: string) => void
  sendPrompt: (sessionID: string, text: string, options: ViewPromptSendTarget["options"]) => Promise<void>
  runCommand?: (sessionID: string, command: string, args: string, options: ViewPromptSendTarget["options"]) => Promise<void>
  runShell?: (sessionID: string, command: string, options: ViewPromptSendTarget["options"]) => Promise<void>
  serverCommands?: Command[]
  rememberModel: (model: string) => void
  syncViewSession: (session: Session) => Promise<void>
  refresh: () => Promise<void>
  prepareTarget?: (gui: GuiClient, item: ViewItem, view?: OpencodeXView) => Promise<PreparedViewPromptTarget>
}) {
  const submission = prepareViewPromptSubmission({ gui: input.gui, item: input.item, prompt: normalizePromptInput(input.text) })
  if (!submission) return
  const showDraftLoading = submission.item.kind === "pending"
  if (showDraftLoading) input.setDraftLoading(submission.draftID, true)
  try {
    const prepared = await (input.prepareTarget ?? prepareViewPromptTarget)(submission.gui, submission.item, input.view)
    if (prepared.type === "notice") return input.alert(prepared.message)
    if (prepared.type === "unavailable") return
    if (prepared.focusSessionID) input.setFocusedSessionID(prepared.focusSessionID)
    const target = prepareViewPromptSendTarget({
      target: prepared.target,
      agent: input.agentForSession(prepared.draftSession),
      model: input.modelForSession(prepared.draftSession),
      variant: input.variantForSession(prepared.draftSession),
      prompt: submission.prompt,
    })
    const command = serverCommandMatch(submission.prompt.input, input.serverCommands ?? [])
    if (submission.prompt.mode === "shell" && input.runShell) await input.runShell(target.sessionID, submission.prompt.input, target.options)
    else if (command && input.runCommand) await input.runCommand(target.sessionID, command.command.name, command.arguments, target.options)
    else await input.sendPrompt(target.sessionID, submission.prompt.input, target.options)
    if (target.modelToRemember) input.rememberModel(target.modelToRemember)
    await input.syncViewSession(prepared.target)
    await input.refresh()
  } finally {
    if (showDraftLoading) input.setDraftLoading(submission.draftID, false)
  }
}

function normalizePromptInput(input: string | GuiPromptInfo): GuiPromptInfo {
  if (typeof input !== "string") return input
  const text = input.trim()
  if (!text.startsWith("!")) return textPrompt(text)
  return { input: text.slice(1).trimStart(), parts: [], mode: "shell" }
}

export function prepareViewPromptSubmission(input: { gui?: GuiClient; item: ViewItem; prompt: GuiPromptInfo }): ViewPromptSubmission | undefined {
  if (!input.gui || !input.prompt.input.trim()) return
  return { gui: input.gui, item: input.item, draftID: viewItemID(input.item), prompt: input.prompt }
}

export async function prepareViewPromptTarget(gui: GuiClient, item: ViewItem, view?: OpencodeXView): Promise<PreparedViewPromptTarget> {
  const draftSession = viewItemSession(item, gui.directory)
  if (item.kind === "session") return { type: "ready", draftSession, target: draftSession }

  const directory = item.slot.directory ?? gui.directory
  if (!directory) return { type: "notice", message: "No directory available for this pending view session." }

  const created = await createSession(gui, {
    projectID: item.slot.projectID,
    directory,
  })
  const createdSession = created.data
  if (!createdSession || !view) {
    if (createdSession) await deleteSession(gui, createdSession.id).catch(() => undefined)
    return { type: "unavailable" }
  }

  const pending = pendingViewSessions(view).filter((slot) => slot.id !== item.slot.id)
  await updateView(gui, view.id, {
    sessionIDs: [...view.sessionIDs.filter((sessionID) => sessionID !== createdSession.id), createdSession.id],
    focusedSessionID: createdSession.id,
    metadata: metadataWithPendingSessions(view.metadata, pending),
  }).catch(async (error: Error) => {
    await deleteSession(gui, createdSession.id).catch(() => undefined)
    throw error
  })

  return { type: "ready", draftSession, target: createdSession, focusSessionID: createdSession.id }
}

export function prepareViewPromptSendTarget(input: {
  target: Session
  agent: string
  model: string
  variant: string
  prompt?: GuiPromptInfo
}): ViewPromptSendTarget {
  return {
    sessionID: input.target.id,
    options: {
      directory: input.target.directory,
      agent: input.agent || undefined,
      model: parseModelValue(input.model),
      variant: input.variant || undefined,
      parts: input.prompt ? promptPartsForSubmit(input.prompt) : undefined,
    },
    modelToRemember: input.model || undefined,
  }
}

import type { OpencodeXView, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiClient } from "./client"
import { parseModelValue } from "./model-selection"
import { createSession, deleteSession, updateView } from "./store"
import { metadataWithPendingSessions, pendingViewSessions, viewItemID, viewItemSession, type ViewItem } from "./view-items"

export type PreparedViewPromptTarget =
  | { type: "ready"; draftSession: Session; target: Session; focusSessionID?: string }
  | { type: "notice"; message: string }
  | { type: "unavailable" }

export type ViewPromptSubmission = {
  gui: GuiClient
  item: ViewItem
  draftID: string
  text: string
}

export type ViewPromptSendTarget = {
  sessionID: string
  options: { directory?: string; agent?: string; model?: { providerID: string; modelID: string }; variant?: string }
  modelToRemember?: string
}

export async function runViewPromptAction(input: {
  gui?: GuiClient
  item: ViewItem
  view?: OpencodeXView
  text: string
  agentForSession: (session: Session) => string
  modelForSession: (session: Session) => string
  variantForSession: (session: Session) => string
  setDraftLoading: (draftID: string, loading: boolean) => void
  setFocusedSessionID: (sessionID: string) => void
  alert: (message: string) => void
  sendPrompt: (sessionID: string, text: string, options: ViewPromptSendTarget["options"]) => Promise<void>
  rememberModel: (model: string) => void
  syncViewSession: (session: Session) => Promise<void>
  refresh: () => Promise<void>
  prepareTarget?: (gui: GuiClient, item: ViewItem, view?: OpencodeXView) => Promise<PreparedViewPromptTarget>
}) {
  const submission = prepareViewPromptSubmission({ gui: input.gui, item: input.item, text: input.text })
  if (!submission) return
  input.setDraftLoading(submission.draftID, true)
  const prepared = await (input.prepareTarget ?? prepareViewPromptTarget)(submission.gui, submission.item, input.view)
  if (prepared.type === "notice") return input.alert(prepared.message)
  if (prepared.type === "unavailable") return
  if (prepared.focusSessionID) input.setFocusedSessionID(prepared.focusSessionID)
  const target = prepareViewPromptSendTarget({
    target: prepared.target,
    agent: input.agentForSession(prepared.draftSession),
    model: input.modelForSession(prepared.draftSession),
    variant: input.variantForSession(prepared.draftSession),
  })
  await input.sendPrompt(target.sessionID, submission.text, target.options)
  if (target.modelToRemember) input.rememberModel(target.modelToRemember)
  await input.syncViewSession(prepared.target)
  await input.refresh()
}

export function prepareViewPromptSubmission(input: { gui?: GuiClient; item: ViewItem; text: string }): ViewPromptSubmission | undefined {
  const text = input.text.trim()
  if (!input.gui || !text) return
  return { gui: input.gui, item: input.item, draftID: viewItemID(input.item), text }
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
}): ViewPromptSendTarget {
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

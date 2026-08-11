import type { Accessor, Setter } from "solid-js"
import type { GuiPromptInfo } from "../lib/prompt-state"
import type { PromptDelivery, PromptPart } from "../lib/session-api"
import type { createSessionFollowupController } from "./session-followup-controller"

export function createSessionComposerSubmit(input: {
  blocked: Accessor<boolean>
  disconnected: Accessor<boolean>
  draftPrompt: Accessor<string>
  draftText: Accessor<string>
  draftParts: Accessor<PromptPart[]>
  setDraftPrompt: Setter<string>
  setDraftParts: Setter<PromptPart[]>
  resize: () => void
  flush: () => void
  prepare: () => void
  selection: () => { agent: string; model: string; variant: string }
  followup: ReturnType<typeof createSessionFollowupController>
  submit: (
    prompt: GuiPromptInfo,
    options?: { delivery?: PromptDelivery; agent?: string; model?: string; variant?: string },
  ) => Promise<boolean>
  accepted: () => void
}) {
  return async (event: SubmitEvent) => {
    event.preventDefault()
    const draft = input.draftPrompt()
    const text = input.draftText()
    const parts = [...input.draftParts()]
    if (input.blocked() || (!text && parts.length === 0) || input.disconnected()) return
    input.prepare()
    const shell = text.startsWith("!") ? text.slice(1).trimStart() : undefined
    const prompt: GuiPromptInfo = {
      input: shell ?? text,
      parts:
        shell !== undefined
          ? []
          : parts.length
            ? [...(text ? [{ type: "text" as const, text }] : []), ...parts]
            : [{ type: "text", text }],
      ...(shell !== undefined ? { mode: "shell" } : {}),
    }
    const delivery = input.followup.delivery(event)
    input.setDraftPrompt("")
    input.setDraftParts([])
    input.resize()
    input.flush()
    const selection = input.selection()
    const queued = delivery === "queue" && input.followup.queue(prompt, selection)
    const accepted = queued ? true : await input.submit(prompt, { delivery, ...selection })
    if (!accepted) {
      input.setDraftPrompt((current) => (!draft ? current : current ? `${draft}\n${current}` : draft))
      input.setDraftParts((current) => [...parts, ...current])
      input.resize()
      input.flush()
      return
    }
    input.accepted()
  }
}

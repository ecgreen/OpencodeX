import type { Session } from "@opencode-ai/sdk/v2/client"
import type { MessageBundle, PromptPart, SessionData } from "../lib/store"
import type { SessionMessageActionContext, SessionMessageActionKind } from "../lib/message-actions"

export function createComposerPromptRestore(input: {
  setDraftPrompt: (text: string) => void
  setDraftParts: (parts: PromptPart[]) => void
  resizeComposer: () => void
  focus: () => void
}) {
  return (prompt: string | { input: string; parts: PromptPart[] }) => {
    input.setDraftPrompt(typeof prompt === "string" ? prompt : prompt.input)
    input.setDraftParts(typeof prompt === "string" ? [] : prompt.parts)
    requestAnimationFrame(() => {
      input.resizeComposer()
      input.focus()
    })
  }
}

export function createSessionMessageActionHandler(input: {
  session: () => Session | undefined
  data: () => SessionData
  onMessageAction?: (action: SessionMessageActionKind, context: SessionMessageActionContext) => void | Promise<void>
  restorePrompt: (prompt: { input: string; parts: PromptPart[] }) => void
}) {
  return (action: SessionMessageActionKind, bundle: MessageBundle) => {
    const selected = input.session()
    if (!selected || selected.id.startsWith("pending:") || !input.onMessageAction) return
    const data = input.data()
    void input.onMessageAction(action, {
      session: selected,
      data,
      bundle: data.messages.find((message) => message.info.id === bundle.info.id) ?? bundle,
      restorePrompt: input.restorePrompt,
    })
  }
}

import type { Session } from "@opencode-ai/sdk/v2/client"
import type { MessageBundle, PromptPart, SessionData } from "./store-types"
import { displayMessageText } from "./message-text"

export type SessionMessageActionKind = "copy" | "edit" | "retry" | "fork"

export type SessionMessageActionContext = {
  session: Session
  data: SessionData
  bundle: MessageBundle
  restorePrompt: (prompt: { input: string; parts: PromptPart[] }) => void
}

export function messageTextForCopy(bundle: MessageBundle) {
  const text = bundle.parts
    .map((part) => {
      if (part.type !== "text" || part.synthetic || part.ignored) return ""
      return part.text
    })
    .filter(Boolean)
    .join("\n\n")
  return displayMessageText(text).trim()
}

export function messagePromptForEdit(bundle: MessageBundle) {
  return {
    input: bundle.parts.map(editableTextPart).join(""),
    parts: bundle.parts.flatMap((part): PromptPart[] => {
      if (part.type === "text" && part.synthetic && !part.ignored) return [{ type: "text", text: part.text, synthetic: true, ...(part.metadata ? { metadata: part.metadata } : {}) }]
      if (part.type === "file") return [{ type: "file", mime: part.mime, filename: part.filename, url: part.url, ...(part.source ? { source: part.source } : {}) }]
      if (part.type === "agent") return [{ type: "agent", name: part.name, ...(part.source ? { source: part.source } : {}) }]
      return []
    }),
  }
}

export function messagePromptForFork(bundle: MessageBundle) {
  if (bundle.info.role !== "user") return
  return messagePromptForEdit(bundle)
}

export function precedingUserMessage(messages: MessageBundle[], messageID: string) {
  const index = messages.findIndex((message) => message.info.id === messageID)
  if (index < 0) return
  for (let at = index - 1; at >= 0; at -= 1) {
    const message = messages[at]
    if (message.info.role === "user") return message
  }
}

export function messageActionAvailability(bundle: MessageBundle, pending: boolean): Record<SessionMessageActionKind, boolean> {
  return {
    copy: messageTextForCopy(bundle).length > 0,
    edit: !pending && bundle.info.role === "user",
    retry: !pending && bundle.info.role === "assistant",
    fork: !pending,
  }
}

function editableTextPart(part: MessageBundle["parts"][number]) {
  if (part.type !== "text" || part.synthetic || part.ignored) return ""
  return part.text
}

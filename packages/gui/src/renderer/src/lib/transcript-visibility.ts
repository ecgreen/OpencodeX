import { bundleError } from "./message-error"
import { isSteeringPart } from "./session-steering"
import type { MessageBundle } from "./store-types"

export const TRANSCRIPT_PROMPT_HISTORY_LIMIT = 8
/** A hover preview is a reminder, not a reading surface - past this the reader
 * should click through to the real message. */
export const TRANSCRIPT_PROMPT_PREVIEW_LENGTH = 400

export type TranscriptPromptEntry = {
  messageID: string
  text: string
}

/**
 * The prompt-history rail shows one marker per user turn. Only genuine typed
 * prompts qualify: synthetic steering, compaction bookkeeping, and blank turns
 * would produce markers that jump to nothing the reader recognizes. The list
 * keeps chronological order but caps at the newest entries - the rail is a
 * recency aid, not a full index, and older pages may not even be loaded.
 */
export function transcriptPromptHistory(
  messages: MessageBundle[],
  limit = TRANSCRIPT_PROMPT_HISTORY_LIMIT,
): TranscriptPromptEntry[] {
  const entries = messages.flatMap((message) => {
    if (message.info.role !== "user") return []
    const text = promptPreviewText(message.parts)
    return text ? [{ messageID: message.info.id, text }] : []
  })
  return entries.slice(-limit)
}

function promptPreviewText(parts: MessageBundle["parts"]) {
  const text = parts
    .flatMap((part) => (part.type === "text" && isVisibleTranscriptPart(part) ? [part.text] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
  if (text.length <= TRANSCRIPT_PROMPT_PREVIEW_LENGTH) return text
  return `${text.slice(0, TRANSCRIPT_PROMPT_PREVIEW_LENGTH - 1).trimEnd()}…`
}

export function visibleTranscriptMessages(messages: MessageBundle[]) {
  return messages.flatMap((message, index) => {
    const parts = visibleTranscriptParts(message.parts)
    if (parts.length === 0 && !hasVisibleTranscriptError(message)) return []
    const steeringInterruption = isSteeringInterruption(messages, index)
    if (parts.length === message.parts.length && !steeringInterruption) return [message]
    return [
      {
        ...message,
        info: steeringInterruption ? { ...message.info, error: undefined } : message.info,
        parts,
      } as MessageBundle,
    ]
  })
}

export function visibleTranscriptMessageIDs(messages: MessageBundle[]) {
  return messages
    .filter((message) => message.parts.some(isVisibleTranscriptPart) || hasVisibleTranscriptError(message))
    .map((message) => message.info.id)
}

/**
 * A turn that failed before producing any part still has to render, otherwise
 * the transcript stays blank and the failure is invisible.
 */
export function hasVisibleTranscriptError(message: MessageBundle) {
  const error = bundleError(message.info)
  return Boolean(error) && error?.name !== "MessageAbortedError"
}

export function visibleTranscriptParts(parts: MessageBundle["parts"]) {
  return parts.filter(isVisibleTranscriptPart)
}

function isVisibleTranscriptPart(part: MessageBundle["parts"][number]) {
  if (isStructuralPart(part) || part.type === "compaction") return false
  if (part.type === "text") return !part.synthetic && !part.ignored && Boolean(part.text.trim())
  if (part.type === "reasoning") return Boolean(part.text.trim())
  return true
}

function isSteeringInterruption(messages: MessageBundle[], index: number) {
  if (bundleError(messages[index].info)?.name !== "MessageAbortedError") return false
  const next = messages[index + 1]
  return next?.info.role === "user" && next.parts.some(isSteeringPart)
}

/**
 * Bookkeeping the reader never needs. Retries and subtasks are deliberately not
 * here: a retried turn that renders nothing looks like the model went silent.
 */
export function isStructuralPart(part: MessageBundle["parts"][number]) {
  return part.type === "step-start" || part.type === "step-finish" || part.type === "snapshot"
}

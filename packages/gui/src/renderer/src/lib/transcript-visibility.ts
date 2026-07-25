import { bundleError } from "./message-error"
import type { MessageBundle } from "./store-types"

export function visibleTranscriptMessages(messages: MessageBundle[]) {
  return messages.flatMap((message) => {
    const parts = visibleTranscriptParts(message.parts)
    if (parts.length === 0 && !hasVisibleTranscriptError(message)) return []
    return [parts.length === message.parts.length ? message : { ...message, parts }]
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

/**
 * Bookkeeping the reader never needs. Retries and subtasks are deliberately not
 * here: a retried turn that renders nothing looks like the model went silent.
 */
export function isStructuralPart(part: MessageBundle["parts"][number]) {
  return (
    part.type === "step-start" ||
    part.type === "step-finish" ||
    part.type === "snapshot"
  )
}

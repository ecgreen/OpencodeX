import type { MessageBundle } from "./store-types"

export function visibleTranscriptMessages(messages: MessageBundle[]) {
  return messages.flatMap((message) => {
    const parts = visibleTranscriptParts(message.parts)
    if (parts.length === 0) return []
    return [parts.length === message.parts.length ? message : { ...message, parts }]
  })
}

export function visibleTranscriptMessageIDs(messages: MessageBundle[]) {
  return messages.filter((message) => message.parts.some(isVisibleTranscriptPart)).map((message) => message.info.id)
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

function isStructuralPart(part: MessageBundle["parts"][number]) {
  return (
    part.type === "step-start" ||
    part.type === "step-finish" ||
    part.type === "snapshot" ||
    part.type === "retry" ||
    part.type === "subtask"
  )
}

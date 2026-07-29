import type { Part } from "@opencode-ai/sdk/v2/client"

/**
 * Reconciles a freshly loaded part list against the one already rendered.
 * Incoming parts are authoritative; the only survivors from the current list are
 * still-streaming text parts the loaded page has not caught up with yet.
 */
export function mergeLoadedParts(current: Part[], incoming: Part[]) {
  const incomingPartIDs = new Set(incoming.map((part) => part.id))
  const next = sortParts([
    ...incoming,
    ...current.filter((part) => !incomingPartIDs.has(part.id) && isTextPart(part) && !textPartEnded(part)),
  ])
  return current.length === next.length && current.every((part, index) => part === next[index]) ? current : next
}

function isTextPart(part: Part): part is Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }> {
  return part.type === "text" || part.type === "reasoning"
}

function textPartEnded(part: Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }>) {
  // A part with no timing never streamed, so it cannot be "not caught up yet" —
  // treat it as final and let the authoritative reload win.
  return part.time === undefined || typeof part.time.end === "number"
}

function sortParts(parts: Part[]) {
  return parts.toSorted((a, b) => a.id.localeCompare(b.id))
}

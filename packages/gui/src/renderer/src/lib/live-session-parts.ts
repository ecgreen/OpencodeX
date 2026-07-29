import type { Part } from "@opencode-ai/sdk/v2/client"
import { normalizeClientDisplayPart } from "@opencode-ai/sdk/v2/client-sync"

const pendingLiveParts = new Map<string, Part[]>()
const pendingLivePartDeltas = new Map<string, Map<string, string>>()

export function normalizeLivePart(part: Part): Part {
  return normalizeClientDisplayPart(part)
}

export function mergePartLists(parts: Part[], incoming: Part[]) {
  if (incoming.length === 0) return parts
  return incoming.reduce((next, part) => upsertPartList(next, part), parts)
}

export function upsertPartList(parts: Part[], part: Part) {
  const index = parts.findIndex((item) => item.id === part.id)
  const next = index >= 0 ? parts.map((item, i) => (i === index ? part : item)) : [...parts, part]
  return sortParts(next)
}

export function mergeLoadedParts(current: Part[], incoming: Part[]) {
  const incomingPartIDs = new Set(incoming.map((part) => part.id))
  const next = sortParts([
    ...incoming,
    ...current.filter((part) => !incomingPartIDs.has(part.id) && isTextPart(part) && !textPartEnded(part)),
  ])
  return current.length === next.length && current.every((part, index) => part === next[index]) ? current : next
}

export function rememberPendingPart(part: Part) {
  pendingLiveParts.set(part.messageID, upsertPartList(pendingLiveParts.get(part.messageID) ?? [], part))
}

export function takePendingParts(messageID: string) {
  const parts = pendingLiveParts.get(messageID) ?? []
  pendingLiveParts.delete(messageID)
  return parts
}

export function forgetPendingMessageParts(messageID: string) {
  pendingLiveParts.delete(messageID)
  pendingLivePartDeltas.delete(messageID)
}

export function forgetPendingPart(messageID: string, partID: string) {
  const parts = pendingLiveParts.get(messageID)
  if (parts) {
    const next = parts.filter((part) => part.id !== partID)
    if (next.length > 0) pendingLiveParts.set(messageID, next)
    else pendingLiveParts.delete(messageID)
  }
  const deltas = pendingLivePartDeltas.get(messageID)
  if (!deltas) return
  Array.from(deltas.keys())
    .filter((key) => key.startsWith(`${partID}\0`))
    .forEach((key) => deltas.delete(key))
  if (deltas.size === 0) pendingLivePartDeltas.delete(messageID)
}

export function rememberPendingPartDelta(messageID: string, partID: string, field: string, delta: string) {
  const pending = pendingLiveParts.get(messageID)
  if (pending?.some((part) => part.id === partID)) {
    pendingLiveParts.set(
      messageID,
      pending.map((part) => (part.id === partID ? applyDeltaToPart(part, field, delta) : part)),
    )
    return
  }
  const deltas = pendingLivePartDeltas.get(messageID) ?? new Map<string, string>()
  const key = pendingDeltaKey(partID, field)
  deltas.set(key, (deltas.get(key) ?? "") + delta)
  pendingLivePartDeltas.set(messageID, deltas)
}

export function applyPendingDeltasToPart(part: Part): Part {
  const deltas = pendingLivePartDeltas.get(part.messageID)
  if (!deltas) return part
  const next = Array.from(deltas).reduce((current, [key, delta]) => {
    const [partID, field] = key.split("\0")
    if (partID !== part.id || !field) return current
    deltas.delete(key)
    return applyDeltaToPart(current, field, delta)
  }, part)
  if (deltas.size === 0) pendingLivePartDeltas.delete(part.messageID)
  return next
}

function isTextPart(part: Part): part is Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }> {
  return part.type === "text" || part.type === "reasoning"
}

function textPartEnded(part: Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }>) {
  return typeof part.time?.end === "number"
}

function sortParts(parts: Part[]) {
  return parts.toSorted((a, b) => a.id.localeCompare(b.id))
}

function applyDeltaToPart(part: Part, field: string, delta: string): Part {
  if (field !== "text" || (part.type !== "text" && part.type !== "reasoning")) return part
  return { ...part, text: part.text + delta } as Part
}

function pendingDeltaKey(partID: string, field: string) {
  return `${partID}\0${field}`
}

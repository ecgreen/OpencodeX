import type { OpencodeXSessionSnapshot, Part } from "@opencode-ai/sdk/v2/client"
import type { ClientStateSyncState } from "@opencode-ai/sdk/v2/client-sync"
import { messageCursorBefore } from "./message-window"
import { displayMessageText } from "./message-text"
import type { MessageBundle, SessionData } from "./store-types"

const normalizedPartCache = new WeakMap<Part, Part>()

export function sessionDataFromClientState(
  state: ClientStateSyncState,
  sessionID: string,
  current?: SessionData,
): SessionData | undefined {
  const detail = state.sessionDetails[sessionID]
  if (!detail) return
  const currentMessages = new Map(current?.messages.map((message) => [message.info.id, message]) ?? [])
  const projected = detail.messageIDs.flatMap((messageID) => {
    const info = detail.messages[messageID]
    if (!info) return []
    const partIDs = detail.partIDs[messageID] ?? []
    const existing = currentMessages.get(messageID)
    if (
      existing?.info === info &&
      existing.parts.length === partIDs.length &&
      partIDs.every((partID, index) => {
        const part = detail.parts[partID]
        return part ? normalizeMessagePart(part) === existing.parts[index] : false
      })
    )
      return [existing]
    const parts = partIDs.flatMap((partID) => {
      const part = detail.parts[partID]
      return part ? [normalizeMessagePart(part)] : []
    })
    return [{ info, parts }]
  })
  // The sync state may hold far more history than the windowed page this
  // session opened with. Projecting all of it would silently prepend older
  // messages - the transcript visibly grows above and the scroll shifts on the
  // first live update after a prompt. Older history stays behind "Load more".
  const windowed = clipToCurrentWindow(projected, current)
  const messages = current && sameItems(current.messages, windowed.messages) ? current.messages : windowed.messages
  const next = {
    messages,
    messageCursor: windowed.clipped
      ? messageCursorBefore(windowed.messages[0]!) ?? detail.snapshot.messages.boundary.next
      : detail.snapshot.messages.boundary.next,
    todos: detail.snapshot.todos,
    diffs: detail.snapshot.diff,
  }
  if (
    current &&
    current.messages === next.messages &&
    current.messageCursor === next.messageCursor &&
    current.todos === next.todos &&
    current.diffs === next.diffs &&
    !current.messageWindowExpanded
  )
    return current
  return next
}

export function sessionDataFromSnapshot(snapshot: OpencodeXSessionSnapshot): SessionData {
  return {
    messages: normalizeMessageText(snapshot.messages.items as MessageBundle[]),
    messageCursor: snapshot.messages.boundary.next,
    todos: snapshot.todos as SessionData["todos"],
    diffs: snapshot.diff as SessionData["diffs"],
  }
}

export function normalizeMessageText(messages: readonly MessageBundle[]) {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map(normalizeMessagePart),
  }))
}

function normalizeMessagePart(part: Part) {
  if (part.type !== "text" && part.type !== "reasoning") return part
  const cached = normalizedPartCache.get(part)
  if (cached) return cached
  const normalized = { ...part, text: displayMessageText(part.text) } as Part
  normalizedPartCache.set(part, normalized)
  return normalized
}

/**
 * Drops projected messages older than the first one currently shown, unless the
 * reader explicitly expanded the window with "Load more". New messages only
 * ever arrive at the tail, so clipping the head never hides fresh activity.
 */
export function clipToCurrentWindow(
  projected: MessageBundle[],
  current?: SessionData,
): { messages: MessageBundle[]; clipped: boolean } {
  if (!current || current.messageWindowExpanded) return { messages: projected, clipped: false }
  const first = current.messages[0]
  if (!first) return { messages: projected, clipped: false }
  const index = projected.findIndex((message) => message.info.id === first.info.id)
  if (index <= 0) return { messages: projected, clipped: false }
  return { messages: projected.slice(index), clipped: true }
}

function sameItems<T>(current: T[], next: T[]) {
  return current.length === next.length && current.every((item, index) => item === next[index])
}

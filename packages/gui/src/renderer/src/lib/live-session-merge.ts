import { mergeLoadedParts } from "./live-session-parts"
import { sameValue } from "./same-value"
import type { MessageBundle, SessionData } from "./store-types"

export function mergeLiveSessionData(current: SessionData | undefined, incoming: SessionData): SessionData {
  if (!current) return incoming
  if (current === incoming) return current
  if (current.messageWindowExpanded) return mergeExpandedSessionData(current, incoming)
  const currentMessages = new Map(current.messages.map((bundle) => [bundle.info.id, bundle]))
  const messages = incoming.messages.map((bundle) => {
    const existing = currentMessages.get(bundle.info.id)
    if (!existing) return bundle
    if (existing === bundle) return existing
    const parts = mergeLoadedParts(existing.parts, bundle.parts)
    return existing.info === bundle.info && existing.parts === parts ? existing : { ...bundle, parts }
  })
  const next = {
    ...incoming,
    messages: sameItems(current.messages, messages) ? current.messages : messages,
  }
  return sameSessionData(current, next) ? current : next
}

function mergeExpandedSessionData(current: SessionData, incoming: SessionData): SessionData {
  const incomingMessages = new Map(incoming.messages.map((bundle) => [bundle.info.id, bundle]))
  const currentMessageIDs = new Set(current.messages.map((bundle) => bundle.info.id))
  const messages = mergeSortedByCreated(
    current.messages.map((bundle) => {
      const incoming = incomingMessages.get(bundle.info.id)
      if (!incoming) return bundle
      if (incoming === bundle) return bundle
      const parts = mergeLoadedParts(bundle.parts, incoming.parts)
      return bundle.info === incoming.info && bundle.parts === parts ? bundle : { ...incoming, parts }
    }),
    incoming.messages.filter((bundle) => !currentMessageIDs.has(bundle.info.id)),
  )
  const next = {
    ...incoming,
    messages: sameItems(current.messages, messages) ? current.messages : messages,
    messageCursor: current.messageCursor,
    messageWindowExpanded: true,
  }
  return sameSessionData(current, next) ? current : next
}

/**
 * Both inputs are already ordered by `time.created`, so a linear two-list merge
 * replaces the full re-sort a concatenation would have needed.
 */
function mergeSortedByCreated(left: MessageBundle[], right: MessageBundle[]) {
  if (right.length === 0) return left
  if (left.length === 0) return right
  const merged: MessageBundle[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftBundle = left[leftIndex]
    const rightBundle = right[rightIndex]
    // `<=` keeps the current list ahead of the incoming one on ties, matching the
    // stable sort this replaced.
    if ((leftBundle.info.time.created ?? 0) <= (rightBundle.info.time.created ?? 0)) {
      merged.push(leftBundle)
      leftIndex += 1
      continue
    }
    merged.push(rightBundle)
    rightIndex += 1
  }
  for (; leftIndex < left.length; leftIndex += 1) merged.push(left[leftIndex])
  for (; rightIndex < right.length; rightIndex += 1) merged.push(right[rightIndex])
  return merged
}

function sameSessionData(current: SessionData, next: SessionData) {
  // The SDK reconciles session snapshots and hands back the previous value
  // whenever the payload is unchanged, so identity already answers this for the
  // side channels. Deep comparing them is pure cost - `diffs` entries carry the
  // full patch text of every touched file.
  return sameValue(current.messages, next.messages) &&
    current.messageCursor === next.messageCursor &&
    sameItems(current.todos, next.todos) &&
    sameItems(current.diffs, next.diffs) &&
    current.messageWindowExpanded === next.messageWindowExpanded
}

function sameItems<T>(current: T[], next: T[]) {
  return current.length === next.length && current.every((item, index) => item === next[index])
}

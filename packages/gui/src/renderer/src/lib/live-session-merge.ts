import { sortMessageBundles } from "./live-session-patch-helpers"
import { mergeLoadedParts } from "./live-session-parts"
import { sameValue } from "./same-value"
import type { SessionData } from "./store-types"

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
  const messages = sortMessageBundles([
    ...current.messages.map((bundle) => {
      const incoming = incomingMessages.get(bundle.info.id)
      if (!incoming) return bundle
      if (incoming === bundle) return bundle
      const parts = mergeLoadedParts(bundle.parts, incoming.parts)
      return bundle.info === incoming.info && bundle.parts === parts ? bundle : { ...incoming, parts }
    }),
    ...incoming.messages.filter((bundle) => !currentMessageIDs.has(bundle.info.id)),
  ])
  const next = {
    ...incoming,
    messages: sameItems(current.messages, messages) ? current.messages : messages,
    messageCursor: current.messageCursor,
    messageWindowExpanded: true,
  }
  return sameSessionData(current, next) ? current : next
}

function sameSessionData(current: SessionData, next: SessionData) {
  return sameValue(current.messages, next.messages) &&
    current.messageCursor === next.messageCursor &&
    sameValue(current.todos, next.todos) &&
    sameValue(current.diffs, next.diffs) &&
    current.messageWindowExpanded === next.messageWindowExpanded
}

function sameItems<T>(current: T[], next: T[]) {
  return current.length === next.length && current.every((item, index) => item === next[index])
}

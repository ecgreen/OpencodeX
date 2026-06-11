import type { MessageBundle, SessionData } from "./store"

export type MessageWindow = {
  count: number
  budget: number
}

export type MessagePage = {
  messages: MessageBundle[]
  cursor?: string
}

export function prependOlderMessages(data: SessionData, page: MessagePage): SessionData {
  return {
    ...data,
    messages: mergeMessageBundles([...page.messages, ...data.messages]),
    messageCursor: page.cursor,
  }
}

export function trimToLiveTail(data: SessionData, limit: number | MessageWindow): SessionData {
  const window = messagesFromEnd(data.messages, limit)
  if (!window.trimmed) return data
  return {
    ...data,
    messages: window.messages,
    messageCursor: window.messages[0] ? messageCursorBefore(window.messages[0]) : data.messageCursor,
  }
}

export function selectLiveTailMessages(messages: MessageBundle[], limit: number | MessageWindow) {
  return messagesFromEnd(messages, limit).messages
}

function mergeMessageBundles(messages: MessageBundle[]) {
  return messagesByTime(Array.from(new Map(messages.map((message) => [message.info.id, message])).values()))
}

function messagesByTime(messages: MessageBundle[]) {
  return messages.toSorted((a, b) => (a.info.time.created ?? 0) - (b.info.time.created ?? 0))
}

function messagesFromEnd(messages: MessageBundle[], input: number | MessageWindow) {
  const limit = messageWindow(input)
  const selected: MessageBundle[] = []
  let budget = 0
  for (const message of messages.toReversed()) {
    if (selected.length >= limit.count) break
    const weight = messageWeight(message)
    if (selected.length > 0 && budget + weight > limit.budget) break
    selected.unshift(message)
    budget += weight
  }
  return { messages: selected, trimmed: selected.length < messages.length }
}

function messageWindow(input: number | MessageWindow): MessageWindow {
  if (typeof input === "number") return { count: input, budget: Number.POSITIVE_INFINITY }
  return input
}

function messageWeight(message: MessageBundle) {
  return 600 + message.parts.reduce((total, part) => total + partWeight(part), 0)
}

function partWeight(part: MessageBundle["parts"][number]) {
  if (part.type === "text" || part.type === "reasoning") return textWeight(part.text, 10_000)
  if (part.type === "tool") return 800 + valueWeight(part.state, 12_000)
  if (part.type === "file" || part.type === "patch") return 1_800
  return 400
}

function textWeight(value: string, cap: number) {
  return Math.min(cap, value.length)
}

function valueWeight(value: unknown, cap: number): number {
  if (typeof value === "string") return textWeight(value, cap)
  if (typeof value === "number" || typeof value === "boolean") return 24
  if (Array.isArray(value)) {
    return Math.min(cap, value.reduce<number>((total, item) => total + valueWeight(item, Math.max(400, cap - total)), 0))
  }
  if (typeof value === "object" && value !== null) {
    return Math.min(cap, Object.values(value as Record<string, unknown>).reduce<number>((total, item) => total + valueWeight(item, Math.max(400, cap - total)), 0))
  }
  return 8
}

export function messageCursorBefore(message: MessageBundle) {
  const time = message.info.time.created
  if (typeof time !== "number") return undefined
  return btoa(JSON.stringify({ id: message.info.id, time })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

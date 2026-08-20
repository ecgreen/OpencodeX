/**
 * Display normalization for stored message text, shared by the TUI and the GUI.
 *
 * Providers persist assistant text in whatever envelope they emitted it in:
 * harmony channel objects, OpenAI `output`/`choices` responses, or a plain
 * JSON-encoded string. This module turns any of those into the prose a person
 * should see. It used to live only in the GUI,
 * which is why the same stored message rendered as clean prose there and as raw
 * JSON in the TUI.
 *
 * Deliberate tradeoff: a text or reasoning part that is still streaming is
 * returned untouched, in *both* clients, until the part completes. Normalizing
 * mid-stream cannot pay off - a truncated envelope does not parse, so the
 * result would be the raw text anyway - while the cost is real: streaming
 * replaces the part object on every flush, so an identity cache misses every
 * time and the full-text regex plus the throwing `JSON.parse` probe re-run over
 * the whole accumulated text, which is quadratic in the length of a streamed
 * message. Parts that never carry timing at all (user prompts, synthetic parts)
 * are already final and are normalized immediately.
 */
import type { Part } from "./client.js"
import type { ClientStateSyncState } from "./client-sync-types.js"
import { isStreamingClientPart, selectClientSessionMessages } from "./client-sync-state.js"

const VISIBLE_CHANNELS = new Set(["commentary", "final"])
const HIDDEN_CHANNELS = new Set(["analysis"])

type JsonRecord = Record<string, unknown>

const normalizedDisplayParts = new WeakMap<Part, Part>()

export function displayClientMessageText(text: string) {
  const parsed = parseCompleteJson(text.trim())
  if (parsed === undefined) return text

  const extracted = extractVisibleText(parsed)
  return extracted?.trim() ? extracted : text
}

/**
 * Returns the display-ready form of a part. Non-text parts and parts that are
 * still streaming are returned by identity, so callers can keep using reference
 * equality to detect real changes.
 */
export function normalizeClientDisplayPart(part: Part): Part {
  if (part.type !== "text" && part.type !== "reasoning") return part
  const cached = normalizedDisplayParts.get(part)
  if (cached) return cached
  if (part.type === "text" && part.synthetic === undefined && part.metadata?.compaction_continue === true) {
    const normalized = { ...part, synthetic: true }
    normalizedDisplayParts.set(part, normalized)
    return normalized
  }
  if (isStreamingClientDisplayPart(part)) return part
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- narrowed to the two text-bearing part variants
  const normalized = { ...part, text: displayClientMessageText(part.text) } as Part
  normalizedDisplayParts.set(part, normalized)
  return normalized
}

/** True while a part is mid-stream: it has started but has not been closed out. */
export function isStreamingClientDisplayPart(part: Part) {
  return isStreamingClientPart(part)
}

/** `selectClientSessionMessages` with every part run through display normalization. */
export function selectClientSessionDisplayMessages(state: ClientStateSyncState, sessionID: string) {
  return selectClientSessionMessages(state, sessionID).map((message) => ({
    ...message,
    parts: message.parts.map(normalizeClientDisplayPart),
  }))
}

function parseCompleteJson(text: string): unknown | undefined {
  if (!text) return
  if (!text.startsWith("{") && !text.startsWith("[") && !text.startsWith('"')) return
  try {
    return JSON.parse(text)
  } catch {
    return
  }
}

function extractVisibleText(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return joinText(value.map(extractVisibleText))
  if (!isRecord(value)) return

  return (
    extractChannelContent(value) ??
    extractVisibleFields(value) ??
    extractEnvelopeContent(value) ??
    extractMessageContent(value) ??
    extractTypedContent(value) ??
    extractRoleContent(value)
  )
}

function extractChannelContent(value: JsonRecord) {
  const channel = typeof value.channel === "string" ? value.channel : undefined
  if (!channel) return
  if (HIDDEN_CHANNELS.has(channel)) return
  if (VISIBLE_CHANNELS.has(channel)) return extractVisibleText(value.content)
}

function extractVisibleFields(value: JsonRecord) {
  return joinText([
    extractVisibleText(value.commentary),
    extractVisibleText(value.final),
    extractVisibleText(value.final_answer),
  ])
}

function extractEnvelopeContent(value: JsonRecord) {
  if (Array.isArray(value.output)) return extractOpenAIOutput(value.output)
  if (Array.isArray(value.choices)) return extractChoices(value.choices)
}

function extractMessageContent(value: JsonRecord) {
  if (isRecord(value.message)) {
    const role = typeof value.message.role === "string" ? value.message.role : undefined
    if (!role || role === "assistant") return extractVisibleText(value.message)
  }
}

function extractTypedContent(value: JsonRecord) {
  const type = typeof value.type === "string" ? value.type : undefined
  if ((type === "text" || type === "output_text") && typeof value.text === "string") return value.text
  if ((type === "message" || type === "assistant") && value.content !== undefined)
    return extractVisibleText(value.content)
}

function extractRoleContent(value: JsonRecord) {
  if (typeof value.role === "string" && value.content !== undefined) return extractVisibleText(value.content)
}

function extractOpenAIOutput(output: unknown[]) {
  return joinText(
    output.map((item) => {
      if (!isRecord(item)) return extractVisibleText(item)
      if (Array.isArray(item.content)) return extractVisibleText(item.content)
      return extractVisibleText(item)
    }),
  )
}

function extractChoices(choices: unknown[]) {
  return joinText(
    choices.map((choice) => {
      if (!isRecord(choice)) return extractVisibleText(choice)
      return extractVisibleText(choice.message) ?? extractVisibleText(choice.delta)
    }),
  )
}

function joinText(values: Array<string | undefined>) {
  const visible = values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))
  if (visible.length === 0) return
  return visible.join("\n\n")
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

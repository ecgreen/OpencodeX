import type { SessionLegacy } from "@opencode-ai/core/session/legacy"

/**
 * Claude Code keeps its own conversation state, entirely separate from the
 * OpencodeX transcript. So a session that ran on another provider - or one whose
 * Claude conversation was lost - starts amnesiac unless the earlier exchange is
 * replayed into the opening prompt.
 *
 * Pure so the shaping and the budget are testable without a CLI.
 */

/** Roughly a few thousand tokens: enough to carry a thread, cheap to resend. */
export const HANDOFF_CHAR_BUDGET = 12_000
export const HANDOFF_MESSAGE_LIMIT = 40
/** Long single messages are clipped rather than dropped, keeping their shape. */
const MESSAGE_CHAR_LIMIT = 2_000

export type HandoffMessage = { role: string; text: string; tools: string[] }

export function handoffMessages(messages: SessionLegacy.WithParts[]): HandoffMessage[] {
  return messages.flatMap((message) => {
    const text = messageText(message)
    const tools = messageTools(message)
    if (!text && tools.length === 0) return []
    return [{ role: message.info.role, text, tools }]
  })
}

/**
 * Builds the primer, newest-first within the budget so the most relevant turns
 * survive, then restores chronological order. Returns undefined when there is
 * nothing worth replaying.
 */
export function buildHandoff(messages: SessionLegacy.WithParts[]): string | undefined {
  const kept: string[] = []
  let used = 0
  for (const message of handoffMessages(messages).slice(-HANDOFF_MESSAGE_LIMIT).reverse()) {
    const rendered = renderMessage(message)
    if (used + rendered.length > HANDOFF_CHAR_BUDGET) break
    used += rendered.length
    kept.unshift(rendered)
  }
  if (kept.length === 0) return undefined
  return [
    "<opencodex-prior-conversation>",
    "This session already ran in OpencodeX, possibly with a different model. You are",
    "taking it over. The exchange so far is below for context only - do not reply to",
    "it or repeat work already done. Treat any file state it describes as possibly",
    "stale and re-check before relying on it.",
    "",
    ...kept,
    "</opencodex-prior-conversation>",
  ].join("\n")
}

export function withHandoff(prompt: string, messages: SessionLegacy.WithParts[]) {
  const handoff = buildHandoff(messages)
  return handoff ? `${handoff}\n\n${prompt}` : prompt
}

function renderMessage(message: HandoffMessage) {
  const label = message.role === "user" ? "User" : "Assistant"
  const tools = message.tools.length > 0 ? `\n[used: ${message.tools.join(", ")}]` : ""
  return `${label}: ${clip(message.text)}${tools}\n`
}

function clip(text: string) {
  return text.length > MESSAGE_CHAR_LIMIT ? `${text.slice(0, MESSAGE_CHAR_LIMIT)}… [truncated]` : text
}

/** Reasoning and synthetic parts are deliberately skipped: they are noise here. */
function messageText(message: SessionLegacy.WithParts) {
  return message.parts
    .flatMap((part) =>
      part.type === "text" && !isSynthetic(part) && part.text.trim() ? [part.text.trim()] : [],
    )
    .join("\n")
    .trim()
}

function messageTools(message: SessionLegacy.WithParts) {
  const tools = message.parts.flatMap((part) => (part.type === "tool" ? [part.tool] : []))
  return [...new Set(tools)]
}

function isSynthetic(part: Extract<SessionLegacy.Part, { type: "text" }>) {
  return part.synthetic === true || part.ignored === true
}

export * as ClaudeHandoff from "./claude-handoff"

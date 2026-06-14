import type { Command } from "@opencode-ai/sdk/v2/client"
import type { PromptPart } from "./store"

const MAX_DRAFT_CHARS = 50_000
const MAX_DRAFT_ENTRIES = 200
const MAX_STASH_ENTRIES = 50

export type GuiPromptInfo = {
  input: string
  parts: PromptPart[]
  mode?: "normal" | "shell"
}

export type GuiPromptStashEntry = {
  input: string
  parts: PromptPart[]
  timestamp: number
}

export type ServerCommandMatch = {
  command: Command
  arguments: string
}

export const PROMPT_DRAFT_MAX_CHARS = MAX_DRAFT_CHARS
export const PROMPT_DRAFT_MAX_ENTRIES = MAX_DRAFT_ENTRIES
export const PROMPT_STASH_MAX_ENTRIES = MAX_STASH_ENTRIES

export function emptyPrompt(): GuiPromptInfo {
  return { input: "", parts: [] }
}

export function textPrompt(input: string): GuiPromptInfo {
  return { input, parts: input ? [{ type: "text", text: input }] : [] }
}

export function normalizePromptInfo(value: unknown): GuiPromptInfo | undefined {
  if (!value || typeof value !== "object") return
  const input = value as GuiPromptInfo
  if (typeof input.input !== "string" || input.input.length > MAX_DRAFT_CHARS) return
  if (!Array.isArray(input.parts) || !input.parts.every(isPromptPart)) return
  return {
    input: input.input,
    parts: input.parts,
    ...(input.mode === "normal" || input.mode === "shell" ? { mode: input.mode } : {}),
  }
}

export function parsePromptDrafts(text: string): Record<string, GuiPromptInfo> {
  const parsed = safeJson(text)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .flatMap(([key, value]) => {
        const draft = normalizePromptInfo(value)
        return draft ? [[key, draft] as const] : []
      })
      .slice(-MAX_DRAFT_ENTRIES),
  )
}

export function mergePromptDraft(drafts: Record<string, GuiPromptInfo>, key: string, draft: GuiPromptInfo) {
  if (draft.input.length > MAX_DRAFT_CHARS) return drafts
  const next = { ...drafts, [key]: clonePrompt(draft) }
  const keys = Object.keys(next)
  if (keys.length <= MAX_DRAFT_ENTRIES) return next
  return Object.fromEntries(keys.slice(keys.length - MAX_DRAFT_ENTRIES).map((item) => [item, next[item]]))
}

export function parsePromptStash(text: string): GuiPromptStashEntry[] {
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const parsed = safeJson(line)
      if (!parsed || typeof parsed !== "object") return []
      const input = parsed as GuiPromptStashEntry
      if (typeof input.input !== "string" || input.input.length > MAX_DRAFT_CHARS) return []
      if (!Array.isArray(input.parts) || !input.parts.every(isPromptPart)) return []
      if (typeof input.timestamp !== "number") return []
      return [{ input: input.input, parts: input.parts, timestamp: input.timestamp }]
    })
    .slice(-MAX_STASH_ENTRIES)
}

export function pushPromptStash(entries: GuiPromptStashEntry[], prompt: GuiPromptInfo, now = Date.now()) {
  if (!prompt.input.trim() && prompt.parts.length === 0) return entries
  return [...entries, { input: prompt.input, parts: structuredClone(prompt.parts), timestamp: now }].slice(-MAX_STASH_ENTRIES)
}

export function nextPromptHistoryState(input: {
  history: string[]
  offset: number
  historyIndex: number
  historyDraft: string
  draftPrompt: string
}) {
  if (input.history.length === 0) return
  if (input.historyIndex === -1 && input.offset > 0) {
    if (input.draftPrompt !== input.history.at(-1)) return
    return { historyIndex: -1, historyDraft: "", draftPrompt: "" }
  }
  const historyDraft = input.historyIndex === -1 ? input.draftPrompt : input.historyDraft
  const next = input.offset > 0 && input.historyIndex === input.history.length - 1
    ? -1
    : Math.max(0, Math.min(input.history.length - 1, (input.historyIndex === -1 ? input.history.length : input.historyIndex) + input.offset))
  return {
    historyIndex: next,
    historyDraft: next === -1 ? "" : historyDraft,
    draftPrompt: next === -1 ? historyDraft : input.history[next] ?? "",
  }
}

export function serverCommandMatch(input: string, commands: Command[]): ServerCommandMatch | undefined {
  const firstLine = input.trimStart().split(/\r?\n/, 1)[0] ?? ""
  if (!firstLine.startsWith("/")) return
  const [raw, ...args] = firstLine.split(" ")
  const name = raw.slice(1)
  if (!name) return
  const command = commands.find((item) => item.name === name && item.source !== "skill")
  if (!command) return
  const rest = input.trimStart().slice(raw.length).replace(/^\s/, "")
  return { command, arguments: rest || args.join(" ") }
}

export function promptPartsForSubmit(prompt: GuiPromptInfo): PromptPart[] {
  if (prompt.parts.length === 0) return [{ type: "text", text: prompt.input }]
  const hasText = prompt.parts.some((part) => part.type === "text")
  if (hasText || !prompt.input) return prompt.parts
  return [{ type: "text", text: prompt.input }, ...prompt.parts]
}

function clonePrompt(value: GuiPromptInfo): GuiPromptInfo {
  return {
    input: value.input,
    parts: structuredClone(value.parts),
    ...(value.mode ? { mode: value.mode } : {}),
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return
  }
}

function isPromptPart(value: unknown): value is PromptPart {
  if (!value || typeof value !== "object" || !("type" in value)) return false
  const type = (value as { type: unknown }).type
  if (type === "text") return typeof (value as { text?: unknown }).text === "string"
  if (type === "file") return typeof (value as { mime?: unknown; url?: unknown }).mime === "string" && typeof (value as { url?: unknown }).url === "string"
  return type === "agent" && typeof (value as { name?: unknown }).name === "string"
}

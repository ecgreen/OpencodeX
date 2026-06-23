import type { AssistantMessage } from "@opencode-ai/sdk/v2/client"
import {
  mergePromptDraft,
  parsePromptDrafts,
  parsePromptStash,
  type GuiPromptInfo,
  type GuiPromptStashEntry,
} from "./prompt-state"
import type { MessageBundle, PromptPart } from "./store"

export function readFavoriteModels() {
  if (typeof localStorage === "undefined") return []
  try {
    const parsed = JSON.parse(localStorage.getItem("opencodex.gui.favoriteModels") ?? "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === "string").slice(0, 20)
  } catch {
    return []
  }
}

export function writeFavoriteModels(values: string[]) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem("opencodex.gui.favoriteModels", JSON.stringify(values.slice(0, 20)))
}

export function readComposerStash() {
  if (typeof localStorage === "undefined") return []
  return parsePromptStash(localStorage.getItem("opencodex.gui.promptStash") ?? "")
}

export function writeComposerStash(entries: GuiPromptStashEntry[]) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem("opencodex.gui.promptStash", entries.map((entry) => JSON.stringify(entry)).join("\n"))
}

export function readComposerDraft(sessionID?: string) {
  if (!sessionID || typeof localStorage === "undefined") return
  return parsePromptDrafts(localStorage.getItem("opencodex.gui.promptDrafts") ?? "{}")[sessionID]
}

export function writeComposerDraft(sessionID: string, draft: GuiPromptInfo) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(
    "opencodex.gui.promptDrafts",
    JSON.stringify(mergePromptDraft(parsePromptDrafts(localStorage.getItem("opencodex.gui.promptDrafts") ?? "{}"), sessionID, draft)),
  )
}

export function clearComposerDraft(sessionID?: string) {
  if (!sessionID || typeof localStorage === "undefined") return
  const drafts = parsePromptDrafts(localStorage.getItem("opencodex.gui.promptDrafts") ?? "{}")
  const next = Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== sessionID))
  localStorage.setItem("opencodex.gui.promptDrafts", JSON.stringify(next))
}

export async function filePartFromFile(file: File): Promise<PromptPart> {
  return {
    type: "file",
    filename: file.name || undefined,
    mime: file.type || "application/octet-stream",
    url: await fileToDataURL(file),
  }
}

export function textPart(part: MessageBundle["parts"][number]) {
  return part.type === "text" ? part.text : ""
}

export function isAssistantMessage(message: MessageBundle["info"]): message is AssistantMessage {
  return message.role === "assistant"
}

export function formatTokenCount(tokens: number) {
  if (tokens >= 1_000_000) return `${trimCompactNumber(tokens / 1_000_000)}m`
  if (tokens >= 1_000) return `${trimCompactNumber(tokens / 1_000)}k`
  return tokens.toLocaleString()
}

function fileToDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => resolve(typeof reader.result === "string" ? reader.result : ""))
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Failed to read file.")))
    reader.readAsDataURL(file)
  })
}

function trimCompactNumber(value: number) {
  return value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, "")
}

import type { AssistantMessage } from "@opencode-ai/sdk/v2/client"
import {
  mergePromptDraft,
  parsePromptDrafts,
  parsePromptStash,
  type GuiPromptInfo,
  type GuiPromptStashEntry,
} from "./prompt-state"
import type { MessageBundle, PromptPart } from "./store"

const COMPOSER_STASH_EVENT = "opencodex:composer-stash"

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
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<GuiPromptStashEntry[]>(COMPOSER_STASH_EVENT, { detail: entries }))
}

export function subscribeComposerStash(listener: (entries: GuiPromptStashEntry[]) => void) {
  if (typeof window === "undefined") return () => undefined
  const update = (event: Event) => listener(event instanceof CustomEvent && Array.isArray(event.detail) ? event.detail : readComposerStash())
  window.addEventListener(COMPOSER_STASH_EVENT, update)
  return () => window.removeEventListener(COMPOSER_STASH_EVENT, update)
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

export function filePartFromPath(input: { path: string; type?: "file" | "directory"; label?: string }): PromptPart {
  const label = input.label ?? fileBasename(input.path)
  return {
    type: "file",
    filename: label,
    mime: input.type === "directory" ? "application/x-directory" : imageMime(input.path) ?? "text/plain",
    url: fileURL(input.path),
    source: {
      type: "file",
      path: input.path,
      text: { value: label, start: 0, end: label.length },
    },
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

function imageMime(value: string) {
  const extension = value.split(/[/.\\]/).at(-1)?.toLowerCase()
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg"
  if (extension === "png") return "image/png"
  if (extension === "gif") return "image/gif"
  if (extension === "webp") return "image/webp"
  if (extension === "svg") return "image/svg+xml"
  if (extension === "bmp") return "image/bmp"
  if (extension === "avif") return "image/avif"
}

function fileBasename(value: string) {
  return value.replace(/[/\\]+$/, "").split(/[/\\]/).filter(Boolean).at(-1) ?? value
}

function trimCompactNumber(value: number) {
  return value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, "")
}

function fileURL(value: string) {
  const normalized = value.replaceAll("\\", "/")
  if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${encodeURI(normalized)}`
  if (normalized.startsWith("/")) return `file://${encodeURI(normalized)}`
  return `file://${encodeURI(normalized)}`
}

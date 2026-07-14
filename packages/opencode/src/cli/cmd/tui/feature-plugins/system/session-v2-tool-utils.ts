import path from "path"
import type { SessionMessageAssistantTool, ToolFileContent, ToolTextContent } from "@opencode-ai/sdk/v2"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"

export type ToolProps = {
  input: Record<string, unknown>
  metadata: Record<string, unknown>
  output?: string
  sessionID: string
  part: SessionMessageAssistantTool
}

export function toolOutput(content?: Array<ToolTextContent | ToolFileContent>) {
  return (content ?? [])
    .map((item) => {
      if (item.type === "text") return item.text.trim()
      return `[file ${item.name ?? item.uri}]`
    })
    .filter(Boolean)
    .join("\n")
}

export function toolInputRecord(input: string | Record<string, unknown>) {
  if (typeof input === "string") return {}
  return input
}

export function pendingInput(part: SessionMessageAssistantTool) {
  if (part.state.status !== "pending") return ""
  return part.state.input.trim()
}

export function toolComplete(part: SessionMessageAssistantTool) {
  if (part.state.status === "pending") return pendingInput(part)
  return part.state.status === "completed" || part.state.status === "error" || part.state.status === "running"
}

export function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function input(input: Record<string, unknown>, omit?: string[]) {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

export function normalizePath(input?: string) {
  if (!input) return ""
  const absolute = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input)
  const relative = path.relative(process.cwd(), absolute)
  if (!relative) return "."
  if (!relative.startsWith("..")) return relative
  return absolute
}

export function filetype(input?: string) {
  if (!input) return "none"
  const language = LANGUAGE_EXTENSIONS[path.extname(input)]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

export function todoIcon(status?: string) {
  if (status === "completed") return "âœ“"
  if (status === "in_progress") return "~"
  if (status === "cancelled") return "âœ•"
  return "â˜"
}

export function formatAnswer(answer: unknown) {
  if (!Array.isArray(answer)) return "(no answer)"
  if (answer.length === 0) return "(no answer)"
  return answer.filter((item): item is string => typeof item === "string").join(", ")
}

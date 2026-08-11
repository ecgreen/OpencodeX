import type { Part, PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { TOOL_OUTPUT_PREVIEW_LIMITS, previewToolOutput } from "@opencode-ai/ui/tool-output-preview"
import type { MessageBundle } from "./session-api"
import { arrayValue, collapseWhitespace, isRecordValue, numberValue, stringValue } from "./tool-values"

export { arrayValue, collapseWhitespace, fileBasename, formatElapsed, formatToolValue, isRecordValue, numberValue, pluralize, stringValue } from "./tool-values"
export { humanizeToolTitle, permissionTitle, toolDisplayTitle } from "./tool-title"

/** One label for every "there is more than we rendered" affordance. */
export const COPY_FULL_LABEL = "Copy full output"

export const NESTED_TRANSCRIPT_DIFF_OPTIONS = {
  preserveScroll: false,
  virtualize: false,
} as const

const DIFF_VIRTUALIZATION_LIMITS = {
  maxLines: 500,
  maxBytes: 64 * 1024,
}

const COMMON_TOOL_IDS = new Set([
  "apply_patch",
  "bash",
  "edit",
  "glob",
  "grep",
  "question",
  "read",
  "shell",
  "skill",
  "task",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
  "workspace_open",
  "browser_navigate",
  "browser_screenshot",
  "browser_snapshot",
  "toolsearch",
  "taskcreate",
  "taskupdate",
  "tasklist",
  "taskget",
  "agent",
  "monitor",
  "schedulewakeup",
  "plan_exit",
])

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  cjs: "js",
  mjs: "js",
  jsx: "jsx",
  tsx: "tsx",
  ts: "ts",
  jsonc: "jsonc",
  md: "markdown",
  markdown: "markdown",
  ps1: "powershell",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  cs: "csharp",
  cpp: "cpp",
  hpp: "cpp",
  c: "c",
  h: "c",
}

export type ToolCategory = "search" | "web" | "exec" | "file" | "plan" | "agent" | "generic"

/**
 * Drives the accent colour and icon a part gets. Categories are about what the
 * tool *did*, not which package it came from, so unknown tools stay generic.
 */
export function toolCategory(tool: string): ToolCategory {
  if (tool === "read" || tool === "grep" || tool === "glob" || tool === "list") return "search"
  if (tool === "webfetch" || tool === "websearch" || tool.startsWith("browser_")) return "web"
  if (tool === "bash" || tool === "shell") return "exec"
  if (tool === "edit" || tool === "write" || tool === "apply_patch") return "file"
  if (tool === "todowrite" || tool === "question" || tool === "plan_exit") return "plan"
  if (tool === "task" || tool === "skill" || tool === "opencodex_swarm_create") return "agent"
  return "generic"
}

/**
 * Deliverables and attention states get card chrome; routine evidence stays a
 * quiet row so a turn with thirty greps is still scannable.
 */
export function toolTier(tool: string, status: string): "card" | "row" {
  if (status === "error") return "card"
  const category = toolCategory(tool)
  return category === "file" || category === "plan" ? "card" : "row"
}

export function toolStateTitle(state: Extract<Part, { type: "tool" }>["state"]) {
  return "title" in state ? stringValue(state.title) : undefined
}

/** One-line failure text for collapsed rows and grouped items. */
export function toolErrorSummary(state: Extract<Part, { type: "tool" }>["state"], max = 120) {
  const message = toolError(state)
  return message ? collapseWhitespace(message, max) : ""
}

export function toolStateInput(state: Extract<Part, { type: "tool" }>["state"]) {
  if ("input" in state && isRecordValue(state.input)) return state.input
  return {}
}

export function toolVisibleOutput(tool: string, state: Extract<Part, { type: "tool" }>["state"], metadata: Record<string, unknown>) {
  const output = toolOutput(state)
  if (output) return tool === "bash" || tool === "shell" ? stripAnsiBasic(output) : output
  if ((tool === "bash" || tool === "shell") && typeof metadata.output === "string") return stripAnsiBasic(metadata.output)
  return ""
}

function toolHasRichDetails(tool: string, metadata: Record<string, unknown>, input: Record<string, unknown>) {
  return Boolean(
    stringValue(metadata.diff) ||
    arrayValue(metadata.files).length ||
    arrayValue(metadata.todos).length ||
    arrayValue(input.todos).length ||
    arrayValue(input.questions).length ||
    stringValue(input.plan) ||
    stringValue(input.content),
  )
}

export function toolHasVisibleDetails(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown>, output: string, error?: string) {
  if (error) return true
  // Read is noisy when it echoes whole files, but the server ships a short
  // preview - show that rather than an expander that opens onto nothing.
  if (tool === "read") return Boolean(stringValue(metadata.preview)?.trim())
  if (output.trim()) return true
  if (toolHasRichDetails(tool, metadata, input)) return true
  if (arrayValue(metadata.diagnostics).length > 0) return true
  return shouldShowRawToolData(tool, input, metadata)
}

export function shouldShowRawToolData(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown>) {
  if (COMMON_TOOL_IDS.has(tool)) return false
  return Object.keys(input).length > 0 || Object.keys(metadata).length > 0
}

export function field(label: string, value: unknown) {
  return { label, value }
}

export function toolPatchTitle(type: string | undefined, name: string, file: Record<string, unknown>) {
  if (type === "delete") return `Deleted ${name}`
  if (type === "add") return `Created ${name}`
  if (type === "move") return `Moved ${stringValue(file.filePath) ?? name} -> ${name}`
  return `Patched ${name}`
}

export function formatTodoStatus(status: string | undefined) {
  if (status === "completed") return "Completed"
  if (status === "in_progress") return "In progress"
  if (status === "cancelled") return "Cancelled"
  return "Pending"
}

export function languageFromPath(path: string | undefined) {
  if (!path) return "text"
  const extension = path.split(/[\\/.]/).at(-1)?.toLowerCase()
  if (!extension || extension === path.toLowerCase()) return "text"
  return LANGUAGE_BY_EXTENSION[extension] ?? extension
}

export function collapseDiffOutput(output: string) {
  const lines = output.split("\n")
  if (!isDiffOutput(output) || lines.length <= 15) return { output, overflow: false }
  return { output: lines.slice(0, 10).join("\n"), overflow: true }
}

export function collapseLineOutput(output: string, maxLines: number) {
  const lines = output.split("\n")
  if (lines.length <= maxLines) return { output, overflow: false }
  return { output: lines.slice(0, maxLines).join("\n"), overflow: true }
}

export function patchContents(patch: string, filePath: string) {
  const before: string[] = []
  const after: string[] = []
  let inHunk = false

  for (const line of patch.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith("\\ No newline")) continue

    const first = line[0]
    const text = first === "+" || first === "-" || first === " " ? line.slice(1) : line
    if (first === "+") {
      after.push(text)
      continue
    }
    if (first === "-") {
      before.push(text)
      continue
    }
    before.push(text)
    after.push(text)
  }

  if (!inHunk) return undefined
  return {
    before: { name: filePath, contents: before.join("\n") },
    after: { name: filePath, contents: after.join("\n") },
  }
}

export function toolOutput(state: Extract<Part, { type: "tool" }>["state"]) {
  if (state.status === "completed") return state.output
  return undefined
}

export function toolError(state: Extract<Part, { type: "tool" }>["state"]) {
  if (state.status === "error") return state.error
  return undefined
}

export function toolMetadata(state: Extract<Part, { type: "tool" }>["state"]) {
  if ("metadata" in state && isRecordValue(state.metadata)) return state.metadata
  return undefined
}

export function permissionToolPart(request: PermissionRequest, messages: MessageBundle[]) {
  if (!request.tool) return undefined
  return messages
    .flatMap((message) => message.parts)
    .find((part): part is Extract<Part, { type: "tool" }> => part.type === "tool" && part.callID === request.tool?.callID && part.messageID === request.tool.messageID)
}

export function toolInput(request: PermissionRequest, part?: Extract<Part, { type: "tool" }>) {
  if (part && "input" in part.state && isRecordValue(part.state.input)) return part.state.input
  return request.metadata
}

export function permissionDiff(request: PermissionRequest) {
  if (typeof request.metadata.diff === "string") return request.metadata.diff
  return undefined
}

export function collapseOutput(output: string, maxLines = 120, maxChars = 12_000) {
  const bounded = previewToolOutput(output)
  const lines = bounded.text.split("\n")
  if (!bounded.truncated && lines.length <= maxLines && Array.from(bounded.text).length <= maxChars) return { output, overflow: false }
  const preview = lines.slice(0, maxLines).join("\n")
  const collapsed = Array.from(preview).length > maxChars
    ? `${Array.from(preview).slice(0, Math.max(0, maxChars - 3)).join("")}...`
    : bounded.truncated && lines.length <= maxLines
      ? preview
      : [...lines.slice(0, maxLines), "..."].join("\n")
  return { output: previewToolOutput(collapsed, TOOL_OUTPUT_PREVIEW_LIMITS.collapsed).text, overflow: true }
}

export function shouldVirtualizeDiff(diff: string) {
  return previewToolOutput(diff, DIFF_VIRTUALIZATION_LIMITS).truncated
}

export function copyFullToolText(text: string, writeText: (value: string) => void | Promise<void> = (value) => navigator.clipboard.writeText(value)) {
  return writeText(text)
}

function isDiffOutput(output: string) {
  const text = output.trimStart()
  return text.startsWith("diff --git ") || /^@@\s/m.test(text) || /^---\s.+\n\+\+\+\s/m.test(text)
}

function stripAnsiBasic(text: string) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
}

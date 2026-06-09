import type { Part, PermissionRequest } from "@opencode-ai/sdk/v2/client"
import type { MessageBundle } from "./store"

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

type ToolTitleBuilder = (input: Record<string, unknown>, metadata: Record<string, unknown>) => string
type PermissionTitleBuilder = (request: PermissionRequest, input: Record<string, unknown>) => string | undefined

const TOOL_TITLE_BY_ID: Record<string, ToolTitleBuilder | undefined> = {
  bash: shellTitle,
  shell: shellTitle,
  grep: (input, metadata) => `Grep ${quoteValue(input.pattern)}${inPath(input.path)}${countSuffix(metadata.matches, "match")}`,
  glob: (input, metadata) => `Glob ${quoteValue(input.pattern)}${inPath(input.path)}${countSuffix(metadata.count, "match")}`,
  read: (input) => fileToolTitle("Read", input),
  write: (input) => fileToolTitle("Write", input),
  edit: (input) => fileToolTitle("Edit", input),
  apply_patch: () => "Patch",
  todowrite: () => "Update todos",
  question: (input) => `Ask ${arrayValue(input.questions).length || ""} question${arrayValue(input.questions).length === 1 ? "" : "s"}`.trim(),
  task: (input) => `${stringValue(input.subagent_type) ?? "General"} task: ${stringValue(input.description) ?? "subagent"}`,
  webfetch: (input) => `WebFetch ${stringValue(input.url) ?? ""}`.trim(),
  websearch: (input) => `WebSearch ${quoteValue(input.query)}`,
  skill: (input) => `Skill ${stringValue(input.name) ?? ""}`.trim(),
}

const PERMISSION_TITLE_BY_ID: Record<string, PermissionTitleBuilder | undefined> = {
  edit: (request) => typeof request.metadata.filepath === "string" ? `Edit ${request.metadata.filepath}` : undefined,
  read: (_request, input) => stringFieldTitle("Read", input.filePath),
  glob: (_request, input) => stringFieldTitle("Glob", input.pattern),
  grep: (_request, input) => stringFieldTitle("Grep", input.pattern),
  list: (_request, input) => stringFieldTitle("List", input.path),
  bash: (_request, input) => stringValue(input.command),
  task: (_request, input) => stringFieldTitle("Task:", input.description),
  webfetch: (_request, input) => stringFieldTitle("WebFetch", input.url),
  websearch: (_request, input) => stringFieldTitle("WebSearch", input.query),
  external_directory: () => "Access external directory",
  doom_loop: () => "Continue after repeated failures",
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

export function toolDisplayTitle(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown>) {
  return TOOL_TITLE_BY_ID[tool]?.(input, metadata) ?? tool
}

function toolHasRichDetails(tool: string, metadata: Record<string, unknown>, input: Record<string, unknown>) {
  return Boolean(
    stringValue(metadata.diff) ||
    arrayValue(metadata.files).length ||
    arrayValue(metadata.todos).length ||
    arrayValue(input.todos).length ||
    arrayValue(input.questions).length ||
    stringValue(input.content),
  )
}

export function toolHasVisibleDetails(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown>, output: string, error?: string) {
  if (error) return true
  if (tool === "read") return false
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

export function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function formatToolValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map(formatToolValue).join(", ")
  if (value === null || value === undefined) return ""
  return JSON.stringify(value)
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

export function todoStatusIcon(status: string | undefined) {
  if (status === "completed") return "check"
  if (status === "in_progress") return "play"
  if (status === "cancelled") return "x"
  return
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

  if (!inHunk) return
  return {
    before: { name: filePath, contents: before.join("\n") },
    after: { name: filePath, contents: after.join("\n") },
  }
}

export function toolOutput(state: Extract<Part, { type: "tool" }>["state"]) {
  if (state.status === "completed") return state.output
}

export function toolError(state: Extract<Part, { type: "tool" }>["state"]) {
  if (state.status === "error") return state.error
}

export function toolMetadata(state: Extract<Part, { type: "tool" }>["state"]) {
  if ("metadata" in state && isRecordValue(state.metadata)) return state.metadata
}

export function permissionToolPart(request: PermissionRequest, messages: MessageBundle[]) {
  if (!request.tool) return
  return messages
    .flatMap((message) => message.parts)
    .find((part): part is Extract<Part, { type: "tool" }> => part.type === "tool" && part.callID === request.tool?.callID && part.messageID === request.tool.messageID)
}

export function toolInput(request: PermissionRequest, part?: Extract<Part, { type: "tool" }>) {
  if (part && "input" in part.state && isRecordValue(part.state.input)) return part.state.input
  return request.metadata
}

export function permissionTitle(request: PermissionRequest, input: Record<string, unknown>) {
  return PERMISSION_TITLE_BY_ID[request.permission]?.(request, input) ?? request.permission
}

export function permissionDiff(request: PermissionRequest) {
  if (typeof request.metadata.diff === "string") return request.metadata.diff
}

export function collapseOutput(output: string, maxLines = 120, maxChars = 12_000) {
  const lines = output.split("\n")
  if (lines.length <= maxLines && Array.from(output).length <= maxChars) return { output, overflow: false }
  const preview = lines.slice(0, maxLines).join("\n")
  if (Array.from(preview).length > maxChars) return { output: `${Array.from(preview).slice(0, Math.max(0, maxChars - 3)).join("")}...`, overflow: true }
  return { output: [...lines.slice(0, maxLines), "..."].join("\n"), overflow: true }
}

function quoteValue(value: unknown) {
  const text = stringValue(value)
  return text ? `"${text}"` : ""
}

function shellTitle(input: Record<string, unknown>) {
  return stringValue(input.description) ?? stringValue(input.command) ?? "Shell"
}

function fileToolTitle(action: string, input: Record<string, unknown>) {
  return `${action} ${stringValue(input.filePath) ?? "file"}`
}

function stringFieldTitle(label: string, value: unknown) {
  const text = stringValue(value)
  return text ? `${label} ${text}` : undefined
}

function inPath(value: unknown) {
  const path = stringValue(value)
  return path ? ` in ${path}` : ""
}

function countSuffix(value: unknown, noun: string) {
  const count = numberValue(value)
  if (!count) return ""
  return ` (${count} ${noun}${count === 1 ? "" : "es"})`
}

function isDiffOutput(output: string) {
  const text = output.trimStart()
  return text.startsWith("diff --git ") || /^@@\s/m.test(text) || /^---\s.+\n\+\+\+\s/m.test(text)
}

function stripAnsiBasic(text: string) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
}

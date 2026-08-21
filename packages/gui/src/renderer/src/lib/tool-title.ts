import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import {
  arrayValue,
  collapseWhitespace,
  fileBasename,
  isRecordValue,
  numberValue,
  pluralize,
  stringValue,
} from "./tool-values"

type ToolTitleBuilder = (input: Record<string, unknown>, metadata: Record<string, unknown>) => string
type PermissionTitleBuilder = (request: PermissionRequest, input: Record<string, unknown>) => string | undefined

/**
 * Titles follow one grammar: verb first, then the object, then an optional count.
 * Keep new entries in that shape so the transcript reads as a list of actions.
 */
const TOOL_TITLE_BY_ID: Record<string, ToolTitleBuilder | undefined> = {
  bash: shellTitle,
  shell: shellTitle,
  grep: (input, metadata) => `Grep ${quoteValue(input.pattern)}${inPath(input.path)}${countSuffix(metadata.matches, "match")}`,
  glob: (input, metadata) => `Glob ${quoteValue(input.pattern)}${inPath(input.path)}${countSuffix(metadata.count, "match")}`,
  read: (input) => fileToolTitle("Read", input),
  write: (input) => fileToolTitle("Write", input),
  edit: (input) => fileToolTitle("Edit", input),
  apply_patch: (_input, metadata) => patchTitle(metadata),
  todowrite: () => "Update todos",
  question: (input) => `Ask ${arrayValue(input.questions).length || ""} ${pluralize("question", arrayValue(input.questions).length)}`.replace(/\s+/g, " ").trim(),
  task: taskTitle,
  webfetch: (input) => stringFieldTitle("Fetch", input.url) ?? "Fetch page",
  websearch: (input) => `Search ${quoteValue(input.query)}`.trim(),
  skill: (input) => stringFieldTitle("Load skill", input.name) ?? "Load skill",
  lsp: (input) => stringFieldTitle("LSP", input.action ?? input.command) ?? "LSP request",
  plan_exit: () => "Proposed plan",
  repo_clone: (input) => stringFieldTitle("Clone", input.url ?? input.repo) ?? "Clone repository",
  repo_overview: () => "Repo overview",
  opencodex_swarm_create: () => "Create swarm",
  invalid: () => "Invalid tool call",
  toolsearch: (input) => `Search tools ${quoteValue(input.query)}`.trim(),
  taskcreate: (input) => stringFieldTitle("Create task —", input.subject) ?? "Create task",
  taskupdate: (input) => {
    const id = stringValue(input.taskId)
    const status = stringValue(input.status)
    if (!id) return "Update task"
    return status ? `Update task #${id} — ${status}` : `Update task #${id}`
  },
  tasklist: () => "List tasks",
  taskget: (input) => (stringValue(input.taskId) ? `Task #${stringValue(input.taskId)}` : "Get task"),
  agent: (input) => `Agent ${stringValue(input.subagent_type) ?? "general"}: ${stringValue(input.description) ?? "subagent"}`,
  monitor: (input) => stringFieldTitle("Monitor", input.action) ?? "Monitor",
  schedulewakeup: (input) => {
    const seconds = numberValue(input.delaySeconds)
    return seconds === undefined ? "Schedule wakeup" : `Schedule wakeup in ${seconds}s`
  },
  workspace_open: (input) => stringFieldTitle("Open workspace", input.path) ?? "Open workspace",
  browser_navigate: (input) => stringFieldTitle("Navigate browser", input.url) ?? "Navigate browser",
  browser_screenshot: (_input, metadata) => stringFieldTitle("Capture browser", metadata.url) ?? "Capture browser",
  browser_snapshot: (_input, metadata) => stringFieldTitle("Snapshot browser", metadata.url) ?? "Snapshot browser",
}

const PERMISSION_TITLE_BY_ID: Record<string, PermissionTitleBuilder | undefined> = {
  edit: (request) => typeof request.metadata.filepath === "string" ? `Edit ${request.metadata.filepath}` : undefined,
  write: (request) => typeof request.metadata.filepath === "string" ? `Write ${request.metadata.filepath}` : undefined,
  read: (_request, input) => stringFieldTitle("Read", input.filePath),
  glob: (_request, input) => stringFieldTitle("Glob", input.pattern),
  grep: (_request, input) => stringFieldTitle("Grep", input.pattern),
  list: (_request, input) => stringFieldTitle("List", input.path),
  bash: (_request, input) => stringValue(input.command),
  task: (_request, input) => stringFieldTitle("Task:", input.description),
  // The heading names only the host - the full URL renders in the card body,
  // where it can wrap instead of truncating the title.
  webfetch: (_request, input) => stringFieldTitle("Fetch", urlHost(input.url)),
  websearch: (_request, input) => stringFieldTitle("Search", input.query),
  external_directory: () => "Access external directory",
  doom_loop: () => "Continue after repeated failures",
  workspace_open: (_request, input) => stringFieldTitle("Open workspace", input.path),
  browser_navigate: (_request, input) => stringFieldTitle("Navigate browser", urlHost(input.url)),
  browser_screenshot: (_request, input) => stringFieldTitle("Capture browser", urlHost(input.url)),
  browser_snapshot: (_request, input) => stringFieldTitle("Snapshot browser", urlHost(input.url)),
}

function urlHost(value: unknown) {
  const url = stringValue(value)
  if (!url) return undefined
  const match = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i)
  return match ? match[1] : url
}

/**
 * Registry title first, then the server-streamed progress title, then a humanized
 * fallback. The middle step is what gives MCP and plugin tools a readable label.
 */
export function toolDisplayTitle(
  tool: string,
  input: Record<string, unknown>,
  metadata: Record<string, unknown>,
  _status?: string,
  stateTitle?: string,
) {
  const registered = TOOL_TITLE_BY_ID[tool]?.(input, metadata)
  if (registered) return registered
  const streamed = stateTitle?.trim()
  if (streamed) return streamed
  return humanizeToolTitle(tool)
}

export function humanizeToolTitle(tool: string) {
  const segments = tool.split(/[_.\s]+/).filter(Boolean)
  if (segments.length === 0) return tool
  const [namespace, ...rest] = segments
  const lead = sentenceCase(namespace)
  if (rest.length === 0) return lead
  return `${lead} · ${rest.join(" ")}`
}

export function permissionTitle(request: PermissionRequest, input: Record<string, unknown>) {
  return PERMISSION_TITLE_BY_ID[request.permission]?.(request, input) ?? humanizeToolTitle(request.permission)
}

function sentenceCase(value: string) {
  if (!value) return value
  if (value.toUpperCase() === value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function patchTitle(metadata: Record<string, unknown>) {
  const files = arrayValue(metadata.files).filter(isRecordValue)
  if (files.length > 1) return `Patch ${files.length} files`
  const single = files[0]
  const name = single && (stringValue(single.relativePath) ?? stringValue(single.filePath) ?? stringValue(single.movePath))
  return name ? `Patch ${fileBasename(name)}` : "Patch"
}

function quoteValue(value: unknown) {
  const text = stringValue(value)
  return text ? `"${text}"` : ""
}

/** The longest a delegated prompt's opening line may run inside a title. */
const TASK_PROMPT_TITLE_LENGTH = 60

/**
 * Native task calls carry `{subagent_type, description}`. The swarm delegation
 * tool normalizes onto `task` too (claude-mapper.ts) but carries `{role,
 * prompt}` - which read as the placeholder "Task general: subagent" until the
 * role and prompt were given their own shape.
 */
function taskTitle(input: Record<string, unknown>) {
  const role = stringValue(input.role)
  if (role && !stringValue(input.description))
    return `Task ${role}: ${firstLine(input.prompt, TASK_PROMPT_TITLE_LENGTH) ?? "delegation"}`
  return `Task ${stringValue(input.subagent_type) ?? "general"}: ${stringValue(input.description) ?? "subagent"}`
}

/** The opening non-empty line of a multi-line value, collapsed to one row. */
function firstLine(value: unknown, max: number) {
  const line = stringValue(value)
    ?.split("\n")
    .find((candidate) => candidate.trim())
  return line ? collapseWhitespace(line, max) : undefined
}

function shellTitle(input: Record<string, unknown>) {
  return stringValue(input.description) ?? stringValue(input.command) ?? "Shell"
}

function fileToolTitle(action: string, input: Record<string, unknown>) {
  // Native tools spell it `filePath`; the Claude bridge may pass through
  // `file_path`/`notebook_path` for parts recorded before input normalization.
  const file = stringValue(input.filePath) ?? stringValue(input.file_path) ?? stringValue(input.notebook_path)
  return `${action} ${file ?? "file"}`
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
  return ` (${count} ${pluralize(noun, count)})`
}

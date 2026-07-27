import type { PermissionRequest, QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { permissionDiff, permissionTitle, stringValue } from "./tool-display"

export type SafetyQueueItem =
  | { kind: "permission"; id: string; request: PermissionRequest }
  | { kind: "question"; id: string; request: QuestionRequest }

export type PermissionSummaryRow = {
  label: string
  value: string
  technical?: boolean
}

export type PermissionPresentation = {
  icon: string
  kind: string
  title: string
  command?: string
  diff?: string
  filePath?: string
  summary: PermissionSummaryRow[]
}

const PERMISSION_ICONS: Record<string, string | undefined> = {
  bash: "terminal",
  browser_navigate: "browser",
  browser_screenshot: "camera",
  browser_snapshot: "browser",
  doom_loop: "refresh",
  edit: "pencil",
  external_directory: "folder-open",
  glob: "search",
  grep: "search",
  list: "folder",
  read: "file",
  task: "activity",
  webfetch: "browser",
  websearch: "search",
  workspace_open: "folder-open",
}

export function buildSafetyQueue(permissions: PermissionRequest[], questions: QuestionRequest[]): SafetyQueueItem[] {
  return [
    ...permissions.map((request) => ({ kind: "permission" as const, id: `permission:${request.id}`, request })),
    ...questions.map((request) => ({ kind: "question" as const, id: `question:${request.id}`, request })),
  ]
}

export function moveSafetyQueueIndex(index: number, total: number, delta: number) {
  if (total <= 1) return 0
  return (index + delta + total) % total
}

export function describePermission(request: PermissionRequest, input: Record<string, unknown>): PermissionPresentation {
  const command = request.permission === "bash" ? stringValue(input.command) : undefined
  const description = stringValue(input.description)
  const title = command
    ? description ?? command.split("\n")[0] ?? "Run shell command"
    : permissionTitle(request, input)

  return {
    icon: PERMISSION_ICONS[request.permission] ?? "lock",
    kind: request.permission.replaceAll("_", " "),
    title: title || `Use ${request.permission.replaceAll("_", " ")}`,
    command,
    diff: permissionDiff(request),
    filePath: stringValue(request.metadata.filepath),
    summary: permissionSummary(request, input),
  }
}

export function toggleQuestionAnswer(answers: QuestionAnswer[], index: number, label: string, multiple?: boolean) {
  return answers.map((answer, current) => {
    if (current !== index) return answer
    if (!multiple) return [label]
    if (answer.includes(label)) return answer.filter((item) => item !== label)
    return [...answer, label]
  })
}

export function finalQuestionAnswers(answers: QuestionAnswer[], custom: string[]) {
  return answers.map((answer, index) => {
    const text = custom[index]?.trim()
    if (!text) return answer
    return [...answer, text]
  })
}

export function questionAnswersComplete(answers: QuestionAnswer[], custom: string[]) {
  return finalQuestionAnswers(answers, custom).every((answer) => answer.length > 0)
}

function permissionSummary(request: PermissionRequest, input: Record<string, unknown>): PermissionSummaryRow[] {
  const row = (label: string, value: unknown, technical = false): PermissionSummaryRow | undefined => {
    const text = stringValue(value)
    if (!text) return undefined
    return { label, value: text, technical }
  }
  const rows = (() => {
    if (request.permission === "read") return [row("Path", input.filePath, true)]
    if (request.permission === "glob" || request.permission === "grep") return [row("Pattern", input.pattern, true), row("Path", input.path, true)]
    if (request.permission === "list") return [row("Path", input.path, true)]
    if (request.permission === "task") return [row("Agent", input.subagent_type), row("Task", input.description)]
    if (request.permission === "webfetch" || request.permission === "browser_navigate") return [row("URL", input.url, true)]
    if (request.permission === "websearch") return [row("Query", input.query), row("Provider", input.provider)]
    if (request.permission === "browser_screenshot" || request.permission === "browser_snapshot") return [row("URL", input.url ?? request.metadata.url, true)]
    if (request.permission === "workspace_open") return [row("Path", input.path, true)]
    if (request.permission === "external_directory") return [row("Directory", request.metadata.parentDir ?? request.metadata.filepath ?? request.patterns[0], true)]
    if (request.permission === "doom_loop") return [{ label: "Reason", value: "The agent encountered the same failure repeatedly." }]
    return []
  })()
  return rows.filter((item): item is PermissionSummaryRow => Boolean(item))
}

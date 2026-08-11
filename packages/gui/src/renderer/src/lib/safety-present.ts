import type { PermissionRequest, QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import type { MessageBundle } from "./session-api"
import { permissionDiff, permissionTitle, stringValue } from "./tool-display"

export type SafetyQueueItem =
  | { kind: "permission"; id: string; request: PermissionRequest }
  | { kind: "question"; id: string; request: QuestionRequest; step: number }

export type SafetyQueueGroup = {
  /** Zero-based position within the active item's group (permissions or questions). */
  index: number
  /** Size of the active item's group. */
  total: number
  /** Human hint for the other group still waiting behind this one, e.g. "2 questions". */
  upNext?: string
}

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
  write: "pencil",
}

/**
 * Permissions come first, then questions - approvals unblock the model faster
 * than opinions do. A request with several questions contributes one queue entry
 * per question, so the one top-right pill is the only pagination anywhere.
 */
export function buildSafetyQueue(permissions: PermissionRequest[], questions: QuestionRequest[]): SafetyQueueItem[] {
  return [
    ...permissions.map((request) => ({ kind: "permission" as const, id: `permission:${request.id}`, request })),
    ...questions.flatMap((request) =>
      request.questions.map((_, step) => ({
        kind: "question" as const,
        id: `question:${request.id}:${step}`,
        request,
        step,
      })),
    ),
  ]
}

export function moveSafetyQueueIndex(index: number, total: number, delta: number) {
  if (total <= 1) return 0
  return (index + delta + total) % total
}

/**
 * The pill reads group-relative ("1 of 3" permissions, then "1 of 2"
 * questions), with a hint that another group is queued behind the current one.
 */
export function safetyQueueGroup(queue: SafetyQueueItem[], index: number): SafetyQueueGroup {
  const active = queue[index]
  const permissions = queue.filter((item) => item.kind === "permission").length
  const questionSteps = queue.length - permissions
  if (!active) return { index: 0, total: queue.length }
  const label = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`
  if (active.kind === "permission") {
    return {
      index,
      total: permissions,
      ...(questionSteps > 0 ? { upNext: label(questionSteps, "question") } : {}),
    }
  }
  return {
    index: index - permissions,
    total: questionSteps,
    ...(permissions > 0 ? { upNext: label(permissions, "permission") } : {}),
  }
}

export function describePermission(request: PermissionRequest, input: Record<string, unknown>): PermissionPresentation {
  const command = request.permission === "bash" ? stringValue(input.command) : undefined
  const description = stringValue(input.description)
  const title = command
    ? description ?? command.split("\n")[0] ?? "Run shell command"
    : permissionTitle(request, input)
  const heading = title || `Use ${request.permission.replaceAll("_", " ")}`

  return {
    icon: PERMISSION_ICONS[request.permission] ?? "lock",
    kind: request.permission.replaceAll("_", " "),
    title: heading,
    command,
    diff: permissionDiff(request),
    filePath: stringValue(request.metadata.filepath),
    // A row that repeats the heading (the fetch URL, the file path) is noise.
    summary: permissionSummary(request, input).filter((row) => !heading.includes(row.value)),
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

/**
 * The step the flow should move to after answering: the next question (after
 * `fromStep`, wrapping) whose final answer - selection or typed text - is still
 * empty. `undefined` means the request is complete and should submit instead.
 */
export function nextUnansweredStep(answers: QuestionAnswer[], custom: string[], fromStep: number): number | undefined {
  const final = finalQuestionAnswers(answers, custom)
  for (let offset = 1; offset <= final.length; offset++) {
    const step = (fromStep + offset) % final.length
    if (step === fromStep) continue
    if ((final[step] ?? []).length === 0) return step
  }
  return undefined
}

/**
 * The question card shows the model's accompanying words when they exist. The
 * accompanying prose can be lost upstream (see the 2026-08-09 spec, Part B
 * finding 3), so both fields are best-effort.
 */
export function latestAssistantContext(messages: MessageBundle[]): { text?: string; plan?: string } {
  const message = [...messages].reverse().find((bundle) => bundle.info.role === "assistant")
  if (!message) return {}
  let text: string | undefined
  let plan: string | undefined
  for (const part of message.parts) {
    if (part.type === "text" && !part.synthetic && !part.ignored && part.text.trim()) text = part.text.trim()
    if (part.type === "tool" && part.tool === "plan_exit" && "input" in part.state) {
      const input = part.state.input
      const value = typeof input === "object" && input !== null ? stringValue((input as Record<string, unknown>).plan) : undefined
      if (value?.trim()) plan = value
    }
  }
  return { ...(text ? { text } : {}), ...(plan ? { plan } : {}) }
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

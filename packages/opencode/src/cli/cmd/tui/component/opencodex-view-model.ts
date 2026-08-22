import type { useSync } from "@tui/context/sync"
import type { OpencodeXTerminalSession, OpencodeXViewMember } from "@opencode-ai/sdk/v2"

export type SyncContext = ReturnType<typeof useSync>
export type SyncSession = SyncContext["data"]["session"][number]
export type SyncMessage = NonNullable<SyncContext["data"]["message"][string]>[number]
export type SyncPart = NonNullable<SyncContext["data"]["part"][string]>[number]

export type OpencodeXView = {
  id: string
  title: string
  focusedSessionID?: string
  focusedItemID?: string
  layout: string
  sessions: SyncSession[]
  terminalSessions: OpencodeXTerminalSession[]
  sessionIDs: string[]
  members: OpencodeXViewMember[]
  metadata?: Record<string, unknown>
  timeUpdated: number
}

export type PendingViewSession = {
  id: string
  projectID?: string
  projectLabel?: string
  directory?: string
}

export type ViewItem =
  | { kind: "session"; session: SyncSession }
  | { kind: "terminal"; terminal: OpencodeXTerminalSession }
  | { kind: "pending"; slot: PendingViewSession }
export type LayoutNode = number | { direction: "row" | "column"; children: LayoutNode[] }

type ViewMembership = { members?: OpencodeXViewMember[]; sessionIDs?: string[] }

/** Pane count including terminal members; legacy rows only carry sessionIDs. */
export function viewMemberCount(view: ViewMembership) {
  return view.members?.length ?? view.sessionIDs?.length ?? 0
}

/** Session-kind member ids, however the row is stored. */
export function viewSessionMemberIDs(view: ViewMembership) {
  if (view.members) return view.members.filter((member) => member.kind === "session").map((member) => member.id)
  return view.sessionIDs ?? []
}

export function viewLayout(count: number): LayoutNode {
  if (count <= 1) return 0
  if (count === 2) return { direction: "row", children: [0, 1] }
  if (count === 3) return { direction: "row", children: [0, { direction: "column", children: [1, 2] }] }
  if (count === 4) {
    return {
      direction: "column",
      children: [
        { direction: "row", children: [0, 1] },
        { direction: "row", children: [2, 3] },
      ],
    }
  }
  if (count === 5) {
    return {
      direction: "row",
      children: [
        { direction: "column", children: [0, 1, 2] },
        { direction: "column", children: [3, 4] },
      ],
    }
  }
  if (count === 6) {
    return {
      direction: "column",
      children: [
        { direction: "row", children: [0, 1, 2] },
        { direction: "row", children: [3, 4, 5] },
      ],
    }
  }
  if (count === 7) {
    return {
      direction: "row",
      children: [
        { direction: "column", children: [0, 1, 2, 3] },
        { direction: "column", children: [4, 5, 6] },
      ],
    }
  }
  return {
    direction: "column",
    children: [
      { direction: "row", children: [0, 1, 2, 3] },
      { direction: "row", children: [4, 5, 6, 7] },
    ],
  }
}

export function truncateViewText(input: string, length: number) {
  if (input.length <= length) return input
  return input.slice(0, Math.max(0, length - 3)) + "..."
}

export function viewItemID(item: ViewItem) {
  if (item.kind === "session") return item.session.id
  if (item.kind === "terminal") return item.terminal.id
  return item.slot.id
}

export function pendingViewSessions(view?: Pick<OpencodeXView, "metadata">): PendingViewSession[] {
  const opencodex = view?.metadata?.opencodex
  if (!isRecord(opencodex) || !Array.isArray(opencodex.pendingSessions)) return []
  return opencodex.pendingSessions.flatMap((item): PendingViewSession[] => {
    if (!isRecord(item) || typeof item.id !== "string") return []
    return [
      {
        id: item.id,
        projectID: typeof item.projectID === "string" ? item.projectID : undefined,
        projectLabel: typeof item.projectLabel === "string" ? item.projectLabel : undefined,
        directory: typeof item.directory === "string" ? item.directory : undefined,
      },
    ]
  })
}

export function metadataWithPendingSessions(
  metadata: Record<string, unknown> | undefined,
  pending: PendingViewSession[],
) {
  const next = { ...metadata }
  const opencodex = isRecord(next.opencodex) ? { ...next.opencodex } : {}
  if (pending.length) {
    opencodex.pendingSessions = pending
    next.opencodex = opencodex
    return next
  }
  delete opencodex.pendingSessions
  if (Object.keys(opencodex).length) next.opencodex = opencodex
  else delete next.opencodex
  return next
}

export function viewMessageText(message: SyncMessage, parts: SyncPart[]) {
  const text = parts.map(partText).filter(Boolean).join("\n")
  if (text) return text
  return message.role === "assistant" ? "Thinking..." : ""
}

function partText(part: SyncPart) {
  if (part.type === "text") return part.synthetic || part.ignored ? "" : part.text.trim()
  if (part.type === "reasoning") return part.text.trim() ? "Thinking" : ""
  if (part.type === "file") return `[file] ${part.filename ?? part.url}`
  if (part.type === "agent") return `[agent] ${part.name}`
  if (part.type === "tool") {
    const title = toolTitle(part)
    if (part.state.status === "running") return `${title} (running)`
    if (part.state.status === "error") return `${title} failed: ${part.state.error}`
    if (part.state.status === "pending") return `${title} (pending)`
    return title
  }
  if (part.type === "patch") return `Patch: ${part.files.join(", ")}`
  if (part.type === "compaction") return `Compaction: ${part.auto ? "auto" : "manual"}`
  return ""
}

function toolTitle(part: Extract<SyncPart, { type: "tool" }>) {
  const input = part.state.status === "pending" || !isRecord(part.state.input) ? {} : part.state.input
  const stateTitle =
    part.state.status === "running" || part.state.status === "completed" ? stringValue(part.state.title) : ""
  const value = (name: string) => stringValue(input[name])
  if (part.tool === "bash" || part.tool === "shell") return value("command") ? `$ ${value("command")}` : stateTitle || "Shell command"
  if (part.tool === "glob" || part.tool === "grep") return value("pattern") ? `${part.tool === "glob" ? "Glob" : "Grep"}: ${value("pattern")}` : stateTitle || `${titlecase(part.tool)} search`
  if (["read", "write", "edit"].includes(part.tool)) return value("filePath") ? `${titlecase(part.tool)}: ${compactPath(value("filePath"))}` : stateTitle || `${titlecase(part.tool)} file`
  if (part.tool === "apply_patch") return stateTitle || "Apply patch"
  if (part.tool === "todowrite") {
    const count = Array.isArray(input.todos) ? input.todos.length : 0
    return count ? `Todo update: ${count} item${count === 1 ? "" : "s"}` : stateTitle || "Todo update"
  }
  if (part.tool === "task") return taskToolTitle(value) || stateTitle || "Task"
  if (part.tool === "skill") return value("name") ? `Loaded skill: ${value("name")}` : stateTitle || "Loaded skill"
  if (part.tool === "question") return questionTitle(input) || stateTitle || "Question"
  if (part.tool === "webfetch") return value("url") ? `Fetch: ${value("url")}` : stateTitle || "Web fetch"
  if (part.tool === "websearch") return value("query") ? `Web search: ${value("query")}` : stateTitle || "Web search"
  if (part.tool === "list") return value("path") ? `List: ${compactPath(value("path"))}` : stateTitle || "List files"
  return stateTitle || `${part.tool} ${Object.values(input).map(stringValue).find(Boolean) ?? ""}`.trim()
}

/** The longest a delegated prompt's opening line may run inside a title. */
const TASK_PROMPT_TITLE_LENGTH = 60

/**
 * Native task calls carry `{subagent_type, description}`. The swarm delegation
 * tool normalizes onto `task` too (claude-mapper.ts) but carries `{role,
 * prompt}` - which read as a bare "Task" until the role and prompt were given
 * their own shape.
 */
function taskToolTitle(value: (name: string) => string) {
  const role = value("role")
  if (role && !value("description"))
    return `Task ${role}: ${truncateViewText(firstLine(value("prompt")), TASK_PROMPT_TITLE_LENGTH) || "delegation"}`
  return value("description") ? `Task: ${value("description")}` : ""
}

/** The opening non-empty line of a multi-line value, collapsed to one row. */
function firstLine(value: string) {
  return (
    value
      .split("\n")
      .find((candidate) => candidate.trim())
      ?.replace(/\s+/g, " ")
      .trim() ?? ""
  )
}

function questionTitle(input: Record<string, unknown>) {
  const first = Array.isArray(input.questions) ? input.questions.find(isRecord) : undefined
  return first ? stringValue(first.question) || stringValue(first.header) : ""
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function compactPath(value: string) {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value
}

function titlecase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

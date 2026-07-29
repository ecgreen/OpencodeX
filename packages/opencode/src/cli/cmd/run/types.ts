// Shared type vocabulary for `opencode run` output formatting.
//
// `tool.ts` turns SDK tool parts into display-ready bodies and snapshots; these
// types describe that vocabulary (entry kinds, layouts, structured snapshots,
// and the stream commit shape the formatters accept).
import type { ToolPart } from "@opencode-ai/sdk/v2"

// The semantic role of a scrollback entry. Maps 1:1 to theme colors.
export type EntryKind = "system" | "user" | "assistant" | "reasoning" | "tool" | "error"

export type ToolCodeSnapshot = {
  kind: "code"
  title: string
  content: string
  file?: string
}

export type ToolDiffSnapshot = {
  kind: "diff"
  items: Array<{
    title: string
    diff: string
    file?: string
    deletions?: number
  }>
}

export type ToolTaskSnapshot = {
  kind: "task"
  title: string
  rows: string[]
  tail: string
}

export type ToolTodoSnapshot = {
  kind: "todo"
  items: Array<{
    status: string
    content: string
  }>
  tail: string
}

export type ToolQuestionSnapshot = {
  kind: "question"
  items: Array<{
    question: string
    answer: string
  }>
  tail: string
}

export type ToolSnapshot =
  | ToolCodeSnapshot
  | ToolDiffSnapshot
  | ToolTaskSnapshot
  | ToolTodoSnapshot
  | ToolQuestionSnapshot

export type EntryLayout = "inline" | "block"

export type RunEntryBody =
  | { type: "none" }
  | { type: "text"; content: string }
  | { type: "code"; content: string; filetype?: string }
  | { type: "markdown"; content: string }
  | { type: "structured"; snapshot: ToolSnapshot }

// Lifecycle phase of a scrollback entry. "start" opens the entry, "progress"
// appends content, "final" closes it.
export type StreamPhase = "start" | "progress" | "final"

export type StreamSource = "assistant" | "reasoning" | "tool" | "system"

export type StreamToolState = "running" | "completed" | "error"

// A single append-only commit to scrollback, produced from SDK events and
// consumed by the tool formatters.
export type StreamCommit = {
  kind: EntryKind
  text: string
  phase: StreamPhase
  source: StreamSource
  messageID?: string
  partID?: string
  tool?: string
  part?: ToolPart
  interrupted?: boolean
  toolState?: StreamToolState
  toolError?: string
  shell?: {
    callID: string
    command: string
  }
}

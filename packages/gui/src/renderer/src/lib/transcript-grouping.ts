import type { Part } from "@opencode-ai/sdk/v2/client"
import { fileBasename, pluralize, stringValue } from "./tool-values"
import { toolMetadata, toolStateInput } from "./tool-display"

export type ToolPart = Extract<Part, { type: "tool" }>
export type ReasoningPart = Extract<Part, { type: "reasoning" }>
export type TextPart = Extract<Part, { type: "text" }>
export type CommentaryPart = TextPart & { metadata: { openai: { phase: "commentary" } } }
export type ThinkingPart = ReasoningPart | CommentaryPart

export type DisplayPart =
  | { key: string; type: "part"; part: Part }
  | { key: string; type: "tool-group"; tool: string; parts: ToolPart[] }
  | { key: string; type: "reasoning-group"; parts: ThinkingPart[] }

const GROUP_VERB_BY_TOOL: Record<string, { verb: string; noun: string }> = {
  read: { verb: "Read", noun: "file" },
  grep: { verb: "Grep", noun: "search" },
  glob: { verb: "Glob", noun: "search" },
  webfetch: { verb: "Fetch", noun: "URL" },
  websearch: { verb: "Search", noun: "query" },
  skill: { verb: "Load", noun: "skill" },
}

export function isGroupableTool(tool: string) {
  return tool in GROUP_VERB_BY_TOOL
}

/** OpenAI's Codex-style progress updates are assistant text, not reasoning-summary events. */
export function isThinkingPart(part: Part): part is ThinkingPart {
  if (part.type === "reasoning") return true
  if (part.type !== "text") return false
  const openai = part.metadata?.openai
  return typeof openai === "object" && openai !== null && "phase" in openai && openai.phase === "commentary"
}

/**
 * Collapses runs of the same lightweight tool, and every run of thinking, into
 * a single display item. Thinking includes reasoning summaries and OpenAI
 * commentary progress, and always groups so one renderer owns its presentation.
 */
export function groupTranscriptParts(parts: Part[]): DisplayPart[] {
  const result: DisplayPart[] = []
  let pendingTools: ToolPart[] = []
  let pendingThinking: ThinkingPart[] = []

  function flushTools() {
    if (pendingTools.length === 0) return
    if (pendingTools.length === 1) result.push({ key: `part:${pendingTools[0].id}`, type: "part", part: pendingTools[0] })
    else result.push({ key: `tool-group:${pendingTools[0].tool}:${pendingTools[0].id}`, type: "tool-group", tool: pendingTools[0].tool, parts: pendingTools })
    pendingTools = []
  }

  function flushThinking() {
    if (pendingThinking.length === 0) return
    result.push({ key: `reasoning-group:${pendingThinking[0].id}`, type: "reasoning-group", parts: pendingThinking })
    pendingThinking = []
  }

  for (const part of parts) {
    if (part.type === "tool" && isGroupableTool(part.tool)) {
      flushThinking()
      if (pendingTools.length === 0 || pendingTools[0].tool === part.tool) {
        pendingTools.push(part)
        continue
      }
    }
    if (isThinkingPart(part)) {
      flushTools()
      pendingThinking.push(part)
      continue
    }
    flushTools()
    flushThinking()
    result.push({ key: `part:${part.id}`, type: "part", part })
  }
  flushTools()
  flushThinking()
  return result
}

export function toolGroupStatus(parts: ToolPart[]) {
  if (parts.some((part) => part.state.status === "error")) return "error"
  if (parts.some((part) => part.state.status === "running")) return "running"
  if (parts.every((part) => part.state.status === "completed")) return "completed"
  return parts.at(-1)?.state.status ?? "pending"
}

/**
 * A part can only genuinely be running while its turn is: once the assistant
 * message completed, or the session went idle, a still-"running" status is a
 * write that never landed - show it as interrupted instead of ticking a live
 * timer forever.
 */
export function isStaleRunningTool(status: string, messageCompleted: boolean, sessionLive: boolean) {
  if (status !== "running" && status !== "pending") return false
  return messageCompleted || !sessionLive
}

export function toolGroupTitle(tool: string, parts: ToolPart[]) {
  const entry = GROUP_VERB_BY_TOOL[tool]
  if (!entry) return `${tool} x${parts.length}`
  return `${entry.verb} ${parts.length} ${pluralize(entry.noun, parts.length)}`
}

/**
 * A collapsed group has to answer "what did it touch?" on its own - a bare
 * count sends the reader looking for the expander.
 */
export function toolGroupSummary(tool: string, parts: ToolPart[], limit = 3) {
  const labels: string[] = []
  for (const part of parts) {
    const label = groupItemLabel(tool, part)
    if (label && !labels.includes(label)) labels.push(label)
  }
  if (labels.length === 0) return ""
  const shown = labels.slice(0, limit)
  const remaining = labels.length - shown.length
  return remaining > 0 ? `${shown.join(", ")}, +${remaining} more` : shown.join(", ")
}

function groupItemLabel(tool: string, part: ToolPart) {
  const input = toolStateInput(part.state)
  const metadata = toolMetadata(part.state) ?? {}
  if (tool === "read") {
    const path = stringValue(input.filePath)
    return path ? fileBasename(path) : ""
  }
  if (tool === "grep" || tool === "glob") return stringValue(input.pattern) ?? ""
  if (tool === "webfetch") return hostOf(stringValue(input.url))
  if (tool === "websearch") return stringValue(input.query) ?? ""
  if (tool === "skill") return stringValue(input.name) ?? stringValue(metadata.name) ?? ""
  return ""
}

function hostOf(url: string | undefined) {
  if (!url) return ""
  const match = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i)
  return match ? match[1] : url
}

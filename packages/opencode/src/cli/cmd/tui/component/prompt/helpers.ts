import { RGBA } from "@opentui/core"
import type { Part } from "@opencode-ai/sdk/v2"
import type { EditorSelection } from "@tui/context/editor"
import { unwrap } from "solid-js/store"
import type { PromptInfo } from "./history"
import type {
  OpencodeXPromptProject,
  OpencodeXPromptSwarm,
  OpencodeXSwarmExecutionMode,
} from "./types"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export const DRAFT_RETENTION_MIN_CHARS = 20

export function opencodeXSwarmExecutionMode(agentName?: string): OpencodeXSwarmExecutionMode {
  return agentName === "plan" ? "plan" : "build"
}

export function opencodeXSwarmModeInstructions(mode: OpencodeXSwarmExecutionMode) {
  if (mode === "plan") {
    return [
      "OpencodeX swarm execution mode: PLAN.",
      "The user is asking the swarm to produce a plan for review before execution.",
      "Do not make code changes, write files, run destructive commands, or ask subagents to edit files in plan mode.",
      "When delegating, tell every subagent this is plan mode and require planning/review output only.",
    ].join("\n")
  }
  return [
    "OpencodeX swarm execution mode: BUILD.",
    "The user is asking the swarm to execute approved work, make changes when needed, and validate the result.",
    "When delegating, tell every subagent this is build mode and whether that subagent may edit files or should only review/validate.",
  ].join("\n")
}

export function opencodeXProjectTitle(project: OpencodeXPromptProject) {
  return project.name ?? project.project.name ?? project.project.worktree
}

export function promptSlash(input: string) {
  const trimmed = input.trim()
  if (!trimmed.startsWith("/")) return
  const [name, ...rest] = trimmed.slice(1).split(/\s+/)
  if (!name) return
  return { name, arguments: rest.join(" ") }
}

export function matchOpencodeXSwarm(swarms: OpencodeXPromptSwarm[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return
  return (
    swarms.find((swarm) => swarm.id.toLowerCase() === needle) ??
    swarms.find((swarm) => swarm.title.toLowerCase() === needle) ??
    swarms.find((swarm) => swarm.title.toLowerCase().includes(needle) || swarm.id.toLowerCase().includes(needle))
  )
}

export function sessionOpencodeXSwarmID(session: { metadata?: unknown; model?: { id: string; providerID: string } } | undefined) {
  const metadata = session?.metadata
  const opencodex = typeof metadata === "object" && metadata !== null && "opencodex" in metadata ? metadata.opencodex : undefined
  if (typeof opencodex === "object" && opencodex !== null && "swarmID" in opencodex && typeof opencodex.swarmID === "string") return opencodex.swarmID
  return session?.model?.providerID === "swarm" ? session.model.id : undefined
}

export function promptHistoryEntry(parts: Part[]): PromptInfo | undefined {
  const input = parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text" && !part.synthetic && !part.ignored)
    .map((part) => part.text)
    .join("\n")
  const promptParts = parts
    .map(promptHistoryPart)
    .filter((part): part is PromptInfo["parts"][number] => part !== undefined)
  if (input.length === 0 && promptParts.length === 0) return undefined
  return { input, parts: promptParts }
}

export function randomIndex(count: number) {
  if (count <= 0) return 0
  return Math.floor(Math.random() * count)
}

export function fadeColor(color: RGBA, alpha: number) {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}

export function hasEditorRangeSelection(selection: EditorSelection["ranges"][number]) {
  return (
    selection.selection.start.line !== selection.selection.end.line ||
    selection.selection.start.character !== selection.selection.end.character
  )
}

export function getEditorRangeLabel(selection: EditorSelection["ranges"][number]) {
  if (!hasEditorRangeSelection(selection)) return
  if (selection.selection.start.line === selection.selection.end.line) return `#${selection.selection.start.line}`
  return `#${selection.selection.start.line}-${selection.selection.end.line}`
}

export function formatEditorContext(selection: EditorSelection) {
  const selected = selection.ranges.filter(hasEditorRangeSelection)
  if (selected.length === 0)
    return `<system-reminder>Note: The user opened the file "${selection.filePath}". This may or may not be relevant to the current task.</system-reminder>\n`

  const ranges = selected.map((range, index) => {
    const prefix = selected.length > 1 ? `Selection ${index + 1}: ` : ""
    return `Note: The user selected ${prefix}${getEditorRangeLabel(range)} from "${selection.filePath}". \`\`\`${range.text}\`\`\`\n\n`
  })
  return `<system-reminder>${ranges.join("\n")} This may or may not be relevant to the current task.</system-reminder>\n`
}

export function formatPromptCost(cost: number) {
  return money.format(cost)
}

function promptHistoryPart(input: Part): PromptInfo["parts"][number] | undefined {
  const part = unwrap(input)
  if (part.type === "file") {
    return {
      type: "file",
      mime: part.mime,
      ...(part.filename !== undefined ? { filename: part.filename } : {}),
      url: part.url,
      ...(part.source !== undefined ? { source: promptHistoryFileSource(part.source) } : {}),
    }
  }
  if (part.type === "agent") {
    return {
      type: "agent",
      name: part.name,
      ...(part.source !== undefined ? { source: promptHistoryAgentSource(part.source) } : {}),
    }
  }
  return undefined
}

function promptHistoryFileSource(source: NonNullable<Extract<Part, { type: "file" }>["source"]>) {
  const text = { value: source.text.value, start: source.text.start, end: source.text.end }
  if (source.type === "file") return { type: "file" as const, path: source.path, text }
  if (source.type === "symbol") {
    return {
      type: "symbol" as const,
      path: source.path,
      range: {
        start: { line: source.range.start.line, character: source.range.start.character },
        end: { line: source.range.end.line, character: source.range.end.character },
      },
      name: source.name,
      kind: source.kind,
      text,
    }
  }
  return { type: "resource" as const, clientName: source.clientName, uri: source.uri, text }
}

function promptHistoryAgentSource(source: NonNullable<Extract<Part, { type: "agent" }>["source"]>) {
  return { value: source.value, start: source.start, end: source.end }
}

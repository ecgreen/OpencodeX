// Per-tool inline summaries for the non-interactive `opencode run` command.
//
// Each known tool (bash, edit, write, task, etc.) has a renderer that turns an
// SDK tool part into a one-line (or block) summary printed by `cmd/run.ts`.
// Tools without a renderer get fallback formatting.
import os from "os"
import path from "path"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import type * as Tool from "@/tool/tool"
import type { ApplyPatchTool } from "@/tool/apply_patch"
import type { ShellTool as BashTool } from "@/tool/shell"
import type { EditTool } from "@/tool/edit"
import type { GlobTool } from "@/tool/glob"
import type { GrepTool } from "@/tool/grep"
import type { InvalidTool } from "@/tool/invalid"
import type { LspTool } from "@/tool/lsp"
import type { PlanExitTool } from "@/tool/plan"
import type { QuestionTool } from "@/tool/question"
import type { ReadTool } from "@/tool/read"
import type { SkillTool } from "@/tool/skill"
import type { TaskTool } from "@/tool/task"
import type { TodoWriteTool } from "@/tool/todo"
import type { WebFetchTool } from "@/tool/webfetch"
import { webSearchProviderLabel, type WebSearchTool } from "@/tool/websearch"
import type { WriteTool } from "@/tool/write"
import * as Locale from "@/util/locale"

type ToolDict = Record<string, unknown>

type ToolFrame = {
  name: string
  input: ToolDict
  meta: ToolDict
  state: ToolDict
  status: string
}

export type ToolInline = {
  icon: string
  title: string
  description?: string
  mode?: "inline" | "block"
  body?: string
}

type ToolProps<T = Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  frame: ToolFrame
}

type ToolDefs = {
  invalid: typeof InvalidTool
  bash: typeof BashTool
  write: typeof WriteTool
  edit: typeof EditTool
  apply_patch: typeof ApplyPatchTool
  batch: Tool.Info
  task: typeof TaskTool
  todowrite: typeof TodoWriteTool
  question: typeof QuestionTool
  read: typeof ReadTool
  glob: typeof GlobTool
  grep: typeof GrepTool
  list: Tool.Info
  lsp: typeof LspTool
  webfetch: typeof WebFetchTool
  websearch: typeof WebSearchTool
  skill: typeof SkillTool
  plan_exit: typeof PlanExitTool
}

type ToolName = keyof ToolDefs

type ToolRule<T = Tool.Info> = {
  run: (props: ToolProps<T>) => ToolInline
}

type ToolRegistry = {
  [K in ToolName]: ToolRule<ToolDefs[K]>
}

type AnyToolRule = ToolRule

function dict(v: unknown): ToolDict {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return {}
  }

  return { ...v }
}

function props<T = Tool.Info>(frame: ToolFrame): ToolProps<T> {
  return {
    input: Object.assign(Object.create(null), frame.input),
    metadata: Object.assign(Object.create(null), frame.meta),
    frame,
  }
}

function text(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function list<T>(v: unknown): T[] {
  if (!Array.isArray(v)) {
    return []
  }

  return v
}

function info(data: ToolDict, skip: string[] = []): string {
  const list = Object.entries(data).filter(([key, val]) => {
    if (skip.includes(key)) {
      return false
    }

    return typeof val === "string" || typeof val === "number" || typeof val === "boolean"
  })

  if (list.length === 0) {
    return ""
  }

  return `[${list.map(([key, val]) => `${key}=${String(val)}`).join(", ")}]`
}

function toolPath(input?: string, opts: { home?: boolean } = {}): string {
  if (!input) {
    return ""
  }

  const cwd = process.cwd()
  const home = os.homedir()
  const abs = path.isAbsolute(input) ? input : path.resolve(cwd, input)
  const rel = path.relative(cwd, abs)

  if (!rel) {
    return "."
  }

  if (!rel.startsWith("..")) {
    return rel.replaceAll("\\", "/")
  }

  if (opts.home && home && (abs === home || abs.startsWith(home + path.sep))) {
    return abs.replace(home, "~").replaceAll("\\", "/")
  }

  return abs.replaceAll("\\", "/")
}

function fallbackInline(ctx: ToolFrame): ToolInline {
  const title = text(ctx.state.title) || (Object.keys(ctx.input).length > 0 ? JSON.stringify(ctx.input) : "Unknown")

  return {
    icon: "⚙",
    title: `${ctx.name} ${title}`,
  }
}

function count(n: number, label: string): string {
  return `${n} ${label}${n === 1 ? "" : "es"}`
}

function runGlob(p: ToolProps<typeof GlobTool>): ToolInline {
  const root = p.input.path ?? ""
  const title = `Glob "${p.input.pattern ?? ""}"`
  const suffix = root ? `in ${toolPath(root)}` : ""
  const matches = p.metadata.count
  const description = matches === undefined ? suffix : `${suffix}${suffix ? " · " : ""}${count(matches, "match")}`
  return {
    icon: "✱",
    title,
    ...(description && { description }),
  }
}

function runGrep(p: ToolProps<typeof GrepTool>): ToolInline {
  const root = p.input.path ?? ""
  const title = `Grep "${p.input.pattern ?? ""}"`
  const suffix = root ? `in ${toolPath(root)}` : ""
  const matches = p.metadata.matches
  const description = matches === undefined ? suffix : `${suffix}${suffix ? " · " : ""}${count(matches, "match")}`
  return {
    icon: "✱",
    title,
    ...(description && { description }),
  }
}

function runList(p: ToolProps): ToolInline {
  const dir = text(dict(p.input).path)
  return {
    icon: "→",
    title: dir ? `List ${toolPath(dir)}` : "List",
  }
}

function runRead(p: ToolProps<typeof ReadTool>): ToolInline {
  const file = toolPath(p.input.filePath)
  const description = info(p.frame.input, ["filePath"]) || undefined
  return {
    icon: "→",
    title: `Read ${file}`,
    ...(description && { description }),
  }
}

function runWrite(p: ToolProps<typeof WriteTool>): ToolInline {
  return {
    icon: "←",
    title: `Write ${toolPath(p.input.filePath)}`,
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output) : undefined,
  }
}

function runWebfetch(p: ToolProps<typeof WebFetchTool>): ToolInline {
  const url = p.input.url ?? ""
  return {
    icon: "%",
    title: url ? `WebFetch ${url}` : "WebFetch",
  }
}

function runEdit(p: ToolProps<typeof EditTool>): ToolInline {
  return {
    icon: "←",
    title: `Edit ${toolPath(p.input.filePath)}`,
    mode: "block",
    body: p.metadata.diff,
  }
}

function runWebSearch(p: ToolProps<typeof WebSearchTool>): ToolInline {
  const title = webSearchProviderLabel(p.metadata.provider)
  return {
    icon: "◈",
    title: p.input.query ? `${title} "${p.input.query}"` : title,
  }
}

function runTask(p: ToolProps<typeof TaskTool>): ToolInline {
  const kind = Locale.titlecase(p.input.subagent_type || "unknown")
  const desc = p.input.description
  const icon = p.frame.status === "error" ? "✗" : p.frame.status === "running" ? "•" : "✓"
  return {
    icon,
    title: desc || `${kind} Task`,
    description: desc ? `${kind} Agent` : undefined,
  }
}

function runTodo(p: ToolProps<typeof TodoWriteTool>): ToolInline {
  return {
    icon: "#",
    title: "Todos",
    mode: "block",
    body: list<{ status?: string; content?: string }>(p.frame.input.todos)
      .flatMap((item) => {
        const body = typeof item?.content === "string" ? item.content : ""
        if (!body) {
          return []
        }

        const mark = item.status === "completed" ? "[✓]" : item.status === "in_progress" ? "[•]" : "[ ]"
        return [`${mark} ${body}`]
      })
      .join("\n"),
  }
}

function runSkill(p: ToolProps<typeof SkillTool>): ToolInline {
  return {
    icon: "→",
    title: `Skill "${p.input.name ?? ""}"`,
  }
}

function runPatch(p: ToolProps<typeof ApplyPatchTool>): ToolInline {
  const files = p.metadata.files?.length ?? 0
  if (files === 0) {
    return {
      icon: "%",
      title: "Patch",
    }
  }

  return {
    icon: "%",
    title: `Patch ${files} file${files === 1 ? "" : "s"}`,
  }
}

function runQuestion(p: ToolProps<typeof QuestionTool>): ToolInline {
  const total = list(p.frame.input.questions).length
  return {
    icon: "→",
    title: `Asked ${total} question${total === 1 ? "" : "s"}`,
  }
}

function runInvalid(p: ToolProps<typeof InvalidTool>): ToolInline {
  return {
    icon: "✗",
    title: text(p.frame.state.title) || "Invalid Tool",
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output) : undefined,
  }
}

function runBatch(p: ToolProps): ToolInline {
  const calls = list(dict(p.input).tool_calls).length
  return {
    icon: "#",
    title: text(p.frame.state.title) || (calls > 0 ? `Batch ${calls} tool${calls === 1 ? "" : "s"}` : "Batch"),
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output) : undefined,
  }
}

function lspTitle(input: { operation?: string; filePath?: string; line?: number; character?: number }): string {
  const op = input.operation || "request"
  const file = input.filePath ? toolPath(input.filePath) : ""
  const line = typeof input.line === "number" ? input.line : undefined
  const char = typeof input.character === "number" ? input.character : undefined
  const pos = line !== undefined && char !== undefined ? `:${line}:${char}` : ""
  if (!file) {
    return `LSP ${op}`
  }

  return `LSP ${op} ${file}${pos}`
}

function runLsp(p: ToolProps<typeof LspTool>): ToolInline {
  return {
    icon: "→",
    title: text(p.frame.state.title) || lspTitle(p.input),
  }
}

function runPlanExit(p: ToolProps<typeof PlanExitTool>): ToolInline {
  return {
    icon: "→",
    title: text(p.frame.state.title) || "Switching to build agent",
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output) : undefined,
  }
}

function runBash(p: ToolProps<typeof BashTool>): ToolInline {
  return {
    icon: "$",
    title: p.input.command || "",
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output).trim() : undefined,
  }
}

const TOOL_RULES = {
  invalid: { run: runInvalid },
  bash: { run: runBash },
  write: { run: runWrite },
  edit: { run: runEdit },
  apply_patch: { run: runPatch },
  batch: { run: runBatch },
  task: { run: runTask },
  todowrite: { run: runTodo },
  question: { run: runQuestion },
  read: { run: runRead },
  glob: { run: runGlob },
  grep: { run: runGrep },
  list: { run: runList },
  lsp: { run: runLsp },
  webfetch: { run: runWebfetch },
  websearch: { run: runWebSearch },
  skill: { run: runSkill },
  plan_exit: { run: runPlanExit },
} as const satisfies ToolRegistry

function key(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_RULES, name)
}

function rule(name?: string): AnyToolRule | undefined {
  if (!name || !key(name)) {
    return undefined
  }

  return TOOL_RULES[name]
}

function frame(part: ToolPart): ToolFrame {
  const state = dict(part.state)
  return {
    name: part.tool,
    input: dict(state.input),
    meta: "metadata" in part.state ? dict(part.state.metadata) : {},
    state,
    status: text(state.status),
  }
}

export function toolInlineInfo(part: ToolPart): ToolInline {
  const ctx = frame(part)
  const draw = rule(ctx.name)?.run
  try {
    if (draw) {
      return draw(props(ctx))
    }
  } catch {
    return fallbackInline(ctx)
  }

  return fallbackInline(ctx)
}

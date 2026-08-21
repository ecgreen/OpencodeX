import { createTwoFilesPatch } from "diff"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import type { SessionSchema } from "@opencode-ai/core/session/schema"
import type { ConversationTask } from "./claude-driver-metadata"
import { classifyClaudeError, type ClaudeAuthFailure } from "./claude-auth-error"

type SessionID = typeof SessionSchema.ID.Type
type MessageID = typeof SessionLegacy.MessageID.Type
type PartID = typeof SessionLegacy.PartID.Type

/**
 * Pure translation of Claude Code's headless stream-json events into OpencodeX
 * transcript writes. No IO, no Effect, no clock: every dependency (ids, now)
 * is injected so the whole mapping is testable against recorded fixtures.
 *
 * Shapes follow `claude -p --output-format stream-json`. Parsing is deliberately
 * permissive - unknown events and unknown content blocks are ignored rather
 * than failing a turn.
 */

export type ClaudeEvent = {
  type?: string
  subtype?: string
  session_id?: string
  model?: string
  cwd?: string
  message?: {
    id?: string
    model?: string
    content?: unknown
    usage?: ClaudeUsage
    stop_reason?: string
  }
  total_cost_usd?: number
  usage?: ClaudeUsage
  is_error?: boolean
  result?: string
  [key: string]: unknown
}

type ClaudeUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export type SessionWrite =
  | { kind: "message"; message: SessionLegacy.Assistant }
  | { kind: "part"; part: SessionLegacy.Part }
  | { kind: "todos"; todos: Array<{ content: string; status: string; priority: string }> }

export type MapperContext = {
  sessionID: SessionID
  /** Assistant messages hang off the user message that triggered the turn. */
  parentMessageID: MessageID
  directory: string
  /**
   * The OpencodeX route the turn was started on. Claude reports its own wire
   * model id in the stream, but the transcript has to attribute the message to
   * the catalog entry the reader actually picked.
   */
  providerID: string
  modelID: string
  nextMessageID: () => MessageID
  nextPartID: () => PartID
  now: () => number
  /**
   * The input the permission gate actually approved for a call, when it
   * rewrote it - the AskUserQuestion answers travel back this way. Recording it
   * on the finished part is what lets the transcript show what the user chose.
   */
  decidedInput?: (callID: string) => Record<string, unknown> | undefined
}

export type MapperState = {
  messageID?: MessageID
  modelID: string
  /** Claude reports cost/tokens cumulatively per conversation, not per turn. */
  billed: { cost: number; input: number; output: number; cacheRead: number; cacheWrite: number }
  /**
   * Usage of the most recent API request, from assistant events. The result
   * event's usage sums every request in the turn, so it cannot describe the
   * conversation's current context - this can.
   */
  lastUsage?: SessionLegacy.StepFinishPart["tokens"]
  toolParts: Map<string, { partID: PartID; tool: string; input: Record<string, unknown>; start: number }>
  textParts: Map<string, PartID>
  /** Accumulated text per streaming block, keyed like textParts. */
  streamText: Map<string, string>
  /** The API message currently streaming; scopes block indexes across events. */
  apiMessageID?: string
  claudeSessionID?: string
  /** Set when a `--resume` was refused, so the stored id can be discarded. */
  resumeRejected?: boolean
  /** Set when the CLI failed because the user has to sign in again. */
  authFailure?: ClaudeAuthFailure
  finished?: boolean
  /**
   * Live background tasks (backgrounded subagents, background shells) as
   * reported by `background_tasks_changed` - a level signal with replace
   * semantics. While any are live, a `result` event is a pause (the CLI
   * re-wakes the model on this same stream when they report back), not the
   * end of the turn.
   */
  liveBackgroundTasks: number
  /** Cost accumulated across this turn's steps, for the completed message. */
  turnCost: number
  /** Claude harness task tools (TaskCreate/TaskUpdate) projected as todos. */
  tasks: Map<string, { subject: string; status: string }>
  /** Monotonic counter for synthesized task ids, so deletions can't cause reuse. */
  taskSequence: number
}

export function initialState(input: { modelID?: string; billed?: MapperState["billed"]; tasks?: ConversationTask[] } = {}): MapperState {
  return {
    modelID: input.modelID ?? "claude-code",
    billed: input.billed ?? { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    toolParts: new Map(),
    textParts: new Map(),
    streamText: new Map(),
    liveBackgroundTasks: 0,
    turnCost: 0,
    tasks: new Map((input.tasks ?? []).map((task) => [task.id, { subject: task.subject, status: task.status }])),
    taskSequence: (input.tasks ?? []).length,
  }
}

/**
 * Claude's tool names are PascalCase; OpencodeX renders icons, titles, and card
 * tiers off its own lowercase ids. Normalizing here makes mirrored tool calls
 * indistinguishable from native ones in the transcript.
 */
const TOOL_NAMES: Record<string, string> = {
  read: "read",
  write: "write",
  edit: "edit",
  multiedit: "edit",
  notebookedit: "edit",
  bash: "bash",
  bashoutput: "bash",
  killshell: "bash",
  glob: "glob",
  grep: "grep",
  todowrite: "todowrite",
  webfetch: "webfetch",
  websearch: "websearch",
  task: "task",
  exitplanmode: "plan_exit",
  askuserquestion: "question",
  // The swarm delegation tool (`mcp__opencodex_swarm__delegate`) is a task in
  // everything but name, so it renders with the normal subtask card. A test
  // pins this against the transport's constant.
  mcpopencodexswarmdelegate: "task",
}

export function normalizeToolName(name: string) {
  const key = name.replace(/[\s_-]/g, "").toLowerCase()
  return TOOL_NAMES[key] ?? name.toLowerCase()
}

/**
 * Claude spells file params `file_path`/`notebook_path`; native tools and the
 * GUI title/detail registries read `filePath`. Mirror of the permission-layer
 * mapping in claude-permission.ts so transcript parts render like native ones.
 * Original keys are kept so nothing reading the raw shape breaks.
 */
export function normalizeToolInput(tool: string, input: Record<string, unknown>): Record<string, unknown> {
  const text = (value: unknown) => (typeof value === "string" ? value : undefined)
  if (tool === "read" || tool === "edit" || tool === "write") {
    const file = text(input.filePath) ?? text(input.file_path) ?? text(input.notebook_path)
    if (file) return { ...input, filePath: file }
  }
  return input
}

export function mapEvent(event: ClaudeEvent, state: MapperState, context: MapperContext): { writes: SessionWrite[]; state: MapperState } {
  const writes: SessionWrite[] = []
  const next: MapperState = { ...state, toolParts: new Map(state.toolParts), textParts: new Map(state.textParts), streamText: new Map(state.streamText), tasks: new Map(state.tasks) }

  if (event.type === "system" && event.subtype === "init") {
    if (typeof event.session_id === "string") next.claudeSessionID = event.session_id
    if (typeof event.model === "string") next.modelID = event.model
    return { writes, state: next }
  }

  if (event.type === "system" && event.subtype === "background_tasks_changed") {
    // Replace semantics per the SDK contract: the payload is every live
    // background task after the change, so a missed edge cannot wedge a
    // stale count.
    next.liveBackgroundTasks = Array.isArray(event.tasks) ? event.tasks.length : 0
    return { writes, state: next }
  }

  // Partial-message events stream text as it is generated. Without them a text
  // block only lands when its whole API message completes - and mid-turn prose
  // has been observed never landing at all (see the 2026-08-09 spec, Part B
  // finding 3), so the deltas are also the recovery path.
  if (event.type === "stream_event" && isRecord(event.event)) {
    const stream = event.event
    if (stream.type === "message_start" && isRecord(stream.message) && typeof stream.message.id === "string") {
      next.apiMessageID = stream.message.id
      return { writes, state: next }
    }
    if (stream.type === "content_block_delta" && typeof stream.index === "number" && isRecord(stream.delta) && next.apiMessageID) {
      const delta =
        stream.delta.type === "text_delta" && typeof stream.delta.text === "string"
          ? { kind: "text" as const, prefix: "text", text: stream.delta.text }
          : stream.delta.type === "thinking_delta" && typeof stream.delta.thinking === "string"
            ? { kind: "reasoning" as const, prefix: "thinking", text: stream.delta.thinking }
            : undefined
      if (delta && delta.text) {
        ensureMessage(writes, next, context)
        const key = `${delta.prefix}:${next.apiMessageID}:${stream.index}`
        const partID = next.textParts.get(key) ?? context.nextPartID()
        next.textParts.set(key, partID)
        const text = (next.streamText.get(key) ?? "") + delta.text
        next.streamText.set(key, text)
        writes.push({
          kind: "part",
          part: {
            id: partID,
            sessionID: context.sessionID,
            messageID: next.messageID!,
            type: delta.kind,
            text,
            time: { start: context.now() },
          },
        })
      }
    }
    return { writes, state: next }
  }

  if (event.type === "assistant" && event.message) {
    if (typeof event.message.model === "string") next.modelID = event.message.model
    if (typeof event.message.id === "string") next.apiMessageID = event.message.id
    if (isRecord(event.message.usage)) next.lastUsage = readUsage(event.message.usage)
    ensureMessage(writes, next, context)
    contentBlocks(event.message.content).forEach((block, position) => {
      mapAssistantBlock(block, position, writes, next, context)
    })
    return { writes, state: next }
  }

  if (event.type === "user" && event.message) {
    for (const block of contentBlocks(event.message.content)) {
      if (block.type !== "tool_result") continue
      mapToolResult(block, writes, next, context)
    }
    return { writes, state: next }
  }

  if (event.type === "result") {
    ensureMessage(writes, next, context)
    finishTurn(event, writes, next, context)
    return { writes, state: next }
  }

  return { writes, state: next }
}

/** Closes an interrupted or crashed turn so no part is left spinning. */
export function finalizeAbandonedTurn(
  state: MapperState,
  context: MapperContext,
  input: { reason: string; error?: string },
): { writes: SessionWrite[]; state: MapperState } {
  const writes: SessionWrite[] = []
  const next: MapperState = { ...state, toolParts: new Map(state.toolParts), textParts: new Map(state.textParts), streamText: new Map(state.streamText), tasks: new Map(state.tasks) }
  // An explicit delivery failure must be visible even when the stream closed
  // before its first event. Error-free aborts retain the existing no-op path.
  if (!next.messageID && !input.error) return { writes, state: next }
  ensureMessage(writes, next, context)
  const messageID = next.messageID!
  const now = context.now()
  for (const [callID, pending] of next.toolParts) {
    writes.push({
      kind: "part",
      part: {
        id: pending.partID,
        sessionID: context.sessionID,
        messageID,
        type: "tool",
        callID,
        tool: pending.tool,
        state: {
          status: "error",
          input: pending.input,
          error: input.error ?? input.reason,
          metadata: { interrupted: true },
          time: { start: pending.start, end: now },
        },
      },
    })
  }
  next.toolParts.clear()
  writes.push(stepFinish(next, context, { reason: input.reason, cost: 0, tokens: emptyTokens() }))
  writes.push({ kind: "message", message: assistantMessage(next, context, { completed: now, error: input.error }) })
  next.finished = true
  return { writes, state: next }
}

/** Opens an assistant message without any Claude event, for failure turns. */
export function startTurn(state: MapperState, context: MapperContext): { writes: SessionWrite[]; state: MapperState } {
  const writes: SessionWrite[] = []
  const next: MapperState = { ...state, toolParts: new Map(state.toolParts), textParts: new Map(state.textParts), streamText: new Map(state.streamText), tasks: new Map(state.tasks) }
  ensureMessage(writes, next, context)
  return { writes, state: next }
}

function ensureMessage(writes: SessionWrite[], state: MapperState, context: MapperContext) {
  if (state.messageID) return
  state.messageID = context.nextMessageID()
  writes.push({ kind: "message", message: assistantMessage(state, context, {}) })
  writes.push({
    kind: "part",
    part: {
      id: context.nextPartID(),
      sessionID: context.sessionID,
      messageID: state.messageID,
      type: "step-start",
    },
  })
}

/**
 * The CLI emits one assistant event per content block, so a block's position in
 * its event rarely matches its streamed index. When the block's full content
 * equals what some stream key already accumulated for this API message, reuse
 * that key - otherwise the final write would open a duplicate part.
 */
function reconciledKey(state: MapperState, prefix: string, content: string, fallback: string) {
  const scope = `${prefix}:${state.apiMessageID ?? "m"}:`
  if (state.textParts.has(fallback)) return fallback
  for (const [key, text] of state.streamText) {
    if (key.startsWith(scope) && text === content && state.textParts.has(key)) return key
  }
  return fallback
}

function mapAssistantBlock(block: ContentBlock, position: number, writes: SessionWrite[], state: MapperState, context: MapperContext) {
  const messageID = state.messageID!
  if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
    const key = reconciledKey(state, "text", block.text, `text:${blockKey(block, state, position)}`)
    const partID = state.textParts.get(key) ?? context.nextPartID()
    state.textParts.set(key, partID)
    writes.push({
      kind: "part",
      part: {
        id: partID,
        sessionID: context.sessionID,
        messageID,
        type: "text",
        text: block.text,
        time: { start: context.now(), end: context.now() },
      },
    })
    return
  }
  if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
    const key = reconciledKey(state, "thinking", block.thinking, `thinking:${blockKey(block, state, position)}`)
    const partID = state.textParts.get(key) ?? context.nextPartID()
    state.textParts.set(key, partID)
    writes.push({
      kind: "part",
      part: {
        id: partID,
        sessionID: context.sessionID,
        messageID,
        type: "reasoning",
        text: block.thinking,
        time: { start: context.now(), end: context.now() },
      },
    })
    return
  }
  if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
    const tool = normalizeToolName(block.name)
    const input = normalizeToolInput(tool, isRecord(block.input) ? block.input : {})
    const partID = state.toolParts.get(block.id)?.partID ?? context.nextPartID()
    const start = state.toolParts.get(block.id)?.start ?? context.now()
    state.toolParts.set(block.id, { partID, tool, input, start })
    writes.push({
      kind: "part",
      part: {
        id: partID,
        sessionID: context.sessionID,
        messageID,
        type: "tool",
        callID: block.id,
        tool,
        state: { status: "running", input, time: { start } },
      },
    })
    if (tool === "todowrite") {
      const todos = readTodos(input)
      if (todos.length > 0) writes.push({ kind: "todos", todos })
    }
  }
}

const READ_PREVIEW_LINES = 20

/**
 * Native tools stamp completed parts with the metadata the transcript renders:
 * reads carry a head-of-file preview, edits carry `metadata.diff` (the ONLY
 * thing the edit card shows). The Claude CLI sends neither, so synthesize both
 * - otherwise an edit expander opens onto nothing but "The file has been
 * updated successfully".
 */
function completedMetadata(tool: string, input: Record<string, unknown>, output: string): Record<string, unknown> {
  if (tool === "edit") return editMetadata(input)
  if (tool !== "read" || !output.trim()) return {}
  const lines = output.split("\n")
  const preview = lines.slice(0, READ_PREVIEW_LINES).join("\n")
  return { preview, ...(lines.length > READ_PREVIEW_LINES ? { truncated: true } : {}) }
}

/**
 * The changed snippet only, mirroring the permission card's diff synthesis in
 * claude-permission.ts - the driver has no business reading the file just to
 * widen the context, and the row links the full path anyway. MultiEdit maps
 * onto `metadata.files` so each edit renders as its own patch block.
 */
function editMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const text = (value: unknown) => (typeof value === "string" ? value : undefined)
  const file = text(input.filePath) ?? text(input.file_path) ?? text(input.notebook_path) ?? "file"
  const before = text(input.old_string) ?? text(input.oldString)
  const after = text(input.new_string) ?? text(input.newString)
  if (before !== undefined && after !== undefined) return { diff: createTwoFilesPatch(file, file, before, after) }
  const edits = Array.isArray(input.edits) ? input.edits.filter(isRecord) : []
  const files = edits.flatMap((edit) => {
    const editBefore = text(edit.old_string) ?? text(edit.oldString)
    const editAfter = text(edit.new_string) ?? text(edit.newString)
    if (editBefore === undefined || editAfter === undefined) return []
    return [{ filePath: file, relativePath: file, patch: createTwoFilesPatch(file, file, editBefore, editAfter) }]
  })
  return files.length > 0 ? { files } : {}
}

export function taskRegistryTodos(state: MapperState) {
  return [...state.tasks.values()].map((task) => ({ content: task.subject, status: task.status, priority: "medium" }))
}

/** Applies a completed task tool to the registry. Returns the projected todos when the registry changed. */
function applyTaskTool(tool: string, input: Record<string, unknown>, output: string, state: MapperState) {
  if (tool === "taskcreate") {
    const parsed = /Task #(\w+) created/.exec(output)?.[1]
    const id = parsed ?? `local-${++state.taskSequence}`
    const subject = typeof input.subject === "string" && input.subject ? input.subject : "Task"
    state.tasks.set(id, { subject, status: "pending" })
    return taskRegistryTodos(state)
  }
  if (tool === "taskupdate") {
    const id = typeof input.taskId === "string" ? input.taskId : typeof input.taskId === "number" ? String(input.taskId) : undefined
    const current = id ? state.tasks.get(id) : undefined
    if (!id || !current) return undefined
    const status = typeof input.status === "string" && input.status ? input.status : current.status
    if (status === "deleted") state.tasks.delete(id)
    else
      state.tasks.set(id, {
        subject: typeof input.subject === "string" && input.subject ? input.subject : current.subject,
        status,
      })
    return taskRegistryTodos(state)
  }
  return undefined
}

function mapToolResult(block: ContentBlock, writes: SessionWrite[], state: MapperState, context: MapperContext) {
  const callID = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined
  if (!callID) return
  const pending = state.toolParts.get(callID)
  if (!pending || !state.messageID) return
  state.toolParts.delete(callID)
  const output = readResultText(block.content)
  const end = context.now()
  const input = normalizeToolInput(pending.tool, context.decidedInput?.(callID) ?? pending.input)
  const todos = block.is_error ? undefined : applyTaskTool(pending.tool, input, output, state)
  writes.push({
    kind: "part",
    part: {
      id: pending.partID,
      sessionID: context.sessionID,
      messageID: state.messageID,
      type: "tool",
      callID,
      tool: pending.tool,
      state: block.is_error
        ? { status: "error", input, error: output || "The tool call failed.", time: { start: pending.start, end } }
        : {
            status: "completed",
            input,
            output,
            title: pending.tool,
            metadata: { ...completedMetadata(pending.tool, input, output), ...(todos ? { todos } : {}) },
            time: { start: pending.start, end },
          },
    },
  })
  if (todos) writes.push({ kind: "todos", todos })
}

function finishTurn(event: ClaudeEvent, writes: SessionWrite[], state: MapperState, context: MapperContext) {
  // A denied tool call (a rejected question, a refused permission) may never
  // stream a tool_result. The turn is over, so anything still open is closed
  // here - otherwise the transcript shows a "Running" timer forever.
  const end = context.now()
  for (const [callID, pending] of state.toolParts) {
    writes.push({
      kind: "part",
      part: {
        id: pending.partID,
        sessionID: context.sessionID,
        messageID: state.messageID!,
        type: "tool",
        callID,
        tool: pending.tool,
        state: {
          status: "error",
          input: pending.input,
          error: "The tool call did not return a result before the turn ended.",
          metadata: { interrupted: true },
          time: { start: pending.start, end },
        },
      },
    })
  }
  state.toolParts.clear()
  const usage = event.usage ?? event.message?.usage ?? {}
  // `total_cost_usd` accumulates over the whole Claude conversation while the
  // projector adds every step-finish into the session total, so only the delta
  // since the previous turn belongs to this one.
  const totalCost = numberOr(event.total_cost_usd, state.billed.cost)
  const cost = Math.max(0, totalCost - state.billed.cost)
  // The result usage sums every API request in the turn - a long tool-using
  // turn re-reads its cached context each step, so summed cache reads run into
  // the millions and read as an impossible context size (the "8.1m (808%)"
  // bug). Message tokens mean "the conversation's current context" everywhere
  // else, which is the LAST request's usage from the assistant events.
  const billed = readUsage(usage)
  const tokens = state.lastUsage ?? billed
  state.billed = {
    cost: totalCost,
    input: billed.input,
    output: billed.output,
    cacheRead: billed.cache.read,
    cacheWrite: billed.cache.write,
  }
  state.turnCost += cost
  const failed = event.is_error === true || (event.subtype !== undefined && event.subtype !== "success")
  const error = failed ? readResultError(event) : undefined
  if (error) state.authFailure = classifyClaudeError(error)
  // A refused resume never reaches `system.init`, so the turn ends without ever
  // naming a conversation. That is the signal to stop reusing the stored id.
  if (failed && !state.claudeSessionID) state.resumeRejected = true
  writes.push(stepFinish(state, context, { reason: event.subtype ?? "stop", cost, tokens }))
  // A successful result with backgrounded subagents still running is a pause,
  // not the end of the turn: the CLI holds the stream open and re-wakes the
  // model when they report back. Bill the step but keep the message - and the
  // session - open, so delegation reads as in-progress instead of idle.
  if (!failed && state.liveBackgroundTasks > 0) return
  writes.push({
    kind: "message",
    message: assistantMessage(state, context, { completed: context.now(), cost: state.turnCost, tokens, error }),
  })
  state.finished = true
}

function stepFinish(
  state: MapperState,
  context: MapperContext,
  input: { reason: string; cost: number; tokens: SessionLegacy.StepFinishPart["tokens"] },
): SessionWrite {
  return {
    kind: "part",
    part: {
      id: context.nextPartID(),
      sessionID: context.sessionID,
      messageID: state.messageID!,
      type: "step-finish",
      reason: input.reason,
      cost: input.cost,
      tokens: input.tokens,
    },
  }
}

function assistantMessage(
  state: MapperState,
  context: MapperContext,
  input: { completed?: number; cost?: number; tokens?: SessionLegacy.StepFinishPart["tokens"]; error?: string },
): SessionLegacy.Assistant {
  // A sign-in failure is labelled as the auth error both clients already know
  // how to render with a recovery action; everything else stays unknown.
  const error = state.authFailure
    ? { name: "ProviderAuthError" as const, data: { providerID: context.providerID, message: state.authFailure.message } }
    : input.error
      ? { name: "UnknownError" as const, data: { message: input.error } }
      : undefined
  return {
    id: state.messageID!,
    sessionID: context.sessionID,
    role: "assistant",
    time: { created: context.now(), ...(input.completed === undefined ? {} : { completed: input.completed }) },
    parentID: context.parentMessageID,
    modelID: context.modelID,
    providerID: context.providerID,
    mode: "claude-code",
    agent: "claude-code",
    path: { cwd: context.directory, root: context.directory },
    cost: input.cost ?? 0,
    tokens: input.tokens ?? emptyTokens(),
    ...(error ? { error } : {}),
  } as SessionLegacy.Assistant
}

function emptyTokens() {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
}

function readUsage(usage: ClaudeUsage) {
  return {
    input: Math.max(0, numberOr(usage.input_tokens, 0)),
    output: Math.max(0, numberOr(usage.output_tokens, 0)),
    reasoning: 0,
    cache: {
      read: Math.max(0, numberOr(usage.cache_read_input_tokens, 0)),
      write: Math.max(0, numberOr(usage.cache_creation_input_tokens, 0)),
    },
  }
}

type ContentBlock = {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
  index?: number
}

function contentBlocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }]
  if (!Array.isArray(content)) return []
  return content.filter((block): block is ContentBlock => isRecord(block))
}

/**
 * Blocks have no stable id, so the API message id plus the block's position
 * within it identifies them - across re-emissions and across the stream-delta
 * and final-event paths, which must land on the same part.
 */
function blockKey(block: ContentBlock, state: MapperState, position: number) {
  const index = typeof block.index === "number" ? block.index : position
  return `${state.apiMessageID ?? "m"}:${index}`
}

function readResultText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : typeof item === "string" ? item : ""))
      .filter(Boolean)
      .join("\n")
  }
  if (isRecord(content) && typeof content.text === "string") return content.text
  return ""
}

/** Claude's own subtypes are opaque to a reader; say what actually happened. */
const RESULT_ERRORS: Record<string, string> = {
  error_during_execution:
    "Claude Code could not continue this conversation. Sending another message starts a fresh one.",
  error_max_turns: "Claude Code reached its turn limit for this request.",
}

function readResultError(event: ClaudeEvent) {
  if (typeof event.result === "string" && event.result.trim()) return event.result.trim()
  if (typeof event.subtype === "string" && event.subtype !== "success") {
    return RESULT_ERRORS[event.subtype] ?? `Claude Code stopped: ${event.subtype}`
  }
  return "Claude Code reported an error."
}

function readTodos(input: Record<string, unknown>) {
  const todos = Array.isArray(input.todos) ? input.todos : []
  return todos.filter(isRecord).map((todo) => ({
    content: typeof todo.content === "string" ? todo.content : typeof todo.activeForm === "string" ? todo.activeForm : "Todo",
    status: typeof todo.status === "string" ? todo.status : "pending",
    priority: typeof todo.priority === "string" ? todo.priority : "medium",
  }))
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export * as ClaudeMapper from "./claude-mapper"

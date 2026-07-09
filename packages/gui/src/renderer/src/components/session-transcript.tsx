import type { Part } from "@opencode-ai/sdk/v2/client"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js"
import { CodeBlock } from "@opencode-ai/ui/code-block"
import { File as FileDiffView } from "@opencode-ai/ui/file"
import { Markdown } from "@opencode-ai/ui/markdown"
import type { MessageBundle } from "../lib/store"
import {
  arrayValue,
  collapseDiffOutput,
  collapseLineOutput,
  field,
  formatTodoStatus,
  formatToolValue,
  isRecordValue,
  languageFromPath,
  numberValue,
  patchContents,
  shouldShowRawToolData,
  stringValue,
  todoStatusIcon,
  toolDisplayTitle,
  toolError,
  toolHasVisibleDetails,
  toolMetadata,
  toolOutput,
  toolPatchTitle,
  toolStateInput,
  toolVisibleOutput,
} from "../lib/tool-display"
import { DisclosureChevron, Icon } from "./icon"

export type ToolPart = Extract<Part, { type: "tool" }>
type ReasoningPart = Extract<Part, { type: "reasoning" }>
export type DisplayPart = { type: "part"; part: Part } | { type: "tool-group"; tool: string; parts: ToolPart[] } | { type: "reasoning-group"; parts: ReasoningPart[] }

export function groupTranscriptParts(parts: Part[]): DisplayPart[] {
  const result: DisplayPart[] = []
  let pendingTools: ToolPart[] = []
  let pendingReasoning: ReasoningPart[] = []

  function flushTools() {
    if (pendingTools.length === 0) return
    if (pendingTools.length === 1) result.push({ type: "part", part: pendingTools[0] })
    else result.push({ type: "tool-group", tool: pendingTools[0].tool, parts: pendingTools })
    pendingTools = []
  }

  function flushReasoning() {
    if (pendingReasoning.length === 0) return
    if (pendingReasoning.length === 1) result.push({ type: "part", part: pendingReasoning[0] })
    else result.push({ type: "reasoning-group", parts: pendingReasoning })
    pendingReasoning = []
  }

  for (const part of parts) {
    if (part.type === "tool" && isGroupableTool(part.tool)) {
      flushReasoning()
      if (pendingTools.length === 0 || pendingTools[0].tool === part.tool) {
        pendingTools.push(part)
        continue
      }
    }
    if (part.type === "reasoning") {
      flushTools()
      pendingReasoning.push(part)
      continue
    }
    flushTools()
    flushReasoning()
    result.push({ type: "part", part })
  }
  flushTools()
  flushReasoning()
  return result
}

export function DisplayPartView(props: { item: DisplayPart; showThinking: boolean; showToolDetails: boolean; showGenericToolOutput: boolean }) {
  return (
    <Switch>
      <Match when={props.item.type === "tool-group"}>
        <ToolGroupView item={props.item as Extract<DisplayPart, { type: "tool-group" }>} />
      </Match>
      <Match when={props.item.type === "reasoning-group"}>
        <ThinkingGroupView item={props.item as Extract<DisplayPart, { type: "reasoning-group" }>} showThinking={props.showThinking} />
      </Match>
      <Match when={props.item.type === "part"}>
        <PartView
          part={(props.item as Extract<DisplayPart, { type: "part" }>).part}
          showThinking={props.showThinking}
          showToolDetails={props.showToolDetails}
          showGenericToolOutput={props.showGenericToolOutput}
        />
      </Match>
    </Switch>
  )
}

function isGroupableTool(tool: string) {
  return tool === "read" || tool === "grep" || tool === "glob" || tool === "webfetch" || tool === "websearch" || tool === "skill"
}

function ThinkingGroupView(props: { item: Extract<DisplayPart, { type: "reasoning-group" }>; showThinking: boolean }) {
  const visibleParts = createMemo(() => props.item.parts.filter((part) => part.text.trim()))
  return (
    <Show when={visibleParts().length > 0}>
      <div class="part text reasoning">
        <details class="thinking-block" open>
          <summary>
            <DisclosureChevron />
            <span>Thinking</span>
          </summary>
          <Show when={props.showThinking}>
            <div class="thinking-segments">
              <For each={visibleParts()}>
                {(part, index) => (
                  <section class="thinking-segment">
                    <header>Thinking {index() + 1}</header>
                    <Markdown text={part.text.trim()} cacheKey={part.id} streaming={false} />
                  </section>
                )}
              </For>
            </div>
          </Show>
        </details>
      </div>
    </Show>
  )
}

function ToolGroupView(props: { item: Extract<DisplayPart, { type: "tool-group" }> }) {
  const status = createMemo(() => toolGroupStatus(props.item.parts))
  const startCollapsed = createMemo(() => props.item.tool === "read" && props.item.parts.length > 10)
  const [expanded, setExpanded] = createSignal(!startCollapsed())
  const statusLabel = createMemo(() => startCollapsed() && !expanded() ? "Click to expand" : status() === "completed" ? "" : status())
  return (
    <details class={`part tool tool-group ${status()}`} open={expanded()} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        <DisclosureChevron />
        <strong>{toolGroupTitle(props.item.tool, props.item.parts)}</strong>
        <Show when={statusLabel()}>
          {(label) => <span class="tool-status">{label()}</span>}
        </Show>
      </summary>
      <Show when={expanded()}>
        <div class="tool-group-list">
          <For each={props.item.parts}>
            {(part) => {
              const input = toolStateInput(part.state)
              const metadata = toolMetadata(part.state) ?? {}
              return (
                <div class="tool-group-item">
                  <span>{toolDisplayTitle(part.tool, input, metadata, part.state.status)}</span>
                  <Show when={part.state.status !== "completed"}>
                    <small>{part.state.status}</small>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </details>
  )
}

function toolGroupStatus(parts: ToolPart[]) {
  if (parts.some((part) => part.state.status === "error")) return "error"
  if (parts.some((part) => part.state.status === "running")) return "running"
  if (parts.every((part) => part.state.status === "completed")) return "completed"
  return parts.at(-1)?.state.status ?? "pending"
}

function toolGroupTitle(tool: string, parts: ToolPart[]) {
  if (tool === "read") return `Read ${parts.length} files`
  if (tool === "grep") return `Grep ${parts.length} searches`
  if (tool === "glob") return `Glob ${parts.length} searches`
  if (tool === "webfetch") return `WebFetch ${parts.length} URLs`
  if (tool === "websearch") return `WebSearch ${parts.length} queries`
  if (tool === "skill") return `Loaded ${parts.length} skills`
  return `${tool} x${parts.length}`
}

function PartView(props: { part: MessageBundle["parts"][number]; showThinking: boolean; showToolDetails: boolean; showGenericToolOutput: boolean }) {
  return (
    <Switch fallback={<pre class="part muted">{JSON.stringify(props.part, null, 2)}</pre>}>
      <Match when={isStructuralPart(props.part)}>
        <></>
      </Match>
      <Match when={props.part.type === "text" || props.part.type === "reasoning"}>
        <TextPartView
          part={props.part as Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }>}
          showThinking={props.showThinking}
        />
      </Match>
      <Match when={props.part.type === "tool"}>
        <ToolPartView part={props.part as ToolPart} showDetails={props.showToolDetails} showGenericOutput={props.showGenericToolOutput} />
      </Match>
      <Match when={props.part.type === "file"}>
        <div class="part file" data-side-panel-file={props.part.type === "file" ? props.part.filename ?? props.part.url : ""}>File: {props.part.type === "file" ? props.part.filename ?? props.part.url : ""}</div>
      </Match>
      <Match when={props.part.type === "agent"}>
        <div class="part badge">Agent: {props.part.type === "agent" ? props.part.name : ""}</div>
      </Match>
      <Match when={props.part.type === "patch"}>
        <div class="part badge">Patch: {props.part.type === "patch" ? props.part.files.join(", ") : ""}</div>
      </Match>
      <Match when={props.part.type === "compaction"}>
        <div class="part badge">Compaction {props.part.type === "compaction" && props.part.auto ? "auto" : "manual"}</div>
      </Match>
    </Switch>
  )
}

function isStructuralPart(part: MessageBundle["parts"][number]) {
  return part.type === "step-start" || part.type === "step-finish" || part.type === "snapshot" || part.type === "retry" || part.type === "subtask"
}

function TextPartView(props: { part: Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }>; showThinking: boolean }) {
  const text = createMemo(() => {
    if ("synthetic" in props.part && props.part.synthetic) return ""
    if ("ignored" in props.part && props.part.ignored) return ""
    return props.part.text.trim()
  })
  return (
    <Show when={text()}>
      <div class={`part text ${props.part.type}`}>
        <Show when={props.part.type === "reasoning"} fallback={<Markdown text={text()} cacheKey={props.part.id} streaming={false} />}>
          <details class="thinking-block" open>
            <summary>
              <DisclosureChevron />
              <span>Thinking</span>
            </summary>
            <Show when={props.showThinking}>
              <Markdown text={text()} cacheKey={props.part.id} streaming={false} />
            </Show>
          </details>
        </Show>
      </div>
    </Show>
  )
}

function ToolPartView(props: { part: ToolPart; showDetails: boolean; showGenericOutput: boolean }) {
  const state = () => props.part.state
  const toolClass = () => props.part.tool === "todowrite" ? "todo-update" : props.part.tool === "apply_patch" ? "patch-update" : ""
  const input = createMemo(() => toolStateInput(state()))
  const metadata = createMemo(() => toolMetadata(state()) ?? {})
  const error = createMemo(() => toolError(state()))
  const output = createMemo(() => toolVisibleOutput(props.part.tool, state(), metadata()))
  const title = createMemo(() => toolDisplayTitle(props.part.tool, input(), metadata(), state().status))
  const patchSummary = createMemo(() => props.part.tool === "apply_patch" ? patchSummaryFiles(metadata()) : "")
  const patchPending = createMemo(() => props.part.tool === "apply_patch" && state().status !== "completed" && state().status !== "error" && !patchHasDiff(metadata()))
  const statusLabel = createMemo(() => state().status === "completed" ? "" : state().status)
  const hasDetails = createMemo(() => patchPending() || toolHasVisibleDetails(props.part.tool, input(), metadata(), output(), error()))
  const visibleDetails = createMemo(() => props.showDetails && hasDetails())
  const defaultOpen = createMemo(() => visibleDetails() && (props.part.tool === "todowrite" || props.part.tool === "apply_patch" || state().status === "running" || state().status === "error"))
  const [expanded, setExpanded] = createSignal(defaultOpen())
  createEffect(() => {
    if (defaultOpen()) setExpanded(true)
  })
  return (
    <Show when={visibleDetails()} fallback={
      <div class={`part tool ${state().status} ${toolClass()} no-details`}>
        <div class="tool-summary">
          <strong>{title()}</strong>
          <Show when={statusLabel()}>
            {(label) => <span class="tool-status">{label()}</span>}
          </Show>
        </div>
      </div>
    }>
      <details class={`part tool ${state().status} ${toolClass()}`} open={expanded()} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>
          <DisclosureChevron />
          <strong>{title()}</strong>
          <Show when={patchSummary()}>
            {(summary) => <span class="tool-patch-files">{summary()}</span>}
          </Show>
          <Show when={statusLabel()}>
            {(label) => <span class="tool-status">{label()}</span>}
          </Show>
        </summary>
        <Show when={expanded()}>
          <ToolDetails tool={props.part.tool} input={input()} metadata={metadata()} output={output()} error={error()} showGenericOutput={props.showGenericOutput} patchPending={patchPending()} />
          <Show when={shouldShowRawToolData(props.part.tool, input(), metadata())}>
            <details class="tool-raw">
              <summary>
                <DisclosureChevron />
                <span>Raw tool data</span>
              </summary>
              <Show when={Object.keys(input()).length > 0}>
                <label>Input</label>
                <ToolCodeBlock language="json" code={JSON.stringify(input(), null, 2)} />
              </Show>
              <Show when={Object.keys(metadata()).length > 0}>
                <label>Metadata</label>
                <ToolCodeBlock language="json" code={JSON.stringify(metadata(), null, 2)} />
              </Show>
            </details>
          </Show>
        </Show>
      </details>
    </Show>
  )
}

function patchSummaryFiles(metadata: Record<string, unknown>) {
  const files = arrayValue(metadata.files).filter(isRecordValue)
  if (files.length === 0) return ""
  return files
    .map((file) => stringValue(file.relativePath) ?? stringValue(file.filePath) ?? stringValue(file.movePath))
    .map((file) => fileBasename(file ?? ""))
    .filter((file): file is string => Boolean(file))
    .join(", ")
}

function patchHasDiff(metadata: Record<string, unknown>) {
  if (stringValue(metadata.diff)) return true
  return arrayValue(metadata.files).filter(isRecordValue).some((file) => stringValue(file.patch) || stringValue(file.type) === "delete")
}

function fileBasename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function ToolDetails(props: { tool: string; input: Record<string, unknown>; metadata: Record<string, unknown>; output: string; error?: string; showGenericOutput: boolean; patchPending?: boolean }) {
  const diagnostics = createMemo(() => arrayValue(props.metadata.diagnostics))
  return (
    <div class="tool-details">
      <Switch fallback={<GenericToolDetails input={props.input} metadata={props.metadata} output={props.showGenericOutput ? props.output : ""} error={props.error} />}>
        <Match when={props.tool === "bash" || props.tool === "shell"}>
          <ToolShellBlock command={stringValue(props.input.command)} output={props.output} />
        </Match>
        <Match when={props.tool === "grep" || props.tool === "glob"}>
          <ToolOutput output={props.output} maxLines={15} compact />
        </Match>
        <Match when={props.tool === "read"}>
          <></>
        </Match>
        <Match when={props.tool === "write"}>
          <Show when={stringValue(props.input.content)}>
            {(content) => <ToolCodeBlock class="tool-code" language={languageFromPath(stringValue(props.input.filePath))} code={content()} />}
          </Show>
          <ToolDiagnostics diagnostics={diagnostics()} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "edit"}>
          <ToolDiffs input={props.input} metadata={props.metadata} />
          <ToolDiagnostics diagnostics={diagnostics()} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "apply_patch"}>
          <Show when={props.patchPending} fallback={<ToolDiffs input={props.input} metadata={props.metadata} collapsibleFiles />}>
            <PatchPendingDiff />
          </Show>
          <ToolDiagnostics diagnostics={diagnostics()} />
        </Match>
        <Match when={props.tool === "todowrite"}>
          <ToolTodos input={props.input} metadata={props.metadata} />
        </Match>
        <Match when={props.tool === "question"}>
          <ToolQuestions input={props.input} metadata={props.metadata} />
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "task"}>
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "webfetch" || props.tool === "websearch"}>
          <ToolOutput output={props.output} />
        </Match>
        <Match when={props.tool === "skill"}>
          <ToolOutput output={props.output} />
        </Match>
      </Switch>
      <Show when={props.error}>
        {(error) => <pre class="tool-error">{error()}</pre>}
      </Show>
    </div>
  )
}

function PatchPendingDiff() {
  return (
    <div class="tool-pending-diff" aria-live="polite" aria-busy="true">
      <span class="tool-pending-text">Thinking through patch diff</span>
    </div>
  )
}

function ToolShellBlock(props: { command?: string; output: string }) {
  return (
    <>
      <Show when={props.command}>
        {(command) => <pre class="tool-command">$ {command()}</pre>}
      </Show>
      <ToolOutput output={props.output} />
    </>
  )
}

function GenericToolDetails(props: { input: Record<string, unknown>; metadata: Record<string, unknown>; output: string; error?: string }) {
  return (
    <>
      <ToolKeyValues values={Object.entries(props.input).slice(0, 8).map(([key, value]) => field(key, value))} />
      <ToolOutput output={props.output} />
    </>
  )
}

function ToolKeyValues(props: { values: Array<{ label: string; value: unknown }> }) {
  const values = createMemo(() => props.values.filter((item) => item.value !== undefined && item.value !== null && item.value !== ""))
  return (
    <Show when={values().length > 0}>
      <dl class="tool-kv">
        <For each={values()}>
          {(item) => (
            <div>
              <dt>{item.label}</dt>
              <dd>{formatToolValue(item.value)}</dd>
            </div>
          )}
        </For>
      </dl>
    </Show>
  )
}

function ToolOutput(props: { output: string; maxLines?: number; compact?: boolean }) {
  const [expanded, setExpanded] = createSignal(false)
  const trimmed = createMemo(() => props.output.trim())
  const collapsed = createMemo(() => props.maxLines ? collapseLineOutput(trimmed(), props.maxLines) : collapseDiffOutput(trimmed()))
  const visible = createMemo(() => expanded() || !collapsed().overflow ? trimmed() : collapsed().output)
  const visibleParts = createMemo(() => linkToolOutput(visible()))
  return (
    <Show when={trimmed()}>
      <div class="tool-output" classList={{ compact: props.compact === true }}>
        <pre>
          <For each={visibleParts()}>
            {(part) => part.href ? <a href={part.href}>{part.text}</a> : part.text}
          </For>
        </pre>
        <Show when={collapsed().overflow}>
          <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded() ? "Click to collapse" : "Click to expand"}</button>
        </Show>
      </div>
    </Show>
  )
}

function linkToolOutput(value: string) {
  const pattern = /(?:https?:\/\/|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?|\[::1\](?::\d+)?)(?:\/[^\s<>"'`]*)?/gi
  const parts: Array<{ text: string; href?: string }> = []
  let index = 0
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0
    const raw = match[0]
    const stripped = raw.replace(/[),.;:!?]+$/, "")
    if (start > index) parts.push({ text: value.slice(index, start) })
    parts.push({ text: stripped, href: /^https?:\/\//i.test(stripped) ? stripped : `http://${stripped}` })
    const trailing = raw.slice(stripped.length)
    if (trailing) parts.push({ text: trailing })
    index = start + raw.length
  }
  if (index < value.length) parts.push({ text: value.slice(index) })
  return parts
}

function ToolCodeBlock(props: { code: string; language?: string; class?: string }) {
  return <CodeBlock class={props.class} language={props.language || "text"} code={props.code} />
}

function ToolDiffs(props: { input: Record<string, unknown>; metadata: Record<string, unknown>; collapsibleFiles?: boolean }) {
  const files = createMemo(() => arrayValue(props.metadata.files).filter(isRecordValue))
  const collapsible = createMemo(() => props.collapsibleFiles === true && files().length > 1)
  return (
    <>
      <Show when={files().length === 0 ? stringValue(props.metadata.diff) : undefined}>
        {(diff) => <ToolDiff title={stringValue(props.input.filePath) ?? "patch"} diff={diff()} filePath={stringValue(props.input.filePath)} />}
      </Show>
      <For each={files()}>
        {(file) => {
          const patch = stringValue(file.patch)
          const name = stringValue(file.relativePath) ?? stringValue(file.filePath) ?? stringValue(file.movePath) ?? "file"
          const filePath = stringValue(file.filePath) ?? stringValue(file.movePath) ?? name
          const type = stringValue(file.type)
          return (
            <Show when={patch || type === "delete"}>
              <Show when={patch} fallback={<ToolDeletedLines title={toolPatchTitle(type, name, file)} filePath={filePath} deletions={numberValue(file.deletions) ?? 0} collapsible={collapsible()} />}>
                {(diff) => <ToolDiff title={toolPatchTitle(type, name, file)} diff={diff()} filePath={filePath} collapsible={collapsible()} />}
              </Show>
            </Show>
          )
        }}
      </For>
    </>
  )
}

function ToolDiff(props: { title: string; diff: string; filePath?: string; collapsible?: boolean }) {
  const contents = createMemo(() => patchContents(props.diff, props.filePath ?? props.title))
  const [expanded, setExpanded] = createSignal(true)
  const body = () => (
    <div class="tool-unified-patch">
      <Show when={contents()} fallback={<ToolCodeBlock language="diff" code={props.diff} />}>
        {(value) => (
          <FileDiffView
            mode="diff"
            before={value().before}
            after={value().after}
            diffStyle="unified"
            overflow="scroll"
            virtualize={false}
            hunkSeparators="simple"
          />
        )}
      </Show>
    </div>
  )
  return (
    <section class="tool-diff">
      <Show when={props.collapsible} fallback={<><ToolDiffHeader title={props.title} filePath={props.filePath} />{body()}</>}>
        <details class="tool-file-diff-collapse" open={expanded()} onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary class="tool-file-diff-header">
            <ToolDiffHeaderContent title={props.title} filePath={props.filePath} disclosure />
          </summary>
          <Show when={expanded()}>
            {body()}
          </Show>
        </details>
      </Show>
    </section>
  )
}

function ToolDeletedLines(props: { title: string; filePath?: string; deletions: number; collapsible?: boolean }) {
  const [expanded, setExpanded] = createSignal(true)
  const body = () => <p class="tool-deleted-lines">-{props.deletions} line{props.deletions === 1 ? "" : "s"}</p>
  return (
    <section class="tool-diff">
      <Show when={props.collapsible} fallback={<div class="tool-file-diff"><ToolDiffHeader title={props.title} filePath={props.filePath} />{body()}</div>}>
        <details class="tool-file-diff-collapse" open={expanded()} onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary class="tool-file-diff-header">
            <ToolDiffHeaderContent title={props.title} filePath={props.filePath} disclosure />
          </summary>
          <Show when={expanded()}>
            {body()}
          </Show>
        </details>
      </Show>
    </section>
  )
}

function ToolDiffHeader(props: { title: string; filePath?: string }) {
  return <header class="tool-file-diff-header"><ToolDiffHeaderContent title={props.title} filePath={props.filePath} /></header>
}

function ToolDiffHeaderContent(props: { title: string; filePath?: string; disclosure?: boolean }) {
  const path = createMemo(() => props.filePath ?? props.title)
  const filename = createMemo(() => fileBasename(path()))
  return (
    <>
      <Show when={props.disclosure}>
        <DisclosureChevron />
      </Show>
      <strong>{filename()}</strong>
      <Show when={path() !== filename()}>
        <span class="tool-file-diff-separator">|</span>
        <span class="tool-file-diff-path">{path()}</span>
      </Show>
      <div class="tool-file-diff-actions" aria-label={`Open ${filename()}`}>
        <button
          type="button"
          class="tool-file-diff-action git"
          title={`Open ${filename()} in Git`}
          aria-label={`Open ${filename()} in Git`}
          data-side-panel-git-file={path()}
          onClick={(event) => event.preventDefault()}
        >
          <Icon name="branch" />
        </button>
        <button
          type="button"
          class="tool-file-diff-action file"
          title={`Open ${filename()} as file`}
          aria-label={`Open ${filename()} as file`}
          data-side-panel-open-file={path()}
          onClick={(event) => event.preventDefault()}
        >
          <Icon name="file" />
        </button>
      </div>
    </>
  )
}

function ToolDiagnostics(props: { diagnostics: unknown[] }) {
  return (
    <Show when={props.diagnostics.length > 0}>
      <div class="tool-diagnostics">
        <ToolCodeBlock language="json" code={JSON.stringify(props.diagnostics, null, 2)} />
      </div>
    </Show>
  )
}

function ToolTodos(props: { input: Record<string, unknown>; metadata: Record<string, unknown> }) {
  const todos = createMemo(() => arrayValue(props.metadata.todos).length > 0 ? arrayValue(props.metadata.todos) : arrayValue(props.input.todos))
  return (
    <Show when={todos().length > 0}>
      <div class="tool-todos">
        <For each={todos().filter(isRecordValue)}>
          {(todo) => {
            const status = stringValue(todo.status) ?? "pending"
            return (
              <div class={`tool-todo ${status}`}>
                <span class="tool-todo-status" title={formatTodoStatus(status)} aria-label={formatTodoStatus(status)}>
                  <Show when={todoStatusIcon(status)}>
                    {(icon) => <Icon name={icon()} />}
                  </Show>
                </span>
                <strong>{stringValue(todo.content) ?? "Todo"}</strong>
                <small>{stringValue(todo.priority) ?? ""}</small>
              </div>
            )
          }}
        </For>
      </div>
    </Show>
  )
}

function ToolQuestions(props: { input: Record<string, unknown>; metadata: Record<string, unknown> }) {
  const questions = createMemo(() => arrayValue(props.input.questions).filter(isRecordValue))
  const answers = createMemo(() => arrayValue(props.metadata.answers))
  return (
    <Show when={questions().length > 0}>
      <div class="tool-questions">
        <For each={questions()}>
          {(question, index) => <div><strong>{stringValue(question.question) ?? stringValue(question.header) ?? "Question"}</strong><p>{formatToolValue(answers()[index()] ?? "No answer")}</p></div>}
        </For>
      </div>
    </Show>
  )
}

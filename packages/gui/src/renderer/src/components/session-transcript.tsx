import type { Part, PermissionRequest, QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js"
import { CodeBlock } from "@opencode-ai/ui/code-block"
import { File as FileDiffView } from "@opencode-ai/ui/file"
import { Markdown } from "@opencode-ai/ui/markdown"
import type { MessageBundle } from "../lib/store"
import {
  arrayValue,
  collapseDiffOutput,
  collapseLineOutput,
  collapseOutput,
  field,
  formatTodoStatus,
  formatToolValue,
  isRecordValue,
  languageFromPath,
  numberValue,
  patchContents,
  permissionDiff,
  permissionTitle,
  shouldShowRawToolData,
  stringValue,
  todoStatusIcon,
  toolDisplayTitle,
  toolError,
  toolHasVisibleDetails,
  toolInput,
  toolMetadata,
  toolOutput,
  toolPatchTitle,
  toolStateInput,
  toolVisibleOutput,
} from "../lib/tool-display"
import { DisclosureChevron, Icon } from "./icon"

export type ToolPart = Extract<Part, { type: "tool" }>
export type DisplayPart = { type: "part"; part: Part } | { type: "tool-group"; tool: string; parts: ToolPart[] }

export function PermissionPanel(props: { request: PermissionRequest; tool?: ToolPart; reply: (request: PermissionRequest, reply: "once" | "always" | "reject") => void }) {
  const input = () => toolInput(props.request, props.tool)
  return (
    <section class="safety-panel permission-panel">
      <div>
        <p class="eyebrow">Permission Required</p>
        <h2>{permissionTitle(props.request, input())}</h2>
        <Show when={props.request.patterns.length > 0}>
          <p>Patterns: {props.request.patterns.join(", ")}</p>
        </Show>
        <Show when={props.tool}>
          {(tool) => (
            <details class="permission-context" open>
              <summary>Tool Context: {tool().tool}</summary>
              <Show when={Object.keys(input()).length > 0}>
                <pre>{JSON.stringify(input(), null, 2)}</pre>
              </Show>
              <Show when={toolOutput(tool().state)}>
                {(output) => <pre>{collapseOutput(output()).output}</pre>}
              </Show>
              <Show when={toolError(tool().state)}>
                {(error) => <pre>{error()}</pre>}
              </Show>
            </details>
          )}
        </Show>
        <Show when={permissionDiff(props.request)}>
          {(diff) => (
            <details class="permission-context" open>
              <summary>Requested Diff</summary>
              <pre>{diff()}</pre>
            </details>
          )}
        </Show>
        <Show when={Object.keys(props.request.metadata).length > 0}>
          <details class="permission-context">
            <summary>Raw Metadata</summary>
            <pre>{JSON.stringify(props.request.metadata, null, 2)}</pre>
          </details>
        </Show>
      </div>
      <div class="safety-actions">
        <button class="secondary danger" onClick={() => props.reply(props.request, "reject")}>Reject</button>
        <button class="secondary" onClick={() => props.reply(props.request, "once")}>Allow Once</button>
        <button class="primary" onClick={() => props.reply(props.request, "always")}>Always Allow</button>
      </div>
    </section>
  )
}

export function QuestionPanel(props: { request: QuestionRequest; reply: (request: QuestionRequest, answers: QuestionAnswer[]) => void; reject: (request: QuestionRequest) => void }) {
  const [answers, setAnswers] = createSignal<QuestionAnswer[]>(props.request.questions.map(() => []))
  const [custom, setCustom] = createSignal<string[]>(props.request.questions.map(() => ""))
  const finalAnswers = () =>
    answers().map((answer, index) => {
      const text = custom()[index]?.trim()
      if (!text) return answer
      return [...answer, text]
    })
  const valid = () => finalAnswers().every((answer) => answer.length > 0)
  function toggle(index: number, label: string, multiple?: boolean) {
    setAnswers((current) =>
      current.map((answer, i) => {
        if (i !== index) return answer
        if (!multiple) return [label]
        if (answer.includes(label)) return answer.filter((item) => item !== label)
        return [...answer, label]
      }),
    )
  }
  function updateCustom(index: number, value: string) {
    setCustom((current) => current.map((item, i) => (i === index ? value : item)))
  }
  return (
    <section class="safety-panel question-panel">
      <div>
        <p class="eyebrow">Question Pending</p>
        <For each={props.request.questions}>
          {(question, index) => (
            <div class="question-block">
              <h2>{question.header}</h2>
              <p>{question.question}</p>
              <div class="option-list">
                <For each={question.options}>
                  {(option) => (
                    <button
                      classList={{ selected: answers()[index()].includes(option.label) }}
                      onClick={() => toggle(index(), option.label, question.multiple)}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.description}</span>
                    </button>
                  )}
                </For>
              </div>
              <Show when={question.custom !== false}>
                <input
                  class="custom-answer"
                  value={custom()[index()] ?? ""}
                  onInput={(event) => updateCustom(index(), event.currentTarget.value)}
                  placeholder="Type a custom answer"
                />
              </Show>
            </div>
          )}
        </For>
      </div>
      <div class="safety-actions">
        <button class="secondary danger" onClick={() => props.reject(props.request)}>Reject</button>
        <button class="primary" disabled={!valid()} onClick={() => props.reply(props.request, finalAnswers())}>Reply</button>
      </div>
    </section>
  )
}

export function groupTranscriptParts(parts: Part[]): DisplayPart[] {
  const result: DisplayPart[] = []
  let pending: ToolPart[] = []

  function flush() {
    if (pending.length === 0) return
    if (pending.length === 1) result.push({ type: "part", part: pending[0] })
    else result.push({ type: "tool-group", tool: pending[0].tool, parts: pending })
    pending = []
  }

  for (const part of parts) {
    if (part.type === "tool" && isGroupableTool(part.tool)) {
      if (pending.length === 0 || pending[0].tool === part.tool) {
        pending.push(part)
        continue
      }
    }
    flush()
    result.push({ type: "part", part })
  }
  flush()
  return result
}

export function DisplayPartView(props: { item: DisplayPart; showThinking: boolean }) {
  return (
    <Switch>
      <Match when={props.item.type === "tool-group"}>
        <ToolGroupView item={props.item as Extract<DisplayPart, { type: "tool-group" }>} />
      </Match>
      <Match when={props.item.type === "part"}>
        <PartView part={(props.item as Extract<DisplayPart, { type: "part" }>).part} showThinking={props.showThinking} />
      </Match>
    </Switch>
  )
}

function isGroupableTool(tool: string) {
  return tool === "read" || tool === "grep" || tool === "glob" || tool === "webfetch" || tool === "websearch" || tool === "skill"
}

function ToolGroupView(props: { item: Extract<DisplayPart, { type: "tool-group" }> }) {
  const status = createMemo(() => toolGroupStatus(props.item.parts))
  const startCollapsed = createMemo(() => props.item.tool === "read" && props.item.parts.length > 10)
  const [expanded, setExpanded] = createSignal(!startCollapsed())
  return (
    <details class={`part tool tool-group ${status()}`} open={expanded()} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        <DisclosureChevron />
        <strong>{toolGroupTitle(props.item.tool, props.item.parts)}</strong>
        <span class="tool-status">{startCollapsed() && !expanded() ? "Click to expand" : status()}</span>
      </summary>
      <Show when={expanded()}>
        <div class="tool-group-list">
          <For each={props.item.parts}>
            {(part) => {
              const input = toolStateInput(part.state)
              const metadata = toolMetadata(part.state) ?? {}
              return (
                <div class="tool-group-item">
                  <span>{toolDisplayTitle(part.tool, input, metadata)}</span>
                  <small>{part.state.status}</small>
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

function PartView(props: { part: MessageBundle["parts"][number]; showThinking: boolean }) {
  return (
    <Switch fallback={<pre class="part muted">{JSON.stringify(props.part, null, 2)}</pre>}>
      <Match when={isStructuralPart(props.part)}>
        <></>
      </Match>
      <Match when={props.part.type === "text" || props.part.type === "reasoning"}>
        <TextPartView part={props.part as Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }>} showThinking={props.showThinking} />
      </Match>
      <Match when={props.part.type === "tool"}>
        <ToolPartView part={props.part as ToolPart} />
      </Match>
      <Match when={props.part.type === "file"}>
        <div class="part file">File: {props.part.type === "file" ? props.part.filename ?? props.part.url : ""}</div>
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

function ToolPartView(props: { part: ToolPart }) {
  const state = () => props.part.state
  const toolClass = () => props.part.tool === "todowrite" ? "todo-update" : ""
  const input = createMemo(() => toolStateInput(state()))
  const metadata = createMemo(() => toolMetadata(state()) ?? {})
  const error = createMemo(() => toolError(state()))
  const output = createMemo(() => toolVisibleOutput(props.part.tool, state(), metadata()))
  const title = createMemo(() => toolDisplayTitle(props.part.tool, input(), metadata()))
  const hasDetails = createMemo(() => toolHasVisibleDetails(props.part.tool, input(), metadata(), output(), error()))
  const defaultOpen = createMemo(() => hasDetails() && (props.part.tool === "todowrite" || props.part.tool === "apply_patch" || state().status === "running" || state().status === "error"))
  const [expanded, setExpanded] = createSignal(defaultOpen())
  createEffect(() => {
    if (defaultOpen()) setExpanded(true)
  })
  return (
    <Show when={hasDetails()} fallback={
      <div class={`part tool ${state().status} ${toolClass()} no-details`}>
        <div class="tool-summary">
          <strong>{title()}</strong>
          <span class="tool-status">{state().status}</span>
        </div>
      </div>
    }>
      <details class={`part tool ${state().status} ${toolClass()}`} open={expanded()} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>
          <DisclosureChevron />
          <strong>{title()}</strong>
          <span class="tool-status">{state().status}</span>
        </summary>
        <Show when={expanded()}>
          <ToolDetails tool={props.part.tool} input={input()} metadata={metadata()} output={output()} error={error()} />
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

function ToolDetails(props: { tool: string; input: Record<string, unknown>; metadata: Record<string, unknown>; output: string; error?: string }) {
  const diagnostics = createMemo(() => arrayValue(props.metadata.diagnostics))
  return (
    <div class="tool-details">
      <Switch fallback={<GenericToolDetails input={props.input} metadata={props.metadata} output={props.output} error={props.error} />}>
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
          <ToolDiffs input={props.input} metadata={props.metadata} />
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
  return (
    <Show when={trimmed()}>
      <div class="tool-output" classList={{ compact: props.compact === true }}>
        <pre>{visible()}</pre>
        <Show when={collapsed().overflow}>
          <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded() ? "Click to collapse" : "Click to expand"}</button>
        </Show>
      </div>
    </Show>
  )
}

function ToolCodeBlock(props: { code: string; language?: string; class?: string }) {
  return <CodeBlock class={props.class} language={props.language || "text"} code={props.code} />
}

function ToolDiffs(props: { input: Record<string, unknown>; metadata: Record<string, unknown> }) {
  const files = createMemo(() => arrayValue(props.metadata.files).filter(isRecordValue))
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
              <Show when={patch} fallback={<ToolDeletedLines title={toolPatchTitle(type, name, file)} filePath={filePath} deletions={numberValue(file.deletions) ?? 0} />}>
                {(diff) => <ToolDiff title={toolPatchTitle(type, name, file)} diff={diff()} filePath={filePath} />}
              </Show>
            </Show>
          )
        }}
      </For>
    </>
  )
}

function ToolDiff(props: { title: string; diff: string; filePath?: string }) {
  const contents = createMemo(() => patchContents(props.diff, props.filePath ?? props.title))
  return (
    <section class="tool-diff">
      <div class="tool-file-diff">
        <ToolDiffHeader title={props.title} filePath={props.filePath} />
        <Show when={contents()} fallback={<ToolCodeBlock language="diff" code={props.diff} />}>
          {(value) => (
            <FileDiffView mode="diff" before={value().before} after={value().after} diffStyle="split" virtualize={false} hunkSeparators="simple" />
          )}
        </Show>
      </div>
    </section>
  )
}

function ToolDeletedLines(props: { title: string; filePath?: string; deletions: number }) {
  return (
    <section class="tool-diff">
      <div class="tool-file-diff">
        <ToolDiffHeader title={props.title} filePath={props.filePath} />
        <p class="tool-deleted-lines">-{props.deletions} line{props.deletions === 1 ? "" : "s"}</p>
      </div>
    </section>
  )
}

function ToolDiffHeader(props: { title: string; filePath?: string }) {
  const path = createMemo(() => props.filePath ?? props.title)
  const filename = createMemo(() => path().split(/[\\/]/).filter(Boolean).at(-1) ?? path())
  return (
    <header class="tool-file-diff-header">
      <strong>{filename()}</strong>
      <Show when={path() !== filename()}>
        <span>{path()}</span>
      </Show>
    </header>
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

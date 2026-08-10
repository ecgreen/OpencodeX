import { Button } from "./ui"
import { Markdown } from "@opencode-ai/ui/markdown"
import { TOOL_OUTPUT_PREVIEW_LIMITS, previewToolOutput } from "@opencode-ai/ui/tool-output-preview"
import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js"
import {
  arrayValue,
  collapseDiffOutput,
  collapseLineOutput,
  COPY_FULL_LABEL,
  copyFullToolText,
  field,
  formatToolValue,
  isRecordValue,
  languageFromPath,
  numberValue,
  stringValue,
} from "../lib/tool-display"
import { ToolDiffs } from "./session-tool-diff"
import { ToolCodeBlock, ToolPreviewText } from "./session-tool-text"
import { TodoList } from "./session-todo-list"

/** Harness tools whose one-line output is the whole story - show it ungated. */
const HARNESS_TASK_TOOLS = new Set(["toolsearch", "taskcreate", "taskupdate", "tasklist", "taskget", "monitor", "schedulewakeup"])

export function ToolDetails(props: { tool: string; input: Record<string, unknown>; metadata: Record<string, unknown>; output: string; error?: string; showGenericOutput: boolean; patchPending?: boolean }) {
  const diagnostics = createMemo(() => arrayValue(props.metadata.diagnostics))
  return (
    <div class="tool-details">
      <Switch fallback={<GenericToolDetails input={props.input} output={props.showGenericOutput ? props.output : ""} />}>
        <Match when={props.tool === "bash" || props.tool === "shell"}>
          <ToolShellBlock command={stringValue(props.input.command)} output={props.output} />
        </Match>
        <Match when={props.tool === "grep" || props.tool === "glob"}>
          <ToolOutput output={props.output} maxLines={15} compact />
        </Match>
        <Match when={props.tool === "read"}>
          <ToolReadPreview input={props.input} metadata={props.metadata} />
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
        <Match when={props.tool === "plan_exit"}>
          <Show when={stringValue(props.input.plan)}>
            {(plan) => (
              <div class="tool-plan">
                <Markdown text={plan()} />
                <Button appearance="ghost" type="button" onClick={() => void copyFullToolText(plan())}>Copy plan</Button>
              </div>
            )}
          </Show>
          <ToolOutput output={props.output} />
        </Match>
        <Match when={HARNESS_TASK_TOOLS.has(props.tool)}>
          <ToolKeyValues
            values={[
              field("Query", stringValue(props.input.query)),
              field("Subject", stringValue(props.input.subject)),
              field("Description", stringValue(props.input.description)),
              field("Status", stringValue(props.input.status)),
              field("Task", stringValue(props.input.taskId)),
            ]}
          />
          <ToolOutput output={props.output} maxLines={15} compact />
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
        {(error) => <ToolPreviewText text={error()} class="tool-error" />}
      </Show>
    </div>
  )
}

/**
 * The server already ships a short head-of-file preview; showing it is what
 * makes a read row worth expanding instead of opening onto nothing.
 */
function ToolReadPreview(props: { input: Record<string, unknown>; metadata: Record<string, unknown> }) {
  const preview = createMemo(() => stringValue(props.metadata.preview)?.trimEnd() ?? "")
  const range = createMemo(() => {
    const offset = numberValue(props.input.offset)
    const limit = numberValue(props.input.limit)
    if (offset === undefined && limit === undefined) return ""
    const start = (offset ?? 0) + 1
    return limit === undefined ? `from line ${start}` : `lines ${start}-${start + limit - 1}`
  })
  return (
    <Show when={preview()}>
      {(code) => (
        <>
          <Show when={range()}>
            {(caption) => <p class="tool-read-range">{caption()}</p>}
          </Show>
          <ToolCodeBlock class="tool-code" language={languageFromPath(stringValue(props.input.filePath))} code={code()} />
          <Show when={props.metadata.truncated === true}>
            <p class="tool-read-range">Preview truncated</p>
          </Show>
        </>
      )}
    </Show>
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

function GenericToolDetails(props: { input: Record<string, unknown>; output: string }) {
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
              <dd>{previewToolOutput(formatToolValue(item.value)).text}</dd>
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
  const collapsedPreview = createMemo(() => previewToolOutput(trimmed()))
  const expandedPreview = createMemo(() => previewToolOutput(trimmed(), TOOL_OUTPUT_PREVIEW_LIMITS.expanded))
  const collapsed = createMemo(() => {
    const value = props.maxLines ? collapseLineOutput(collapsedPreview().text, props.maxLines) : collapseDiffOutput(collapsedPreview().text)
    return { output: value.output, overflow: value.overflow || collapsedPreview().truncated }
  })
  const visible = createMemo(() => expanded() || !collapsed().overflow ? expandedPreview().text : collapsed().output)
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
          <Button appearance="ghost" type="button" aria-expanded={expanded()} onClick={() => setExpanded((value) => !value)}>{expanded() ? "Show less" : "Show more"}</Button>
        </Show>
        <Show when={expandedPreview().truncated}>
          <Button appearance="ghost" type="button" onClick={() => void copyFullToolText(props.output)}>{COPY_FULL_LABEL}</Button>
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
  const source = createMemo(() => arrayValue(props.metadata.todos).length > 0 ? arrayValue(props.metadata.todos) : arrayValue(props.input.todos))
  const todos = createMemo(() => source().filter(isRecordValue).map((todo) => ({
    content: stringValue(todo.content) ?? "Todo",
    status: stringValue(todo.status) ?? "pending",
    priority: stringValue(todo.priority),
  })))
  return <TodoList todos={todos()} />
}

function ToolQuestions(props: { input: Record<string, unknown>; metadata: Record<string, unknown> }) {
  const questions = createMemo(() => arrayValue(props.input.questions).filter(isRecordValue))
  const answers = createMemo(() => arrayValue(props.metadata.answers))
  // Native sessions record answers positionally in metadata; Claude Code hands
  // them back inside the tool input, keyed by the full question text.
  const inputAnswers = createMemo(() => (isRecordValue(props.input.answers) ? props.input.answers : {}))
  const answerFor = (question: Record<string, unknown>, index: number) => {
    const positional = answers()[index]
    if (positional !== undefined) return positional
    const text = stringValue(question.question)
    return text !== undefined ? inputAnswers()[text] : undefined
  }
  return (
    <Show when={questions().length > 0}>
      <div class="tool-questions">
        <For each={questions()}>
          {(question, index) => <div><strong>{stringValue(question.question) ?? stringValue(question.header) ?? "Question"}</strong><p>{previewToolOutput(formatToolValue(answerFor(question, index()) ?? "No answer")).text}</p></div>}
        </For>
      </div>
    </Show>
  )
}

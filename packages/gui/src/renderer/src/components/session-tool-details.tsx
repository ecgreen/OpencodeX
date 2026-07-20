import { Button } from "./ui"
import { CodeBlock } from "@opencode-ai/ui/code-block"
import { File as FileDiffView } from "@opencode-ai/ui/file"
import { TOOL_OUTPUT_PREVIEW_LIMITS, previewToolOutput, type ToolOutputPreviewLimits } from "@opencode-ai/ui/tool-output-preview"
import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js"
import {
  arrayValue,
  collapseDiffOutput,
  collapseLineOutput,
  copyFullToolText,
  field,
  formatTodoStatus,
  formatToolValue,
  isRecordValue,
  languageFromPath,
  NESTED_TRANSCRIPT_DIFF_OPTIONS,
  numberValue,
  patchContents,
  stringValue,
  todoStatusIcon,
  toolPatchTitle,
} from "../lib/tool-display"
import { DisclosureChevron, Icon } from "./icon"

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
        {(error) => <ToolPreviewText text={error()} class="tool-error" copyLabel="Copy full error" />}
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
          <Button appearance="ghost" type="button" onClick={() => setExpanded((value) => !value)}>{expanded() ? "Click to collapse" : "Click to expand"}</Button>
        </Show>
        <Show when={expandedPreview().truncated}>
          <Button appearance="ghost" type="button" onClick={() => void copyFullToolText(props.output)}>Copy full output</Button>
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

export function ToolCodeBlock(props: { code: string; language?: string; class?: string }) {
  const preview = createMemo(() => previewToolOutput(props.code, TOOL_OUTPUT_PREVIEW_LIMITS.expanded))
  return <><CodeBlock class={props.class} language={props.language || "text"} code={preview().text} /><Show when={preview().truncated}><Button appearance="ghost" type="button" onClick={() => void copyFullToolText(props.code)}>Copy full content</Button></Show></>
}

export function ToolPreviewText(props: { text: string; class?: string; copyLabel?: string; limits?: ToolOutputPreviewLimits }) {
  const preview = createMemo(() => previewToolOutput(props.text, props.limits ?? TOOL_OUTPUT_PREVIEW_LIMITS.expanded))
  return <><pre class={props.class}>{preview().text}</pre><Show when={preview().truncated}><Button appearance="ghost" type="button" onClick={() => void copyFullToolText(props.text)}>{props.copyLabel ?? "Copy full content"}</Button></Show></>
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
  const preview = createMemo(() => previewToolOutput(props.diff, TOOL_OUTPUT_PREVIEW_LIMITS.expanded))
  const contents = createMemo(() => patchContents(preview().text, props.filePath ?? props.title))
  const [expanded, setExpanded] = createSignal(true)
  const body = () => (
    <div class="tool-unified-patch">
      <Show when={contents()} fallback={<ToolCodeBlock language="diff" code={props.diff} />}>
        {(value) => (
          <>
            <FileDiffView
              mode="diff"
              before={value().before}
              after={value().after}
              diffStyle="unified"
              overflow="scroll"
              hunkSeparators="simple"
              {...NESTED_TRANSCRIPT_DIFF_OPTIONS}
            />
            <Show when={preview().truncated}><Button appearance="ghost" type="button" onClick={() => void copyFullToolText(props.diff)}>Copy full patch</Button></Show>
          </>
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
        <Button appearance="ghost"
          type="button"
          class="tool-file-diff-action git"
          title={`Open ${filename()} in Git`}
          aria-label={`Open ${filename()} in Git`}
          data-side-panel-git-file={path()}
          onClick={(event) => event.preventDefault()}
        >
          <Icon name="branch" />
        </Button>
        <Button appearance="ghost"
          type="button"
          class="tool-file-diff-action file"
          title={`Open ${filename()} as file`}
          aria-label={`Open ${filename()} as file`}
          data-side-panel-open-file={path()}
          onClick={(event) => event.preventDefault()}
        >
          <Icon name="file" />
        </Button>
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
          {(question, index) => <div><strong>{stringValue(question.question) ?? stringValue(question.header) ?? "Question"}</strong><p>{previewToolOutput(formatToolValue(answers()[index()] ?? "No answer")).text}</p></div>}
        </For>
      </div>
    </Show>
  )
}

export function fileBasename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

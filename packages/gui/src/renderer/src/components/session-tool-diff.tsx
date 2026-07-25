import { File as FileDiffView } from "@opencode-ai/ui/file"
import { TOOL_OUTPUT_PREVIEW_LIMITS, previewToolOutput } from "@opencode-ai/ui/tool-output-preview"
import { For, Show, createMemo, createSignal } from "solid-js"
import {
  COPY_FULL_LABEL,
  NESTED_TRANSCRIPT_DIFF_OPTIONS,
  arrayValue,
  copyFullToolText,
  fileBasename,
  isRecordValue,
  numberValue,
  patchContents,
  stringValue,
  toolPatchTitle,
} from "../lib/tool-display"
import { toggleTranscriptDiffStyle, transcriptDiffStyle } from "../lib/diff-style"
import { DisclosureChevron, Icon } from "./icon"
import { ToolCodeBlock } from "./session-tool-text"
import { Button } from "./ui"

export function ToolDiffs(props: { input: Record<string, unknown>; metadata: Record<string, unknown>; collapsibleFiles?: boolean }) {
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
    <div class="tool-unified-patch" data-diff-style={transcriptDiffStyle()}>
      <Show when={contents()} fallback={<ToolCodeBlock language="diff" code={props.diff} />}>
        {(value) => (
          <>
            <FileDiffView
              mode="diff"
              before={value().before}
              after={value().after}
              diffStyle={transcriptDiffStyle()}
              overflow="scroll"
              hunkSeparators="simple"
              {...NESTED_TRANSCRIPT_DIFF_OPTIONS}
            />
            <Show when={preview().truncated}><Button appearance="ghost" type="button" onClick={() => void copyFullToolText(props.diff)}>{COPY_FULL_LABEL}</Button></Show>
          </>
        )}
      </Show>
    </div>
  )
  return (
    <section class="tool-diff">
      <Show when={props.collapsible} fallback={<><ToolDiffHeader title={props.title} filePath={props.filePath} diffStyleToggle={Boolean(contents())} />{body()}</>}>
        <details class="tool-file-diff-collapse" open={expanded()} onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary class="tool-file-diff-header">
            <ToolDiffHeaderContent title={props.title} filePath={props.filePath} disclosure diffStyleToggle={Boolean(contents())} />
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

function ToolDiffHeader(props: { title: string; filePath?: string; diffStyleToggle?: boolean }) {
  return <header class="tool-file-diff-header"><ToolDiffHeaderContent title={props.title} filePath={props.filePath} diffStyleToggle={props.diffStyleToggle} /></header>
}

function ToolDiffHeaderContent(props: { title: string; filePath?: string; disclosure?: boolean; diffStyleToggle?: boolean }) {
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
        <Show when={props.diffStyleToggle}>
          <Button appearance="ghost"
            type="button"
            class="tool-file-diff-action layout"
            title={transcriptDiffStyle() === "split" ? "Show unified diff" : "Show split diff"}
            aria-label={transcriptDiffStyle() === "split" ? "Show unified diff" : "Show split diff"}
            aria-pressed={transcriptDiffStyle() === "split"}
            onClick={(event) => {
              event.preventDefault()
              toggleTranscriptDiffStyle()
            }}
          >
            <Icon name={transcriptDiffStyle() === "split" ? "columns" : "rows"} />
          </Button>
        </Show>
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

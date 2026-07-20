import type { Part } from "@opencode-ai/sdk/v2/client"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import type { MessageBundle } from "../lib/store"
import {
  arrayValue,
  isRecordValue,
  shouldShowRawToolData,
  stringValue,
  toolDisplayTitle,
  toolError,
  toolHasVisibleDetails,
  toolMetadata,
  toolStateInput,
  toolVisibleOutput,
} from "../lib/tool-display"
import { DisclosureChevron, Icon } from "./icon"
import { ToolCodeBlock, ToolDetails, ToolPreviewText, fileBasename } from "./session-tool-details"
import { Button } from "./ui"

export type ToolPart = Extract<Part, { type: "tool" }>
type ReasoningPart = Extract<Part, { type: "reasoning" }>
export type DisplayPart =
  | { key: string; type: "part"; part: Part }
  | { key: string; type: "tool-group"; tool: string; parts: ToolPart[] }
  | { key: string; type: "reasoning-group"; parts: ReasoningPart[] }

export function groupTranscriptParts(parts: Part[]): DisplayPart[] {
  const result: DisplayPart[] = []
  let pendingTools: ToolPart[] = []
  let pendingReasoning: ReasoningPart[] = []

  function flushTools() {
    if (pendingTools.length === 0) return
    if (pendingTools.length === 1) result.push({ key: `part:${pendingTools[0].id}`, type: "part", part: pendingTools[0] })
    else result.push({ key: `tool-group:${pendingTools[0].tool}:${pendingTools[0].id}`, type: "tool-group", tool: pendingTools[0].tool, parts: pendingTools })
    pendingTools = []
  }

  function flushReasoning() {
    if (pendingReasoning.length === 0) return
    if (pendingReasoning.length === 1) result.push({ key: `part:${pendingReasoning[0].id}`, type: "part", part: pendingReasoning[0] })
    else result.push({ key: `reasoning-group:${pendingReasoning[0].id}`, type: "reasoning-group", parts: pendingReasoning })
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
    result.push({ key: `part:${part.id}`, type: "part", part })
  }
  flushTools()
  flushReasoning()
  return result
}

export function activeTranscriptStreamingPartID(messages: MessageBundle[], running: boolean) {
  if (!running) return
  const message = messages.at(-1)
  if (!message || message.info.role !== "assistant" || typeof message.info.time.completed === "number") return
  const part = message.parts.at(-1)
  if (!part || (part.type !== "text" && part.type !== "reasoning")) return
  if (!part.text.trim() || typeof part.time?.end === "number") return
  if (part.type === "text" && (part.synthetic || part.ignored)) return
  return part.id
}

export function DisplayPartView(props: { item: DisplayPart; showThinking: boolean; showToolDetails: boolean; showGenericToolOutput: boolean; streamingPartID?: string }) {
  return (
    <Switch>
      <Match when={props.item.type === "tool-group"}>
        <ToolGroupView item={props.item as Extract<DisplayPart, { type: "tool-group" }>} />
      </Match>
      <Match when={props.item.type === "reasoning-group"}>
        <ThinkingGroupView item={props.item as Extract<DisplayPart, { type: "reasoning-group" }>} showThinking={props.showThinking} streamingPartID={props.streamingPartID} />
      </Match>
      <Match when={props.item.type === "part"}>
        <PartView
          part={(props.item as Extract<DisplayPart, { type: "part" }>).part}
          showThinking={props.showThinking}
          showToolDetails={props.showToolDetails}
          showGenericToolOutput={props.showGenericToolOutput}
          streaming={props.streamingPartID === (props.item as Extract<DisplayPart, { type: "part" }>).part.id}
        />
      </Match>
    </Switch>
  )
}

function isGroupableTool(tool: string) {
  return tool === "read" || tool === "grep" || tool === "glob" || tool === "webfetch" || tool === "websearch" || tool === "skill"
}

function ThinkingGroupView(props: { item: Extract<DisplayPart, { type: "reasoning-group" }>; showThinking: boolean; streamingPartID?: string }) {
  const visibleParts = createMemo(() => props.item.parts.filter((part) => part.text.trim()))
  const visiblePartMap = createMemo(() => new Map(visibleParts().map((part) => [part.id, part])))
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
              <For each={visibleParts().map((part) => part.id)}>
                {(partID, index) => {
                  const part = createMemo(() => visiblePartMap().get(partID))
                  return <Show when={part()}>
                    {(current) => (
                      <section class="thinking-segment">
                        <header>Thinking {index() + 1}</header>
                        <Markdown text={current().text.trim()} cacheKey={partID} streaming={props.streamingPartID === partID} />
                      </section>
                    )}
                  </Show>
                }}
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
  const partMap = createMemo(() => new Map(props.item.parts.map((part) => [part.id, part])))
  const startCollapsed = createMemo(() => props.item.tool === "read" && props.item.parts.length > 10)
  const [expanded, setExpanded] = createSignal(!startCollapsed())
  const statusLabel = createMemo(() => startCollapsed() && !expanded() ? "Click to expand" : status() === "completed" ? "" : status())
  const errorPreview = createMemo(() => {
    if (status() !== "error") return ""
    const failed = props.item.parts.find((part) => part.state.status === "error")
    if (!failed) return ""
    const message = (toolError(failed.state) ?? "").replace(/\s+/g, " ").trim()
    return message.length > 96 ? `${message.slice(0, 96)}…` : message
  })
  return (
    <details class={`part tool tool-group ${status()}`} open={expanded()} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        <DisclosureChevron />
        <strong>{toolGroupTitle(props.item.tool, props.item.parts)}</strong>
        <Show when={statusLabel()}>
          {(label) => <span class="tool-status">{label()}</span>}
        </Show>
        <Show when={errorPreview() && !expanded()}>
          <small class="tool-group-error">{errorPreview()}</small>
        </Show>
      </summary>
      <Show when={expanded()}>
        <div class="tool-group-list">
          <For each={props.item.parts.map((part) => part.id)}>
            {(partID) => {
              const part = createMemo(() => partMap().get(partID))
              return <Show when={part()}>
                {(current) => (
                  <div class="tool-group-item">
                    <span>{toolDisplayTitle(current().tool, toolStateInput(current().state), toolMetadata(current().state) ?? {}, current().state.status)}</span>
                    <Show when={current().state.status !== "completed"}>
                      <small>{current().state.status}</small>
                    </Show>
                  </div>
                )}
              </Show>
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

function PartView(props: { part: MessageBundle["parts"][number]; showThinking: boolean; showToolDetails: boolean; showGenericToolOutput: boolean; streaming: boolean }) {
  return (
    <Switch fallback={<ToolPreviewText class="part muted" text={JSON.stringify(props.part, null, 2)} copyLabel="Copy full data" />}>
      <Match when={isStructuralPart(props.part)}>
        <></>
      </Match>
      <Match when={props.part.type === "text" || props.part.type === "reasoning"}>
        <TextPartView
          part={props.part as Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }>}
          showThinking={props.showThinking}
          streaming={props.streaming}
        />
      </Match>
      <Match when={props.part.type === "tool"}>
        <ToolPartView part={props.part as ToolPart} showDetails={props.showToolDetails} showGenericOutput={props.showGenericToolOutput} />
      </Match>
      <Match when={props.part.type === "file"}>
        <Button appearance="ghost" class="part file" data-side-panel-file={props.part.type === "file" ? props.part.filename ?? props.part.url : ""} title="Open in side panel">
          <Icon name="file" />
          <span>{props.part.type === "file" ? props.part.filename ?? props.part.url : ""}</span>
          <Icon name="chevronRight" class="part-file-chevron" />
        </Button>
      </Match>
      <Match when={props.part.type === "agent"}>
        <div class="part badge"><Icon name="swarm" /><span>Agent: {props.part.type === "agent" ? props.part.name : ""}</span></div>
      </Match>
      <Match when={props.part.type === "patch"}>
        <div class="part badge"><Icon name="pencil" /><span>Patch: {props.part.type === "patch" ? props.part.files.join(", ") : ""}</span></div>
      </Match>
      <Match when={props.part.type === "compaction"}>
        <div class="part badge"><Icon name="context" /><span>Compaction {props.part.type === "compaction" && props.part.auto ? "auto" : "manual"}</span></div>
      </Match>
    </Switch>
  )
}

function isStructuralPart(part: MessageBundle["parts"][number]) {
  return part.type === "step-start" || part.type === "step-finish" || part.type === "snapshot" || part.type === "retry" || part.type === "subtask"
}

function TextPartView(props: { part: Extract<Part, { type: "text" }> | Extract<Part, { type: "reasoning" }>; showThinking: boolean; streaming: boolean }) {
  const text = createMemo(() => {
    if ("synthetic" in props.part && props.part.synthetic) return ""
    if ("ignored" in props.part && props.part.ignored) return ""
    return props.part.text.trim()
  })
  return (
    <Show when={text()}>
      <div class={`part text ${props.part.type}`}>
        <Show when={props.part.type === "reasoning"} fallback={<Markdown text={text()} cacheKey={props.part.id} streaming={props.streaming} />}>
          <details class="thinking-block" open>
            <summary>
              <DisclosureChevron />
              <span>Thinking</span>
            </summary>
            <Show when={props.showThinking}>
              <Markdown text={text()} cacheKey={props.part.id} streaming={props.streaming} />
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
  const [rawExpanded, setRawExpanded] = createSignal(false)
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
            <details class="tool-raw" open={rawExpanded()} onToggle={(event) => setRawExpanded(event.currentTarget.open)}>
              <summary>
                <DisclosureChevron />
                <span>Raw tool data</span>
              </summary>
              <Show when={rawExpanded()}>
                <Show when={Object.keys(input()).length > 0}>
                  <label>Input</label>
                  <ToolCodeBlock language="json" code={JSON.stringify(input(), null, 2)} />
                </Show>
                <Show when={Object.keys(metadata()).length > 0}>
                  <label>Metadata</label>
                  <ToolCodeBlock language="json" code={JSON.stringify(metadata(), null, 2)} />
                </Show>
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

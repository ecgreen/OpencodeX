import type { Part } from "@opencode-ai/sdk/v2/client"
import { For, Match, Show, Switch, createMemo } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import type { MessageBundle } from "../lib/store"
import { autoOpenForStatus, createDisclosure, createMountedOnce } from "../lib/disclosure"
import type { DisplayPart, ToolPart } from "../lib/transcript-grouping"
import { toolGroupStatus, toolGroupSummary, toolGroupTitle } from "../lib/transcript-grouping"
import {
  arrayValue,
  fileBasename,
  isRecordValue,
  shouldShowRawToolData,
  stringValue,
  toolCategory,
  toolDisplayTitle,
  toolError,
  toolHasVisibleDetails,
  toolMetadata,
  toolStateInput,
  toolStateTitle,
  toolTier,
  toolVisibleOutput,
} from "../lib/tool-display"
import { isStructuralPart } from "../lib/transcript-visibility"
import { Icon } from "./icon"
import { PartErrorPreview, PartHeader, ToolStatusIndicator, partIconName, useTranscriptChrome } from "./session-part-chrome"
import { ThinkingGroupView } from "./session-thinking"
import { ToolDetails } from "./session-tool-details"
import { ToolCodeBlock, ToolPreviewText } from "./session-tool-text"
import { Button } from "./ui"

export type { DisplayPart, ToolPart } from "../lib/transcript-grouping"
export { groupTranscriptParts } from "../lib/transcript-grouping"

/** Tools whose completed output is the deliverable, not a step along the way. */
const KEEP_OPEN_WHEN_COMPLETE = new Set(["todowrite", "apply_patch"])

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

/** Narrows the union through `when` so each branch is typed, not asserted. */
function displayPartOf<T extends DisplayPart["type"]>(item: DisplayPart, type: T) {
  return item.type === type ? (item as Extract<DisplayPart, { type: T }>) : undefined
}

function partOf<T extends Part["type"]>(part: MessageBundle["parts"][number], type: T) {
  return part.type === type ? (part as Extract<Part, { type: T }>) : undefined
}

export function DisplayPartView(props: { item: DisplayPart; showThinking: boolean; showToolDetails: boolean; showGenericToolOutput: boolean; streamingPartID?: string }) {
  return (
    <Switch>
      <Match when={displayPartOf(props.item, "tool-group")}>
        {(item) => <ToolGroupView item={item()} />}
      </Match>
      <Match when={displayPartOf(props.item, "reasoning-group")}>
        {(item) => <ThinkingGroupView item={item()} showThinking={props.showThinking} streamingPartID={props.streamingPartID} />}
      </Match>
      <Match when={displayPartOf(props.item, "part")}>
        {(item) => (
          <PartView
            part={item().part}
            showToolDetails={props.showToolDetails}
            showGenericToolOutput={props.showGenericToolOutput}
            streaming={props.streamingPartID === item().part.id}
          />
        )}
      </Match>
    </Switch>
  )
}

function ToolGroupView(props: { item: Extract<DisplayPart, { type: "tool-group" }> }) {
  const chrome = useTranscriptChrome()
  const status = createMemo(() => toolGroupStatus(props.item.parts))
  const partMap = createMemo(() => new Map(props.item.parts.map((part) => [part.id, part])))
  const failed = createMemo(() => props.item.parts.find((part) => part.state.status === "error"))
  const disclosure = createDisclosure({
    id: () => `group:${props.item.parts[0]?.id ?? ""}`,
    auto: () => autoOpenForStatus(status()),
    following: chrome.following,
    store: chrome.disclosure,
  })
  const bodyMounted = createMountedOnce(disclosure.open)
  return (
    <details
      class="part tool tool-group"
      data-kind={toolCategory(props.item.tool)}
      data-status={status()}
      data-tier="row"
      open={disclosure.open()}
      onToggle={disclosure.handleToggle}
    >
      <PartHeader
        icon={partIconName(props.item.tool)}
        title={toolGroupTitle(props.item.tool, props.item.parts)}
        meta={toolGroupSummary(props.item.tool, props.item.parts)}
        status={<Show when={status() === "running"}><span class="part-spinner" aria-hidden="true" /><span class="part-status-label">Running</span></Show>}
        trailing={<Show when={failed()}>{(part) => <PartErrorPreview state={part().state} when={!disclosure.open()} />}</Show>}
      />
      <Show when={bodyMounted()}>
        <div class="part-body tool-group-list">
          <For each={props.item.parts.map((part) => part.id)}>
            {(partID) => {
              const part = createMemo(() => partMap().get(partID))
              return <Show when={part()}>
                {(current) => (
                  <div class="tool-group-item" data-status={current().state.status}>
                    <span>{toolDisplayTitle(current().tool, toolStateInput(current().state), toolMetadata(current().state) ?? {}, current().state.status, toolStateTitle(current().state))}</span>
                    <ToolStatusIndicator state={current().state} />
                    <PartErrorPreview state={current().state} when={true} />
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

function PartView(props: { part: MessageBundle["parts"][number]; showToolDetails: boolean; showGenericToolOutput: boolean; streaming: boolean }) {
  return (
    <Switch fallback={<ToolPreviewText class="part muted" text={JSON.stringify(props.part, null, 2)} />}>
      <Match when={isStructuralPart(props.part)}>
        <></>
      </Match>
      <Match when={partOf(props.part, "text")}>
        {(part) => <TextPartView part={part()} streaming={props.streaming} />}
      </Match>
      <Match when={partOf(props.part, "tool")}>
        {(part) => <ToolPartView part={part()} showDetails={props.showToolDetails} showGenericOutput={props.showGenericToolOutput} />}
      </Match>
      <Match when={partOf(props.part, "retry")}>
        {(part) => <RetryPartView part={part()} />}
      </Match>
      <Match when={partOf(props.part, "subtask")}>
        {(part) => <SubtaskPartView part={part()} />}
      </Match>
      <Match when={partOf(props.part, "file")}>
        {(part) => (
          <Button appearance="ghost" class="part file" data-side-panel-file={part().filename ?? part().url} title="Open in side panel">
            <Icon name="file" />
            <span>{part().filename ?? part().url}</span>
            <Icon name="chevronRight" class="part-file-chevron" />
          </Button>
        )}
      </Match>
      <Match when={partOf(props.part, "agent")}>
        {(part) => <div class="part badge"><Icon name="swarm" /><span>Agent: {part().name}</span></div>}
      </Match>
      <Match when={partOf(props.part, "patch")}>
        {(part) => <div class="part badge"><Icon name="pencil" /><span>Patch: {part().files.join(", ")}</span></div>}
      </Match>
      <Match when={partOf(props.part, "compaction")}>
        {(part) => <div class="part badge"><Icon name="context" /><span>Compaction {part().auto ? "auto" : "manual"}</span></div>}
      </Match>
    </Switch>
  )
}

function TextPartView(props: { part: Extract<Part, { type: "text" }>; streaming: boolean }) {
  const text = createMemo(() => props.part.synthetic || props.part.ignored ? "" : props.part.text.trim())
  return (
    <Show when={text()}>
      <div class="part text">
        <Markdown text={text()} cacheKey={props.part.id} streaming={props.streaming} />
      </div>
    </Show>
  )
}

/**
 * A retry used to be dropped entirely, which made an aborted turn look like it
 * never happened. It reads as a log line, not an alarm - the request recovered.
 */
function RetryPartView(props: { part: Extract<Part, { type: "retry" }> }) {
  const message = createMemo(() => retryMessage(props.part.error))
  return (
    <div class="part retry-notice" data-kind="retry">
      <Icon name="refresh" class="part-icon" />
      <span class="part-title">Retry attempt {props.part.attempt}</span>
      <Show when={message()}>
        {(text) => <small class="part-error-preview">{text()}</small>}
      </Show>
    </div>
  )
}

function retryMessage(error: unknown) {
  if (!isRecordValue(error)) return ""
  const data = isRecordValue(error.data) ? error.data : undefined
  return stringValue(data?.message) ?? stringValue(error.name) ?? ""
}

function SubtaskPartView(props: { part: Extract<Part, { type: "subtask" }> }) {
  return (
    <div class="part badge" data-kind="agent">
      <Icon name="swarm" />
      <span>{props.part.agent} — {props.part.description}</span>
    </div>
  )
}

function ToolPartView(props: { part: ToolPart; showDetails: boolean; showGenericOutput: boolean }) {
  const chrome = useTranscriptChrome()
  const state = () => props.part.state
  const input = createMemo(() => toolStateInput(state()))
  const metadata = createMemo(() => toolMetadata(state()) ?? {})
  const error = createMemo(() => toolError(state()))
  const output = createMemo(() => toolVisibleOutput(props.part.tool, state(), metadata()))
  const title = createMemo(() => toolDisplayTitle(props.part.tool, input(), metadata(), state().status, toolStateTitle(state())))
  const patchSummary = createMemo(() => props.part.tool === "apply_patch" ? patchSummaryFiles(metadata()) : "")
  const patchPending = createMemo(() => props.part.tool === "apply_patch" && state().status !== "completed" && state().status !== "error" && !patchHasDiff(metadata()))
  const hasDetails = createMemo(() => patchPending() || toolHasVisibleDetails(props.part.tool, input(), metadata(), output(), error()))
  const visibleDetails = createMemo(() => props.showDetails && hasDetails())
  const disclosure = createDisclosure({
    id: () => props.part.id,
    auto: () => visibleDetails() && autoOpenForStatus(state().status, KEEP_OPEN_WHEN_COMPLETE.has(props.part.tool)),
    following: chrome.following,
    store: chrome.disclosure,
  })
  const raw = createDisclosure({
    id: () => `${props.part.id}:raw`,
    auto: () => false,
    store: chrome.disclosure,
  })
  const bodyMounted = createMountedOnce(disclosure.open)
  const rawMounted = createMountedOnce(raw.open)
  const header = (isStatic: boolean) => (
    <PartHeader
      static={isStatic}
      icon={partIconName(props.part.tool)}
      title={title()}
      meta={patchSummary()}
      status={<ToolStatusIndicator state={state()} />}
      trailing={<PartErrorPreview state={state()} when={!disclosure.open()} />}
    />
  )
  return (
    <Show when={visibleDetails()} fallback={
      <div
        class="part tool"
        data-kind={toolCategory(props.part.tool)}
        data-status={state().status}
        data-tier={toolTier(props.part.tool, state().status)}
      >
        {header(true)}
      </div>
    }>
      <details
        class="part tool"
        data-kind={toolCategory(props.part.tool)}
        data-status={state().status}
        data-tier={toolTier(props.part.tool, state().status)}
        open={disclosure.open()}
        onToggle={disclosure.handleToggle}
      >
        {header(false)}
        <Show when={bodyMounted()}>
          <div class="part-body">
            <ToolDetails tool={props.part.tool} input={input()} metadata={metadata()} output={output()} error={error()} showGenericOutput={props.showGenericOutput} patchPending={patchPending()} />
            <Show when={shouldShowRawToolData(props.part.tool, input(), metadata())}>
              <details class="tool-raw" open={raw.open()} onToggle={raw.handleToggle}>
                <PartHeader title="Raw tool data" />
                <Show when={rawMounted()}>
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
          </div>
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

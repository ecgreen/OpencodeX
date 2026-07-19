import type { AssistantMessage, Provider } from "@opencode-ai/sdk/v2/client"
import { For, Show } from "solid-js"
import type { MessageBundle } from "../lib/store"
import { formatTokenCount } from "../lib/session-composer-helpers"
import { OpencodeXLogo } from "./chrome"
import { Button } from "./ui"

export function hasActiveAssistantProgress(messages: MessageBundle[]) {
  return activeAssistantProgressParts(messages).length > 0
}

export function activeAssistantProgressParts(messages: MessageBundle[]) {
  return messages
    .slice(messages.reduce((index, message, current) => (message.info.role === "user" ? current : index), -1) + 1)
    .filter((message) => message.info.role === "assistant")
    .flatMap((message) => message.parts.map(progressPartKey).filter((key): key is string => Boolean(key)))
}

function progressPartKey(part: MessageBundle["parts"][number]) {
  if (part.type === "text") return part.synthetic || part.ignored || !part.text.trim() ? undefined : `${part.id}:text:${part.text.length}`
  if (part.type === "reasoning") return part.text.trim() ? `${part.id}:reasoning:${part.text.length}` : undefined
  if (part.type === "tool") return `${part.id}:tool:${part.tool}:${part.state.status}:${toolStateProgressKey(part.state)}`
  if (part.type === "file") return `${part.id}:file`
  if (part.type === "agent") return `${part.id}:agent`
  if (part.type === "patch") return `${part.id}:patch:${part.files.join(",")}`
  return undefined
}

function toolStateProgressKey(state: Extract<MessageBundle["parts"][number], { type: "tool" }>["state"]) {
  if (state.status === "completed") return `${state.output?.length ?? 0}:${metadataProgressKey(state.metadata)}`
  if (state.status === "error") return state.error.length
  return `${"input" in state ? recordKeyList(state.input) : ""}:${metadataProgressKey("metadata" in state ? state.metadata : undefined)}`
}

function metadataProgressKey(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return ""
  return Object.entries(metadata).map(([key, value]) => `${key}:${Array.isArray(value) ? value.length : typeof value === "string" ? value.length : value ? 1 : 0}`).join(",")
}

function recordKeyList(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ""
  return Object.keys(value).join(",")
}

export function isScrollbarPointer(event: PointerEvent, element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return (element.scrollHeight > element.clientHeight && event.clientX >= rect.right - 16) || (element.scrollWidth > element.clientWidth && event.clientY >= rect.bottom - 16)
}

export function showTranscriptHeader(messages: MessageBundle[], index: number, showTimestamps: boolean) {
  const message = messages[index]
  if (!message) return false
  if (message.info.role === "user") return showTimestamps
  return messages[index - 1]?.info.role === "user"
}

export function transcriptHeaderLabel(message: MessageBundle["info"], providers: Provider[], showTimestamps: boolean) {
  if (message.role === "user") return showTimestamps ? new Date(message.time.created).toLocaleString() : ""
  const parts = [assistantModelLabel(message, providers)]
  const meta = assistantMessageMeta(message)
  if (meta) parts.push(meta)
  if (showTimestamps) parts.push(new Date(message.time.created).toLocaleString())
  return parts.filter(Boolean).join(" · ")
}

function assistantMessageMeta(message: AssistantMessage) {
  const meta: string[] = []
  if (message.time.completed) meta.push(formatMessageDuration(message.time.completed - message.time.created))
  const tokens = message.tokens.total ?? message.tokens.input + message.tokens.output + message.tokens.reasoning
  if (tokens > 0) meta.push(`${formatTokenCount(tokens)} tok`)
  return meta.join(" · ")
}

function formatMessageDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function assistantModelLabel(message: AssistantMessage, providers: Provider[]) {
  const model = providers.find((provider) => provider.id === message.providerID)?.models[message.modelID]
  return model?.name ?? message.modelID.split(/[/:_-]+/).filter(Boolean).map((part) => (part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1))).join(" ")
}

export function TranscriptLoadingSkeleton(props: { visible: boolean }) {
  return <div class="session-loading-skeleton" classList={{ visible: props.visible }} aria-hidden={!props.visible} aria-busy={props.visible} aria-label="Loading transcript">
    <div class="session-loading-skeleton-stack">
      <For each={[0, 1, 2, 3, 4, 5, 6]}>{(item) => <div class="session-loading-skeleton-message" data-kind={item % 3 === 0 ? "user" : "assistant"}><span class="session-loading-skeleton-line title" /><span class="session-loading-skeleton-line" /><span class="session-loading-skeleton-line" /><span class="session-loading-skeleton-line short" /></div>}</For>
    </div>
  </div>
}

const EMPTY_STATE_SUGGESTIONS = ["Explain this codebase", "Find and fix a bug", "Add tests for recent changes"]

export function SessionEmptyState(props: { visible: boolean; handoff: boolean; onSuggestion?: (prompt: string) => void }) {
  return (
    <div class="session-empty-state" classList={{ visible: props.visible, handoff: props.handoff }} aria-hidden={!props.visible}>
      <OpencodeXLogo active={props.visible} />
      <p>What should OpencodeX work on?</p>
      <Show when={props.visible && props.onSuggestion}>
        {(suggest) => (
          <>
            <div class="session-empty-state-suggestions">
              <For each={EMPTY_STATE_SUGGESTIONS}>
                {(prompt) => (
                  <Button appearance="outline" size="compact" class="session-empty-state-suggestion" tabIndex={props.visible ? 0 : -1} onClick={() => suggest()(prompt)}>
                    {prompt}
                  </Button>
                )}
              </For>
            </div>
            <div class="session-empty-state-hints" aria-hidden="true">
              <span><kbd>/</kbd> commands</span>
              <span><kbd>@</kbd> mention files</span>
              <span><kbd>Ctrl+Tab</kbd> switch sessions</span>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}

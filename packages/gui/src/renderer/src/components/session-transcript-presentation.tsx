import type { AssistantMessage, Provider } from "@opencode-ai/sdk/v2/client"
import { For } from "solid-js"
import type { MessageBundle } from "../lib/store"
import { OpencodeXLogo } from "./chrome"

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
  const label = assistantModelLabel(message, providers)
  if (!showTimestamps) return label
  return `${label} - ${new Date(message.time.created).toLocaleString()}`
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

export function SessionEmptyState(props: { visible: boolean; handoff: boolean }) {
  return <div class="session-empty-state" classList={{ visible: props.visible, handoff: props.handoff }} aria-hidden={!props.visible}><OpencodeXLogo active={props.visible} /><p>What should OpencodeX work on?</p></div>
}

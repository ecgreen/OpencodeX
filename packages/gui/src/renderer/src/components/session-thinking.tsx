import { For, Show, createMemo } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import { createDisclosure, createMountedOnce } from "../lib/disclosure"
import { collapseWhitespace, formatElapsed } from "../lib/tool-display"
import type { DisplayPart, ReasoningPart } from "../lib/transcript-grouping"
import { PartHeader, useTranscriptChrome } from "./session-part-chrome"

const PREVIEW_LENGTH = 96

/**
 * Pulls the line worth showing on a collapsed block. While the model is still
 * thinking that is the newest line, so the header reads like a ticker; once it
 * has finished, the opening line describes the whole block better.
 */
export function thinkingPreview(text: string, streaming: boolean) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return ""
  const line = streaming ? lines[lines.length - 1] : lines[0]
  return collapseWhitespace(stripMarkdownEmphasis(line), PREVIEW_LENGTH)
}

function stripMarkdownEmphasis(line: string) {
  return line.replace(/^#{1,6}\s+/, "").replace(/[*_`]+/g, "")
}

export function ThinkingGroupView(props: {
  item: Extract<DisplayPart, { type: "reasoning-group" }>
  showThinking: boolean
  streamingPartID?: string
}) {
  const chrome = useTranscriptChrome()
  const visibleParts = createMemo(() => props.item.parts.filter((part) => part.text.trim()))
  const visiblePartMap = createMemo(() => new Map(visibleParts().map((part) => [part.id, part])))
  const streaming = createMemo(() => visibleParts().some((part) => part.id === props.streamingPartID))
  const preview = createMemo(() => {
    const parts = visibleParts()
    if (parts.length === 0) return ""
    const source = streaming() ? parts[parts.length - 1] : parts[0]
    return thinkingPreview(source.text, streaming())
  })
  const duration = createMemo(() => {
    const parts = visibleParts()
    const start = parts[0]?.time?.start
    const end = parts[parts.length - 1]?.time?.end
    if (start === undefined || end === undefined || streaming()) return ""
    return formatElapsed(Math.max(0, end - start))
  })
  const disclosure = createDisclosure({
    id: () => `thinking:${props.item.parts[0]?.id ?? ""}`,
    // Follow the model while it reasons, then get out of the way.
    auto: () => streaming(),
    following: chrome.following,
    store: chrome.disclosure,
  })
  const bodyMounted = createMountedOnce(disclosure.open)

  return (
    <Show when={props.showThinking && visibleParts().length > 0}>
      <details
        class="part thinking-block"
        data-kind="thinking"
        data-status={streaming() ? "running" : "completed"}
        open={disclosure.open()}
        onToggle={disclosure.handleToggle}
      >
        <PartHeader
          icon="brain"
          title="Thinking"
          meta={preview()}
          status={duration() ? <span class="part-duration">{duration()}</span> : undefined}
        />
        <Show when={bodyMounted()}>
          <div class="part-body thinking-segments">
            <For each={visibleParts().map((part) => part.id)}>
              {(partID, index) => {
                const part = createMemo(() => visiblePartMap().get(partID))
                return (
                  <Show when={part()}>
                    {(current) => (
                      <ThinkingSegment
                        part={current()}
                        index={index()}
                        total={visibleParts().length}
                        streaming={props.streamingPartID === partID}
                      />
                    )}
                  </Show>
                )
              }}
            </For>
          </div>
        </Show>
      </details>
    </Show>
  )
}

function ThinkingSegment(props: { part: ReasoningPart; index: number; total: number; streaming: boolean }) {
  return (
    <section class="thinking-segment">
      <Show when={props.total > 1}>
        <header>Thinking {props.index + 1}</header>
      </Show>
      <Markdown text={props.part.text.trim()} cacheKey={props.part.id} streaming={props.streaming} />
    </section>
  )
}

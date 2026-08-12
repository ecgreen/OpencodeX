import { Button, Tooltip } from "./ui"
import type { Provider } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import type { MessageBundle, SessionData } from "../lib/session-api"
import type { SessionMessageActionKind } from "../lib/message-actions"
import { transcriptPromptHistory, visibleTranscriptMessageIDs, visibleTranscriptMessages, type TranscriptPromptEntry } from "../lib/transcript-visibility"
import { Icon } from "./icon"
import { MessageActions } from "./message-actions"
import { sessionDisclosureStore } from "../lib/disclosure"
import { createStableEffect } from "../lib/stable-effect"
import { TranscriptChromeProvider } from "./session-part-chrome"
import { DisplayPartView, activeTranscriptStreamingPartID, groupTranscriptParts } from "./session-transcript"
import { createTranscriptScrollController } from "./session-transcript-scroll-controller"
import { SessionEmptyState, TranscriptLoadingSkeleton, TranscriptMessageError, activeAssistantProgressParts, hasActiveAssistantProgress, showTranscriptHeader, transcriptHeaderLabel } from "./session-transcript-presentation"

const ASSISTANT_THINKING_DELAY_MS = 1_600
/** Sessions at or below this many messages mount synchronously - deferring them
 * would only flash a skeleton for content that renders in well under a frame. */
const DEFER_TRANSCRIPT_MOUNT_MESSAGE_COUNT = 16

/** True once an assistant message has closed - nothing inside it can still run. */
function assistantCompleted(info: MessageBundle["info"]) {
  return info.role === "assistant" && typeof info.time.completed === "number"
}

/**
 * The prompt preview restyles the tooltip bubble itself, and the bubble's own
 * component stylesheet is unlayered - it outranks every layered app rule, so
 * these overrides ride inline where the cascade cannot be argued with. The
 * card stays on theme: raised surface with a nudge of lift, a strong border,
 * reading-size type, and a deep two-layer throw (tight contact shadow for
 * edge definition plus a wide ambient) doing the separating from the prose.
 */
const PROMPT_PREVIEW_TOOLTIP_STYLE = {
  padding: "var(--ds-space-2) var(--ds-space-3)",
  "border-color": "var(--ds-border-strong)",
  "border-radius": "var(--ds-radius-overlay)",
  color: "var(--ds-text)",
  background: "color-mix(in srgb, var(--ds-surface-raised) 94%, var(--ds-text))",
  "box-shadow": "0 4px 16px var(--theme-shadow-medium), 0 24px 72px var(--theme-shadow-strong)",
  "font-size": "var(--ds-text-md)",
  "line-height": "var(--ds-leading-md)",
  "font-weight": "450",
  "letter-spacing": "normal",
} satisfies JSX.CSSProperties

/**
 * One prompt-history rail, hosted on either transcript edge. The left rail is
 * a pointer convenience mirroring the right one: it is hidden from assistive
 * tech and skipped by Tab so keyboard and screen-reader users meet a single
 * "Prompt history" landmark, not every prompt twice. Mirroring is a container
 * `scaleX(-1)` in CSS - one set of geometry rules serves both edges.
 */
function PromptHistoryRail(props: {
  side: "left" | "right"
  entries: TranscriptPromptEntry[]
  jump: (messageID: string) => void
}) {
  const mirrored = () => props.side === "left"
  return (
    <nav
      class="transcript-prompt-history"
      data-side={props.side}
      aria-label={mirrored() ? undefined : "Prompt history"}
      aria-hidden={mirrored() ? "true" : undefined}
    >
      <For each={props.entries}>
        {(entry, index) => (
          <Tooltip
            placement={mirrored() ? "right" : "left"}
            contentStyle={PROMPT_PREVIEW_TOOLTIP_STYLE}
            label={<span class="transcript-prompt-history-preview">{entry.text}</span>}
          >
            <Button
              appearance="ghost"
              size="compact"
              type="button"
              class="transcript-prompt-history-item"
              tabIndex={mirrored() ? -1 : undefined}
              aria-label={`Prompt ${index() + 1} of ${props.entries.length}: ${promptPreviewLabel(entry.text)}`}
              onClick={() => props.jump(entry.messageID)}
            >
              <span class="transcript-prompt-history-tick" aria-hidden="true" />
            </Button>
          </Tooltip>
        )}
      </For>
    </nav>
  )
}

/** Screen-reader label for a rail item: enough to identify the prompt without
 * reading a 400-character preview aloud. */
function promptPreviewLabel(text: string) {
  return text.length > 100 ? `${text.slice(0, 99).trimEnd()}…` : text
}


export function TranscriptPanel(props: {
  sessionID: string
  data: SessionData
  loading: boolean
  providers: Provider[]
  showTimestamps: boolean
  showThinking: boolean
  showToolDetails: boolean
  showScrollbar: boolean
  showGenericToolOutput: boolean
  concealCodeBlocks: boolean
  /** Prompt-history rail on the right edge. Main session transcript only -
   * embedded swarm and graph transcripts are too small to host it. */
  showPromptHistory?: boolean
  running?: boolean
  emptyStateDismissed?: boolean
  emptyStateHandoff?: boolean
  loadOlderMessages?: (cursor: string) => Promise<void>
  collapseMessageWindow?: () => void
  messageAction?: (action: SessionMessageActionKind, bundle: MessageBundle) => void
  emptyStateSuggestion?: (prompt: string) => void
  connectProvider?: (providerID?: string) => void
}) {
  let assistantThinkingTimer: ReturnType<typeof setTimeout> | undefined
  const [assistantThinkingVisible, setAssistantThinkingVisible] = createSignal(false)
  // Committing a session switch must never wait on its transcript: a large
  // cached message tree can take hundreds of milliseconds to mount, which reads
  // as the click not registering. The switch paints the skeleton first and the
  // heavy content mounts one frame later. Small sessions skip the deferral so
  // they still open with zero flicker.
  const [warmSessionID, setWarmSessionID] = createSignal("")
  let warmFrame: number | undefined
  const warming = createMemo(() => warmSessionID() !== props.sessionID)
  // Guarded: writes the warm marker it reads, on every session swap.
  createStableEffect("transcript.warmSession", () => {
    const id = props.sessionID
    if (warmSessionID() === id) return
    if (warmFrame !== undefined) cancelAnimationFrame(warmFrame)
    warmFrame = undefined
    if (props.data.messages.length <= DEFER_TRANSCRIPT_MOUNT_MESSAGE_COUNT) {
      setWarmSessionID(id)
      return
    }
    // Double rAF: the first fires before the skeleton's paint, the second lands
    // in the following frame - only then does the heavy mount begin.
    warmFrame = requestAnimationFrame(() => {
      warmFrame = requestAnimationFrame(() => {
        warmFrame = undefined
        setWarmSessionID(id)
      })
    })
  })
  onCleanup(() => {
    if (warmFrame !== undefined) cancelAnimationFrame(warmFrame)
  })
  const contentPending = () => props.loading || warming()
  const visibleMessages = createMemo(() => (warming() ? [] : visibleTranscriptMessages(props.data.messages)))
  const visibleMessageMap = createMemo(() => new Map(visibleMessages().map((item) => [item.info.id, item])))
  const visibleMessageIDs = createMemo(() => (warming() ? [] : visibleTranscriptMessageIDs(props.data.messages)))
  const streamingPartID = createMemo(() => activeTranscriptStreamingPartID(visibleMessages(), props.running === true))
  const activeAssistantHasProgress = createMemo(() => hasActiveAssistantProgress(visibleMessages()))
  const activeAssistantProgressKey = createMemo(() => activeAssistantProgressParts(visibleMessages()).join("|"))
  const promptHistory = createMemo(() =>
    warming() || props.showPromptHistory !== true ? [] : transcriptPromptHistory(props.data.messages),
  )
  const emptyStateHandoff = () => props.emptyStateHandoff === true
  const transcriptHasContent = () => visibleMessages().length > 0 || assistantThinkingVisible()
  const pendingSession = () => props.sessionID.startsWith("pending:")

  const scroll = createTranscriptScrollController({
    sessionID: () => props.sessionID,
    messageCursor: () => props.data.messageCursor,
    contentPending,
    transcriptHasContent,
    visibleMessageIDs,
    concealCodeBlocks: () => props.concealCodeBlocks,
    loadOlderMessages: () => props.loadOlderMessages,
    trackScrollDependencies: () => {
      visibleMessages()
      activeAssistantProgressKey()
      assistantThinkingVisible()
      props.showThinking
      props.showToolDetails
      props.showGenericToolOutput
      contentPending()
      props.data.messageCursor
    },
    trackSkeletonDependencies: () => {
      contentPending()
      visibleMessages()
      assistantThinkingVisible()
    },
  })

  // Parts auto-collapse only while the reader is at the tail, and remember
  // explicit toggles per session.
  const transcriptChrome = {
    following: () => !scroll.scrolledAway(),
    disclosure: () => sessionDisclosureStore(props.sessionID),
    live: () => props.running === true,
  }
  const clearAssistantThinkingTimer = () => {
    if (assistantThinkingTimer === undefined) return
    clearTimeout(assistantThinkingTimer)
    assistantThinkingTimer = undefined
  }
  const emptyStateVisible = createMemo(
    () => (!props.emptyStateDismissed || emptyStateHandoff()) && !contentPending() && !transcriptHasContent(),
  )

  // "Load more" detaches this transcript from the live tail window. Once the
  // reader is back at the bottom and new messages are arriving, the older pages
  // they expanded for are off screen and only cost memory and layout, so the
  // window collapses back to the tail budget - "Load more" reopens it.
  let tailAnchor = { sessionID: "", messageID: "" }
  // Guarded: collapsing rewrites the message list this effect reads, and the
  // comparison it converges on lives in plain mutable state.
  createStableEffect("transcript.collapseWindow", () => {
    const sessionID = props.sessionID
    const messageID = visibleMessageIDs().at(-1) ?? ""
    const previous = tailAnchor
    tailAnchor = { sessionID, messageID }
    if (!props.data.messageWindowExpanded || !props.collapseMessageWindow) return
    if (previous.sessionID !== sessionID || !previous.messageID || previous.messageID === messageID) return
    if (scroll.scrolledAway()) return
    props.collapseMessageWindow()
  })

  createEffect(() => {
    const running = props.running === true
    const hasProgress = activeAssistantHasProgress()
    activeAssistantProgressKey()
    clearAssistantThinkingTimer()
    if (!running) {
      setAssistantThinkingVisible(false)
      return
    }
    if (!hasProgress) {
      setAssistantThinkingVisible(true)
      return
    }
    setAssistantThinkingVisible(false)
    assistantThinkingTimer = setTimeout(() => setAssistantThinkingVisible(true), ASSISTANT_THINKING_DELAY_MS)
  })
  onCleanup(clearAssistantThinkingTimer)

  return (
    <TranscriptChromeProvider value={transcriptChrome}>
    <div class="transcript-shell" classList={{ "has-prompt-history": props.showPromptHistory === true }}>
      <section
        class="transcript"
        classList={{ "hide-scrollbar": !props.showScrollbar }}
        ref={scroll.setTranscript}
        onScroll={scroll.handleScroll}
        onWheel={scroll.handleWheel}
        onPointerDown={scroll.handlePointerDown}
        onTouchStart={scroll.handleTouchStart}
      >
        <div class="transcript-content" ref={scroll.setTranscriptContent} data-conceal-code={props.concealCodeBlocks ? "true" : undefined} onClick={scroll.handleContentClick} onKeyDown={scroll.handleContentKeyDown}>
          <Show when={props.data.messageCursor}>
            <div class="transcript-load-more-anchor" ref={scroll.setLoadMoreAnchorElement}>
              <Show
                when={scroll.olderMessagesLoading()}
                fallback={
                  <Button appearance="ghost" type="button" class="transcript-window-button" onClick={() => void scroll.loadOlder()}>
                    Load more
                  </Button>
                }
              >
                <div class="transcript-page-loader" aria-live="polite" aria-busy="true">
                  <span class="session-loading-spinner" />
                  <span>Loading older messages...</span>
                </div>
              </Show>
            </div>
          </Show>
          <For each={visibleMessageIDs()}>
            {(messageID, index) => {
              const bundle = createMemo(() => visibleMessageMap().get(messageID))
              return (
                <Show when={bundle()}>
                  {(current) => {
                    const parts = createMemo(() => groupTranscriptParts(current().parts))
                    const partMap = createMemo(() => new Map(parts().map((item) => [item.key, item])))
                    return <article class={`message ${current().info.role}`} data-message-id={messageID}>
                      <Show when={showTranscriptHeader(visibleMessages(), index(), props.showTimestamps)}>
                        <header>{transcriptHeaderLabel(current().info, props.providers, props.showTimestamps)}</header>
                      </Show>
                      <For each={parts().map((item) => item.key)}>
                        {(key) => {
                          const item = createMemo(() => partMap().get(key))
                          return <Show when={item()}>
                            {(currentItem) => <DisplayPartView item={currentItem()} showThinking={props.showThinking} showToolDetails={props.showToolDetails} showGenericToolOutput={props.showGenericToolOutput} streamingPartID={streamingPartID()} messageCompleted={assistantCompleted(current().info)} />}
                          </Show>
                        }}
                      </For>
                      <TranscriptMessageError message={current().info} providers={props.providers} connectProvider={props.connectProvider} />
                      <Show when={props.messageAction}>
                        {(onAction) => <MessageActions bundle={current()} pending={pendingSession()} onAction={onAction()} />}
                      </Show>
                    </article>
                  }}
                </Show>
              )
            }}
          </For>
          <Show when={assistantThinkingVisible()}>
            <div class="message assistant assistant-thinking-message" aria-live="polite" aria-busy="true">
              <div class="assistant-thinking-indicator">
                <span>Thinking...</span>
              </div>
            </div>
          </Show>
        </div>
      </section>
      <Show when={promptHistory().length > 0}>
        <PromptHistoryRail side="left" entries={promptHistory()} jump={scroll.jumpToMessage} />
        <PromptHistoryRail side="right" entries={promptHistory()} jump={scroll.jumpToMessage} />
      </Show>
      <Show when={props.running === true}>
        <div class="transcript-streaming-indicator" aria-hidden="true"><span /></div>
      </Show>
      <Show when={scroll.scrolledAway()}>
        <Button appearance="outline" type="button" class="transcript-jump-latest" onClick={scroll.jumpToLatest}>
          <Icon name="arrowDown" />
          <span>{scroll.newMessageCount() > 0 ? `${scroll.newMessageCount()} new message${scroll.newMessageCount() === 1 ? "" : "s"}` : "Jump to latest"}</span>
        </Button>
      </Show>
      <SessionEmptyState visible={emptyStateVisible()} handoff={emptyStateHandoff()} onSuggestion={props.emptyStateSuggestion} />
      <TranscriptLoadingSkeleton visible={scroll.loadingSkeletonVisible()} />
    </div>
    </TranscriptChromeProvider>
  )
}

import { Button } from "./ui"
import type { Provider } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { MessageBundle, SessionData } from "../lib/store"
import type { SessionMessageActionKind } from "../lib/message-actions"
import { visibleTranscriptMessageIDs, visibleTranscriptMessages } from "../lib/transcript-visibility"
import { Icon } from "./icon"
import { MessageActions } from "./message-actions"
import { sessionDisclosureStore } from "../lib/disclosure"
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
  running?: boolean
  emptyStateDismissed?: boolean
  emptyStateHandoff?: boolean
  loadOlderMessages?: (cursor: string) => Promise<void>
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
  createEffect(() => {
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
    <div class="transcript-shell">
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

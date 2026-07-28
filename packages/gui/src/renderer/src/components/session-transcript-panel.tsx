import { Button } from "./ui"
import type { Provider } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { MessageBundle, SessionData } from "../lib/store"
import type { SessionMessageActionContext, SessionMessageActionKind } from "../lib/message-actions"
import { revealConcealedCode, syncConcealedCodeControls } from "../lib/transcript-code-conceal"
import {
  transcriptFollowStateAfterScroll,
  transcriptFollowStateAfterUserInput,
  transcriptBottomScrollTop,
  transcriptLoadMoreScrollTop,
  transcriptNewMessageCount,
  shouldSpendTranscriptOpenBottomScroll,
  transcriptLoadingSkeletonDecision,
  transcriptBottomDistance,
  TRANSCRIPT_BOTTOM_FOLLOW_THRESHOLD,
  type TranscriptFollowState,
} from "../lib/transcript-scroll"
import { observeTranscriptScrollGeometry } from "../lib/transcript-viewport"
import { visibleTranscriptMessageIDs, visibleTranscriptMessages } from "../lib/transcript-visibility"
import { Icon } from "./icon"
import { MessageActions } from "./message-actions"
import { sessionDisclosureStore } from "../lib/disclosure"
import { TranscriptChromeProvider } from "./session-part-chrome"
import { DisplayPartView, activeTranscriptStreamingPartID, groupTranscriptParts } from "./session-transcript"
import { SessionEmptyState, TranscriptLoadingSkeleton, TranscriptMessageError, activeAssistantProgressParts, hasActiveAssistantProgress, isScrollbarPointer, showTranscriptHeader, transcriptHeaderLabel } from "./session-transcript-presentation"

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
  let transcript: HTMLElement | undefined
  let transcriptContent: HTMLDivElement | undefined
  let loadMoreAnchorElement: HTMLDivElement | undefined
  let scrollFrame: number | undefined
  let loadingSkeletonFrame: number | undefined
  let assistantThinkingTimer: ReturnType<typeof setTimeout> | undefined
  let followState: TranscriptFollowState = { followBottom: true, releasedUntil: 0 }
  let loadMoreAnchor: { element: HTMLElement; top: number; scrollTop: number; scrollHeight: number } | undefined
  let forceBottomScroll = false
  let activeSessionID = ""
  let lastMessageIDAtRelease = ""
  const [olderMessagesLoading, setOlderMessagesLoading] = createSignal(false)
  const [assistantThinkingVisible, setAssistantThinkingVisible] = createSignal(false)
  const [scrolledAway, setScrolledAway] = createSignal(false)
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
  const [loadingSkeletonVisible, setLoadingSkeletonVisible] = createSignal(true)
  const pendingSession = () => props.sessionID.startsWith("pending:")
  const newMessageCount = createMemo(() => scrolledAway() ? transcriptNewMessageCount(visibleMessageIDs(), lastMessageIDAtRelease) : 0)
  // Parts auto-collapse only while the reader is at the tail, and remember
  // explicit toggles per session.
  const transcriptChrome = {
    following: () => !scrolledAway(),
    disclosure: () => sessionDisclosureStore(props.sessionID),
    live: () => props.running === true,
  }
  const clearAssistantThinkingTimer = () => {
    if (assistantThinkingTimer === undefined) return
    clearTimeout(assistantThinkingTimer)
    assistantThinkingTimer = undefined
  }
  const scheduleScrollUpdate = () => {
    if (scrollFrame !== undefined) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined
      applyScrollUpdate()
    })
  }
  const clearScrollFrame = () => {
    if (scrollFrame === undefined) return
    cancelAnimationFrame(scrollFrame)
    scrollFrame = undefined
  }
  const clearLoadingSkeletonFrame = () => {
    if (loadingSkeletonFrame === undefined) return
    cancelAnimationFrame(loadingSkeletonFrame)
    loadingSkeletonFrame = undefined
  }
  const emptyStateVisible = createMemo(
    () => (!props.emptyStateDismissed || emptyStateHandoff()) && !contentPending() && !transcriptHasContent(),
  )
  const showLoadingSkeleton = () => {
    clearLoadingSkeletonFrame()
    if (!loadingSkeletonVisible()) setLoadingSkeletonVisible(true)
  }
  const hideLoadingSkeleton = () => {
    clearLoadingSkeletonFrame()
    if (loadingSkeletonVisible()) setLoadingSkeletonVisible(false)
  }
  const hideLoadingSkeletonAfterScroll = () => {
    if (loadingSkeletonFrame !== undefined) return
    loadingSkeletonFrame = requestAnimationFrame(() => {
      loadingSkeletonFrame = undefined
      if (!contentPending() && !forceBottomScroll) setLoadingSkeletonVisible(false)
    })
  }
  const updateLoadingSkeleton = () => {
    const decision = transcriptLoadingSkeletonDecision({
      loading: contentPending(),
      visible: loadingSkeletonVisible(),
      forceBottomScroll,
      hasContent: transcriptHasContent(),
    })
    if (decision === "show") {
      showLoadingSkeleton()
      return
    }
    if (decision === "hide") hideLoadingSkeleton()
  }
  const updateJumpPill = () => {
    if (!transcript) return
    const away = transcriptBottomDistance({
      scrollTop: transcript.scrollTop,
      scrollHeight: transcript.scrollHeight,
      clientHeight: transcript.clientHeight,
    }) > TRANSCRIPT_BOTTOM_FOLLOW_THRESHOLD
    if (away && !scrolledAway()) lastMessageIDAtRelease = visibleMessageIDs().at(-1) ?? ""
    setScrolledAway(away)
  }
  const jumpToLatest = () => {
    if (!transcript) return
    followState = { followBottom: true, releasedUntil: 0 }
    transcript.scrollTop = transcriptBottomScrollTop(transcript)
    setScrolledAway(false)
  }
  const applyScrollUpdate = () => {
    if (!transcript) return
    syncConcealedCodeControls(transcriptContent, props.concealCodeBlocks)
    if (loadMoreAnchor) {
      restoreLoadMoreAnchor()
      return
    }
    if (forceBottomScroll) {
      if (!shouldSpendTranscriptOpenBottomScroll({ loading: contentPending(), hasContent: transcriptHasContent() })) return
      forceBottomScroll = false
      followState = { followBottom: true, releasedUntil: 0 }
      transcript.scrollTop = transcriptBottomScrollTop(transcript)
      hideLoadingSkeletonAfterScroll()
      return
    }
    if (!followState.followBottom) {
      followState = transcriptFollowStateAfterScroll(followState, {
        scrollTop: transcript.scrollTop,
        scrollHeight: transcript.scrollHeight,
        clientHeight: transcript.clientHeight,
      })
    }
    if (followState.followBottom) transcript.scrollTop = transcriptBottomScrollTop(transcript)
    updateJumpPill()
  }
  const restoreLoadMoreAnchor = () => {
    if (!transcript || !loadMoreAnchor) return
    transcript.scrollTop = transcriptLoadMoreScrollTop({
      anchorTop: loadMoreAnchor.top,
      nextAnchorTop: loadMoreAnchor.element.isConnected
        ? loadMoreAnchor.element.getBoundingClientRect().top - transcript.getBoundingClientRect().top
        : undefined,
      scrollTop: loadMoreAnchor.scrollTop,
      scrollHeight: loadMoreAnchor.scrollHeight,
      nextScrollHeight: transcript.scrollHeight,
    })
  }
  const finishLoadMoreAnchor = () => {
    clearScrollFrame()
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined
      restoreLoadMoreAnchor()
      loadMoreAnchor = undefined
    })
  }
  const captureLoadMoreAnchor = () => {
    if (!transcript) return
    const anchorElement = loadMoreAnchorElement
    if (!anchorElement) return
    loadMoreAnchor = {
      element: anchorElement,
      top: anchorElement.getBoundingClientRect().top - transcript.getBoundingClientRect().top,
      scrollTop: transcript.scrollTop,
      scrollHeight: transcript.scrollHeight,
    }
    releaseTranscriptScroll()
  }
  const handleScroll = () => {
    if (!transcript) return
    if (forceBottomScroll || followState.followBottom) return
    followState = transcriptFollowStateAfterScroll(followState, {
      scrollTop: transcript.scrollTop,
      scrollHeight: transcript.scrollHeight,
      clientHeight: transcript.clientHeight,
    })
    updateJumpPill()
  }
  const handleWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) releaseTranscriptScroll()
  }
  const handlePointerDown = (event: PointerEvent) => {
    if (transcript && isScrollbarPointer(event, transcript)) releaseTranscriptScroll()
  }
  const handleTouchStart = () => {
    releaseTranscriptScroll()
  }
  const releaseTranscriptScroll = () => {
    forceBottomScroll = false
    followState = transcriptFollowStateAfterUserInput()
  }
  const loadOlderMessages = async () => {
    const cursor = props.data.messageCursor
    if (!cursor || !props.loadOlderMessages || olderMessagesLoading()) return
    captureLoadMoreAnchor()
    setOlderMessagesLoading(true)
    await props.loadOlderMessages(cursor).finally(() => {
      setOlderMessagesLoading(false)
      finishLoadMoreAnchor()
    })
  }
  const handleContentClick = (event: MouseEvent) => {
    if (!props.concealCodeBlocks) return
    const target = event.target instanceof Element ? event.target : undefined
    const wrapper = target?.closest('[data-component="markdown-code"]')
    if (!wrapper || wrapper.hasAttribute("data-revealed")) return
    if (target?.closest('[data-slot="markdown-copy-button"]')) return
    revealConcealedCode(transcriptContent, wrapper, props.concealCodeBlocks)
  }
  const handleContentKeyDown = (event: KeyboardEvent) => {
    if (!props.concealCodeBlocks || (event.key !== "Enter" && event.key !== " ")) return
    const wrapper = event.target instanceof Element ? event.target.closest('[data-component="markdown-code"]') : undefined
    if (!wrapper || wrapper.hasAttribute("data-revealed")) return
    event.preventDefault()
    revealConcealedCode(transcriptContent, wrapper, props.concealCodeBlocks)
  }

  onMount(() => {
    // The composer growing or the safety dock appearing resizes the viewport;
    // the observer compensates `scrollTop` before paint so the transcript never
    // visibly jumps away and snaps back. Content growth still settles on the
    // next frame via `scheduleScrollUpdate`.
    const cleanup = observeTranscriptScrollGeometry({
      viewport: () => transcript,
      content: () => transcriptContent,
      followBottom: () => followState.followBottom,
      suspended: () => Boolean(loadMoreAnchor) || forceBottomScroll,
      update: scheduleScrollUpdate,
    })
    scheduleScrollUpdate()
    onCleanup(cleanup)
  })
  createEffect(() => {
    visibleMessages()
    activeAssistantProgressKey()
    assistantThinkingVisible()
    props.showThinking
    props.showToolDetails
    props.showGenericToolOutput
    contentPending()
    props.data.messageCursor
    scheduleScrollUpdate()
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
  onCleanup(() => {
    clearScrollFrame()
    clearLoadingSkeletonFrame()
    clearAssistantThinkingTimer()
  })
  createEffect(() => {
    contentPending()
    visibleMessages()
    assistantThinkingVisible()
    updateLoadingSkeleton()
  })
  createEffect(() => {
    const sessionChanged = activeSessionID !== props.sessionID
    activeSessionID = props.sessionID
    if (sessionChanged) {
      followState = { followBottom: true, releasedUntil: 0 }
      loadMoreAnchor = undefined
      forceBottomScroll = true
      lastMessageIDAtRelease = ""
      setScrolledAway(false)
      scheduleScrollUpdate()
    }
  })

  return (
    <TranscriptChromeProvider value={transcriptChrome}>
    <div class="transcript-shell">
      <section
        class="transcript"
        classList={{ "hide-scrollbar": !props.showScrollbar }}
        ref={transcript}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onTouchStart={handleTouchStart}
      >
        <div class="transcript-content" ref={transcriptContent} data-conceal-code={props.concealCodeBlocks ? "true" : undefined} onClick={handleContentClick} onKeyDown={handleContentKeyDown}>
          <Show when={props.data.messageCursor}>
            <div class="transcript-load-more-anchor" ref={loadMoreAnchorElement}>
              <Show
                when={olderMessagesLoading()}
                fallback={
                  <Button appearance="ghost" type="button" class="transcript-window-button" onClick={() => void loadOlderMessages()}>
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
      <Show when={scrolledAway()}>
        <Button appearance="outline" type="button" class="transcript-jump-latest" onClick={jumpToLatest}>
          <Icon name="arrowDown" />
          <span>{newMessageCount() > 0 ? `${newMessageCount()} new message${newMessageCount() === 1 ? "" : "s"}` : "Jump to latest"}</span>
        </Button>
      </Show>
      <SessionEmptyState visible={emptyStateVisible()} handoff={emptyStateHandoff()} onSuggestion={props.emptyStateSuggestion} />
      <TranscriptLoadingSkeleton visible={loadingSkeletonVisible()} />
    </div>
    </TranscriptChromeProvider>
  )
}

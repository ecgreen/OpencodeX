import { Button } from "./ui"
import type { Provider } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { MessageBundle, SessionData } from "../lib/store"
import {
  transcriptFollowStateAfterScroll,
  transcriptFollowStateAfterUserInput,
  transcriptBottomScrollTop,
  transcriptLoadMoreScrollTop,
  shouldSpendTranscriptOpenBottomScroll,
  transcriptLoadingSkeletonDecision,
  type TranscriptFollowState,
} from "../lib/transcript-scroll"
import { visibleTranscriptMessageIDs, visibleTranscriptMessages } from "../lib/transcript-visibility"
import { DisplayPartView, groupTranscriptParts } from "./session-transcript"
import { SessionEmptyState, TranscriptLoadingSkeleton, activeAssistantProgressParts, hasActiveAssistantProgress, isScrollbarPointer, showTranscriptHeader, transcriptHeaderLabel } from "./session-transcript-presentation"

const ASSISTANT_THINKING_DELAY_MS = 1_600

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
  running?: boolean
  emptyStateDismissed?: boolean
  emptyStateHandoff?: boolean
  loadOlderMessages?: (cursor: string) => Promise<void>
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
  const [olderMessagesLoading, setOlderMessagesLoading] = createSignal(false)
  const [assistantThinkingVisible, setAssistantThinkingVisible] = createSignal(false)
  const visibleMessages = createMemo(() => visibleTranscriptMessages(props.data.messages))
  const visibleMessageIDs = createMemo(() => visibleTranscriptMessageIDs(props.data.messages))
  const activeAssistantHasProgress = createMemo(() => hasActiveAssistantProgress(visibleMessages()))
  const activeAssistantProgressKey = createMemo(() => activeAssistantProgressParts(visibleMessages()).join("|"))
  const emptyStateHandoff = () => props.emptyStateHandoff === true
  const transcriptHasContent = () => visibleMessages().length > 0 || assistantThinkingVisible()
  const [loadingSkeletonVisible, setLoadingSkeletonVisible] = createSignal(props.loading)
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
    () => (!props.emptyStateDismissed || emptyStateHandoff()) && !props.loading && !transcriptHasContent(),
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
      if (!props.loading && !forceBottomScroll) setLoadingSkeletonVisible(false)
    })
  }
  const updateLoadingSkeleton = () => {
    const decision = transcriptLoadingSkeletonDecision({
      loading: props.loading,
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
  const applyScrollUpdate = () => {
    if (!transcript) return
    if (loadMoreAnchor) {
      restoreLoadMoreAnchor()
      return
    }
    if (forceBottomScroll) {
      if (!shouldSpendTranscriptOpenBottomScroll({ loading: props.loading, hasContent: transcriptHasContent() })) return
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

  onMount(() => {
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleScrollUpdate)
    if (transcript) observer?.observe(transcript)
    if (transcriptContent) observer?.observe(transcriptContent)
    scheduleScrollUpdate()
    onCleanup(() => observer?.disconnect())
  })
  createEffect(() => {
    visibleMessages()
    activeAssistantProgressKey()
    assistantThinkingVisible()
    props.showThinking
    props.showToolDetails
    props.showGenericToolOutput
    props.loading
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
    props.loading
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
      scheduleScrollUpdate()
    }
  })

  return (
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
        <div class="transcript-content" ref={transcriptContent}>
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
              const bundle = createMemo(() => visibleMessages().find((item) => item.info.id === messageID))
              return (
                <Show when={bundle()}>
                  {(current) => (
                    <article class={`message ${current().info.role}`} data-message-id={messageID}>
                      <Show when={showTranscriptHeader(visibleMessages(), index(), props.showTimestamps)}>
                        <header>{transcriptHeaderLabel(current().info, props.providers, props.showTimestamps)}</header>
                      </Show>
                      <For each={groupTranscriptParts(current().parts)}>
                        {(item) => (
                          <DisplayPartView
                            item={item}
                            showThinking={props.showThinking}
                            showToolDetails={props.showToolDetails}
                            showGenericToolOutput={props.showGenericToolOutput}
                          />
                        )}
                      </For>
                    </article>
                  )}
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
      <SessionEmptyState visible={emptyStateVisible()} handoff={emptyStateHandoff()} />
      <TranscriptLoadingSkeleton visible={loadingSkeletonVisible()} />
    </div>
  )
}

import { createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor } from "solid-js"
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
import { isScrollbarPointer } from "./session-transcript-presentation"

/**
 * Owns every mutable scroll and loading-skeleton concern of the transcript so
 * the panel component stays declarative. Automatic scroll behaviour is
 * deliberately centralized here; the pure decision helpers it calls live in
 * `lib/transcript-scroll.ts`.
 *
 * The two `track*` callbacks exist so the caller decides which of its own
 * reactive reads should schedule a scroll or skeleton update - the controller
 * runs them inside its effects without needing to know the panel's props.
 */
export function createTranscriptScrollController(input: {
  sessionID: Accessor<string>
  messageCursor: Accessor<string | undefined>
  contentPending: Accessor<boolean>
  transcriptHasContent: Accessor<boolean>
  visibleMessageIDs: Accessor<string[]>
  concealCodeBlocks: Accessor<boolean>
  loadOlderMessages: Accessor<((cursor: string) => Promise<void>) | undefined>
  trackScrollDependencies: () => void
  trackSkeletonDependencies: () => void
}) {
  let transcript: HTMLElement | undefined
  let transcriptContent: HTMLDivElement | undefined
  let loadMoreAnchorElement: HTMLDivElement | undefined
  let scrollFrame: number | undefined
  let loadingSkeletonFrame: number | undefined
  let followState: TranscriptFollowState = { followBottom: true, releasedUntil: 0 }
  let loadMoreAnchor: { element: HTMLElement; top: number; scrollTop: number; scrollHeight: number } | undefined
  let forceBottomScroll = false
  let activeSessionID = ""
  let lastMessageIDAtRelease = ""
  const [olderMessagesLoading, setOlderMessagesLoading] = createSignal(false)
  const [scrolledAway, setScrolledAway] = createSignal(false)
  const [loadingSkeletonVisible, setLoadingSkeletonVisible] = createSignal(true)

  const newMessageCount = createMemo(() =>
    scrolledAway() ? transcriptNewMessageCount(input.visibleMessageIDs(), lastMessageIDAtRelease) : 0,
  )

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
      if (!input.contentPending() && !forceBottomScroll) setLoadingSkeletonVisible(false)
    })
  }
  const updateLoadingSkeleton = () => {
    const decision = transcriptLoadingSkeletonDecision({
      loading: input.contentPending(),
      visible: loadingSkeletonVisible(),
      forceBottomScroll,
      hasContent: input.transcriptHasContent(),
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
    if (away && !scrolledAway()) lastMessageIDAtRelease = input.visibleMessageIDs().at(-1) ?? ""
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
    syncConcealedCodeControls(transcriptContent, input.concealCodeBlocks())
    if (loadMoreAnchor) {
      restoreLoadMoreAnchor()
      return
    }
    if (forceBottomScroll) {
      if (!shouldSpendTranscriptOpenBottomScroll({ loading: input.contentPending(), hasContent: input.transcriptHasContent() })) return
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
  const releaseTranscriptScroll = () => {
    forceBottomScroll = false
    followState = transcriptFollowStateAfterUserInput()
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
  const loadOlder = async () => {
    const cursor = input.messageCursor()
    const load = input.loadOlderMessages()
    if (!cursor || !load || olderMessagesLoading()) return
    captureLoadMoreAnchor()
    setOlderMessagesLoading(true)
    await load(cursor).finally(() => {
      setOlderMessagesLoading(false)
      finishLoadMoreAnchor()
    })
  }
  const handleContentClick = (event: MouseEvent) => {
    if (!input.concealCodeBlocks()) return
    const target = event.target instanceof Element ? event.target : undefined
    const wrapper = target?.closest('[data-component="markdown-code"]')
    if (!wrapper || wrapper.hasAttribute("data-revealed")) return
    if (target?.closest('[data-slot="markdown-copy-button"]')) return
    revealConcealedCode(transcriptContent, wrapper, input.concealCodeBlocks())
  }
  const handleContentKeyDown = (event: KeyboardEvent) => {
    if (!input.concealCodeBlocks() || (event.key !== "Enter" && event.key !== " ")) return
    const wrapper = event.target instanceof Element ? event.target.closest('[data-component="markdown-code"]') : undefined
    if (!wrapper || wrapper.hasAttribute("data-revealed")) return
    event.preventDefault()
    revealConcealedCode(transcriptContent, wrapper, input.concealCodeBlocks())
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
    input.trackScrollDependencies()
    scheduleScrollUpdate()
  })
  createEffect(() => {
    input.trackSkeletonDependencies()
    updateLoadingSkeleton()
  })
  createEffect(() => {
    const sessionChanged = activeSessionID !== input.sessionID()
    activeSessionID = input.sessionID()
    if (sessionChanged) {
      followState = { followBottom: true, releasedUntil: 0 }
      loadMoreAnchor = undefined
      forceBottomScroll = true
      lastMessageIDAtRelease = ""
      setScrolledAway(false)
      scheduleScrollUpdate()
    }
  })
  onCleanup(() => {
    clearScrollFrame()
    clearLoadingSkeletonFrame()
  })

  return {
    setTranscript: (element: HTMLElement) => { transcript = element },
    setTranscriptContent: (element: HTMLDivElement) => { transcriptContent = element },
    setLoadMoreAnchorElement: (element: HTMLDivElement) => { loadMoreAnchorElement = element },
    handleScroll,
    handleWheel,
    handlePointerDown,
    handleTouchStart,
    handleContentClick,
    handleContentKeyDown,
    loadOlder,
    jumpToLatest,
    olderMessagesLoading,
    scrolledAway,
    loadingSkeletonVisible,
    newMessageCount,
  }
}

import type { AssistantMessage, Provider } from "@opencode-ai/sdk/v2/client"
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
import { OpencodeXLogo } from "./chrome"
import { DisplayPartView, groupTranscriptParts } from "./session-transcript"

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
                  <button type="button" class="transcript-window-button" onClick={() => void loadOlderMessages()}>
                    Load more
                  </button>
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

function hasActiveAssistantProgress(messages: MessageBundle[]) {
  return activeAssistantProgressParts(messages).length > 0
}

function activeAssistantProgressParts(messages: MessageBundle[]) {
  return messages
    .slice(messages.reduce((index, message, current) => (message.info.role === "user" ? current : index), -1) + 1)
    .filter((message) => message.info.role === "assistant")
    .flatMap((message) => message.parts.map(progressPartKey).filter((key): key is string => Boolean(key)))
}

function progressPartKey(part: MessageBundle["parts"][number]) {
  if (part.type === "text")
    return part.synthetic || part.ignored || !part.text.trim() ? undefined : `${part.id}:text:${part.text.length}`
  if (part.type === "reasoning") return part.text.trim() ? `${part.id}:reasoning:${part.text.length}` : undefined
  if (part.type === "tool")
    return `${part.id}:tool:${part.tool}:${part.state.status}:${toolStateProgressKey(part.state)}`
  if (part.type === "file") return `${part.id}:file`
  if (part.type === "agent") return `${part.id}:agent`
  if (part.type === "patch") return `${part.id}:patch:${part.files.join(",")}`
}

function toolStateProgressKey(state: Extract<MessageBundle["parts"][number], { type: "tool" }>["state"]) {
  if (state.status === "completed") return `${state.output?.length ?? 0}:${metadataProgressKey(state.metadata)}`
  if (state.status === "error") return state.error.length
  return `${"input" in state ? recordKeyList(state.input) : ""}:${metadataProgressKey("metadata" in state ? state.metadata : undefined)}`
}

function metadataProgressKey(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return ""
  return Object.entries(metadata)
    .map(
      ([key, value]) =>
        `${key}:${Array.isArray(value) ? value.length : typeof value === "string" ? value.length : value ? 1 : 0}`,
    )
    .join(",")
}

function recordKeyList(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ""
  return Object.keys(value).join(",")
}

function isScrollbarPointer(event: PointerEvent, element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return (
    (element.scrollHeight > element.clientHeight && event.clientX >= rect.right - 16) ||
    (element.scrollWidth > element.clientWidth && event.clientY >= rect.bottom - 16)
  )
}

function showTranscriptHeader(messages: MessageBundle[], index: number, showTimestamps: boolean) {
  const message = messages[index]
  if (!message) return false
  if (message.info.role === "user") return showTimestamps
  return messages[index - 1]?.info.role === "user"
}

function transcriptHeaderLabel(message: MessageBundle["info"], providers: Provider[], showTimestamps: boolean) {
  if (message.role === "user") return showTimestamps ? new Date(message.time.created).toLocaleString() : ""
  const label = assistantModelLabel(message, providers)
  if (!showTimestamps) return label
  return `${label} - ${new Date(message.time.created).toLocaleString()}`
}

function assistantModelLabel(message: AssistantMessage, providers: Provider[]) {
  const model = providers.find((provider) => provider.id === message.providerID)?.models[message.modelID]
  return model?.name ?? prettifyModelID(message.modelID)
}

function prettifyModelID(modelID: string) {
  return modelID
    .split(/[/:_-]+/)
    .filter(Boolean)
    .map((part) => (part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ")
}

function TranscriptLoadingSkeleton(props: { visible: boolean }) {
  return (
    <div
      class="session-loading-skeleton"
      classList={{ visible: props.visible }}
      aria-hidden={!props.visible}
      aria-busy={props.visible}
      aria-label="Loading transcript"
    >
      <div class="session-loading-skeleton-stack">
        <For each={[0, 1, 2, 3, 4, 5, 6]}>
          {(item) => (
            <div class="session-loading-skeleton-message" data-kind={item % 3 === 0 ? "user" : "assistant"}>
              <span class="session-loading-skeleton-line title" />
              <span class="session-loading-skeleton-line" />
              <span class="session-loading-skeleton-line" />
              <span class="session-loading-skeleton-line short" />
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function SessionEmptyState(props: { visible: boolean; handoff: boolean }) {
  return (
    <div
      class="session-empty-state"
      classList={{ visible: props.visible, handoff: props.handoff }}
      aria-hidden={!props.visible}
    >
      <OpencodeXLogo />
      <p>What should OpencodeX work on?</p>
    </div>
  )
}

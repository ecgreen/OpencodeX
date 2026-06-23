import type { AssistantMessage, Provider } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { MessageBundle, SessionData } from "../lib/store"
import { OpencodeXLogo } from "./chrome"
import { DisplayPartView, groupTranscriptParts } from "./session-transcript"

const OPEN_SCROLL_SETTLE_MIN_MS = 2_500
const OPEN_SCROLL_SETTLE_MAX_MS = 6_000
const OPEN_SCROLL_SETTLE_IDLE_MS = 350
const PROMPT_AUTO_SCROLL_BOTTOM_THRESHOLD = 100
const LOAD_MORE_ANCHOR_SETTLE_MS = 900
const LOAD_MORE_ANCHOR_INITIAL_FRAMES = 2

export function TranscriptPanel(props: {
  sessionID: string
  data: SessionData
  loading: boolean
  providers: Provider[]
  concealCodeBlocks: boolean
  showTimestamps: boolean
  showThinking: boolean
  showToolDetails: boolean
  showScrollbar: boolean
  showGenericToolOutput: boolean
  setPromptFollowStarter: (start: (() => void) | undefined) => void
  loadOlderMessages?: (cursor: string) => Promise<void>
}) {
  let transcript: HTMLElement | undefined
  let transcriptContent: HTMLDivElement | undefined
  let cancelOpenScroll: (() => void) | undefined
  let promptFollowFrame: number | undefined
  let promptFollowObserver: ResizeObserver | undefined
  let promptFollowing = false
  let promptFollowScrollTop = 0
  let activeSessionID = ""
  let openedScrollSessionID = ""
  const [olderMessagesLoading, setOlderMessagesLoading] = createSignal(false)
  const visibleMessages = createMemo(() => props.data.messages)
  const scrollToBottom = () => {
    if (!transcript) return
    transcript.scrollTop = transcript.scrollHeight
    if (promptFollowing) promptFollowScrollTop = transcript.scrollTop
  }
  const nearBottom = () => {
    if (!transcript) return true
    return transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <= PROMPT_AUTO_SCROLL_BOTTOM_THRESHOLD
  }
  const scheduleOpenedSessionScroll = () => {
    cancelOpenScroll?.()
    if (!transcript || !transcriptContent) return
    cancelOpenScroll = settleTranscriptOpenScroll(transcript, transcriptContent)
  }
  const stopPromptFollow = () => {
    promptFollowing = false
    if (promptFollowFrame !== undefined) {
      cancelAnimationFrame(promptFollowFrame)
      promptFollowFrame = undefined
    }
    promptFollowObserver?.disconnect()
    promptFollowObserver = undefined
  }
  const schedulePromptFollowScroll = () => {
    if (!promptFollowing || promptFollowFrame !== undefined) return
    promptFollowFrame = requestAnimationFrame(() => {
      promptFollowFrame = undefined
      if (promptFollowing) scrollToBottom()
    })
  }
  const startPromptFollow = () => {
    if (!transcript || !transcriptContent || !nearBottom()) {
      stopPromptFollow()
      return
    }
    cancelOpenScroll?.()
    cancelOpenScroll = undefined
    promptFollowing = true
    promptFollowScrollTop = transcript.scrollTop
    promptFollowObserver?.disconnect()
    promptFollowObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedulePromptFollowScroll)
    promptFollowObserver?.observe(transcriptContent)
    schedulePromptFollowScroll()
  }
  const handleScroll = () => {
    if (!promptFollowing || !transcript) return
    const scrollTop = transcript.scrollTop
    if (scrollTop < promptFollowScrollTop && !nearBottom()) {
      promptFollowScrollTop = scrollTop
      stopPromptFollow()
      return
    }
    promptFollowScrollTop = scrollTop
    if (!nearBottom()) stopPromptFollow()
  }
  const handleWheel = (event: WheelEvent) => {
    if (promptFollowing && event.deltaY < 0) stopPromptFollow()
  }
  const loadOlderMessages = async () => {
    const cursor = props.data.messageCursor
    if (!cursor || !props.loadOlderMessages || olderMessagesLoading()) return
    stopPromptFollow()
    cancelOpenScroll?.()
    cancelOpenScroll = undefined
    const restoreAnchor = captureTranscriptPrependAnchor(transcript, transcriptContent)
    setOlderMessagesLoading(true)
    await props.loadOlderMessages(cursor).finally(() => {
      setOlderMessagesLoading(false)
      restoreAnchor()
    })
  }

  props.setPromptFollowStarter(startPromptFollow)
  onCleanup(() => {
    props.setPromptFollowStarter(undefined)
    cancelOpenScroll?.()
    stopPromptFollow()
  })
  createEffect(() => {
    const sessionChanged = activeSessionID !== props.sessionID
    activeSessionID = props.sessionID
    if (sessionChanged) {
      cancelOpenScroll?.()
      cancelOpenScroll = undefined
      stopPromptFollow()
      openedScrollSessionID = ""
    }
    if (!props.sessionID || openedScrollSessionID === props.sessionID) return
    if (props.loading && visibleMessages().length === 0) return
    openedScrollSessionID = props.sessionID
    scheduleOpenedSessionScroll()
  })

  return (
    <section class="transcript" classList={{ "hide-scrollbar": !props.showScrollbar }} ref={transcript} onScroll={handleScroll} onWheel={handleWheel}>
      <div class="transcript-content" ref={transcriptContent}>
        <Show when={!props.loading} fallback={<TranscriptLoadingState />}>
          <Show when={props.data.messageCursor}>
            <Show when={olderMessagesLoading()} fallback={(
              <button type="button" class="transcript-window-button" onClick={() => void loadOlderMessages()}>
                Load more
              </button>
            )}>
              <div class="transcript-page-loader" aria-live="polite" aria-busy="true">
                <span class="session-loading-spinner" />
                <span>Loading older messages...</span>
              </div>
            </Show>
          </Show>
          <For each={visibleMessages()} fallback={<SessionEmptyState />}>
            {(bundle, index) => (
              <article class={`message ${bundle.info.role}`} data-message-id={bundle.info.id}>
                <Show when={showTranscriptHeader(visibleMessages(), index())}>
                  <header>{transcriptHeaderLabel(bundle.info, props.providers, props.showTimestamps)}</header>
                </Show>
                <For each={groupTranscriptParts(bundle.parts)}>
                  {(item) => (
                    <DisplayPartView
                      item={item}
                      concealCodeBlocks={props.concealCodeBlocks}
                      showThinking={props.showThinking}
                      showToolDetails={props.showToolDetails}
                      showGenericToolOutput={props.showGenericToolOutput}
                    />
                  )}
                </For>
              </article>
            )}
          </For>
        </Show>
      </div>
    </section>
  )
}

function settleTranscriptOpenScroll(transcript: HTMLElement, content: HTMLElement) {
  let frame: number | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let maxTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const startedAt = performance.now()
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
    scheduleScroll()
    scheduleIdleFinish()
  })
  const clearFrame = () => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
    frame = undefined
  }
  const clearIdleTimer = () => {
    if (idleTimer === undefined) return
    clearTimeout(idleTimer)
    idleTimer = undefined
  }
  const clearMaxTimer = () => {
    if (maxTimer === undefined) return
    clearTimeout(maxTimer)
    maxTimer = undefined
  }
  const scrollToBottom = () => {
    transcript.scrollTop = transcript.scrollHeight
  }
  const stop = () => {
    if (stopped) return
    stopped = true
    clearFrame()
    clearIdleTimer()
    clearMaxTimer()
    observer?.disconnect()
    transcript.removeEventListener("wheel", stop)
    transcript.removeEventListener("touchstart", stop)
    transcript.removeEventListener("pointerdown", stop)
  }
  const finish = () => {
    if (stopped) return
    scrollToBottom()
    stop()
  }
  const scheduleScroll = () => {
    if (stopped || frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      scrollToBottom()
    })
  }
  const scheduleIdleFinish = () => {
    if (stopped) return
    clearIdleTimer()
    idleTimer = setTimeout(() => {
      if (performance.now() - startedAt < OPEN_SCROLL_SETTLE_MIN_MS) {
        scheduleIdleFinish()
        return
      }
      finish()
    }, OPEN_SCROLL_SETTLE_IDLE_MS)
  }

  observer?.observe(content)
  transcript.addEventListener("wheel", stop, { passive: true })
  transcript.addEventListener("touchstart", stop, { passive: true })
  transcript.addEventListener("pointerdown", stop, { passive: true })
  maxTimer = setTimeout(finish, OPEN_SCROLL_SETTLE_MAX_MS)
  scheduleScroll()
  scheduleIdleFinish()
  return stop
}

function captureTranscriptPrependAnchor(transcript: HTMLElement | undefined, content: HTMLElement | undefined) {
  if (!transcript || !content) return () => {}
  const transcriptTop = transcript.getBoundingClientRect().top
  const anchor = Array.from(content.querySelectorAll<HTMLElement>("[data-message-id]"))
    .find((element) => element.getBoundingClientRect().bottom > transcriptTop + 1)
  const anchorID = anchor?.dataset.messageId
  const anchorTop = anchor ? anchor.getBoundingClientRect().top - transcriptTop : 0
  const scrollTop = transcript.scrollTop
  const scrollHeight = transcript.scrollHeight
  let canceled = false
  let frame: number | undefined
  let observer: ResizeObserver | undefined
  let settleTimer: ReturnType<typeof setTimeout> | undefined

  const clearFrame = () => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
    frame = undefined
  }
  const cleanup = () => {
    clearFrame()
    if (settleTimer !== undefined) {
      clearTimeout(settleTimer)
      settleTimer = undefined
    }
    observer?.disconnect()
    observer = undefined
    transcript.removeEventListener("wheel", cancel)
    transcript.removeEventListener("touchstart", cancel)
    transcript.removeEventListener("pointerdown", cancel)
  }
  const cancel = () => {
    canceled = true
    cleanup()
  }
  const restore = () => {
    if (canceled || !transcript.isConnected || !content.isConnected) {
      cleanup()
      return
    }
    const nextAnchor = anchorID
      ? Array.from(content.querySelectorAll<HTMLElement>("[data-message-id]")).find((element) => element.dataset.messageId === anchorID)
      : undefined
    if (!nextAnchor) {
      transcript.scrollTop = scrollTop + transcript.scrollHeight - scrollHeight
      return
    }
    transcript.scrollTop += nextAnchor.getBoundingClientRect().top - transcript.getBoundingClientRect().top - anchorTop
  }
  const scheduleRestore = () => {
    if (canceled || frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      restore()
    })
  }
  const restoreForFrames = (remaining: number) => {
    if (remaining <= 0 || canceled) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      restore()
      restoreForFrames(remaining - 1)
    })
  }

  transcript.addEventListener("wheel", cancel, { passive: true })
  transcript.addEventListener("touchstart", cancel, { passive: true })
  transcript.addEventListener("pointerdown", cancel, { passive: true })

  return () => {
    if (canceled) return
    observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleRestore)
    observer?.observe(content)
    restoreForFrames(LOAD_MORE_ANCHOR_INITIAL_FRAMES)
    settleTimer = setTimeout(cleanup, LOAD_MORE_ANCHOR_SETTLE_MS)
  }
}

function showTranscriptHeader(messages: MessageBundle[], index: number) {
  const message = messages[index]
  if (!message) return false
  if (message.info.role === "user") return true
  return messages[index - 1]?.info.role === "user"
}

function transcriptHeaderLabel(message: MessageBundle["info"], providers: Provider[], showTimestamps: boolean) {
  const label = message.role === "user" ? "User" : assistantModelLabel(message, providers)
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
    .map((part) => part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function TranscriptLoadingState() {
  return (
    <div class="session-loading-state" aria-live="polite" aria-busy="true">
      <span class="session-loading-spinner" />
      <p>Loading...</p>
    </div>
  )
}

function SessionEmptyState() {
  return (
    <div class="session-empty-state">
      <OpencodeXLogo />
      <p>What should OpencodeX work on?</p>
    </div>
  )
}

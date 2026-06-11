import type { Agent, AssistantMessage, PermissionRequest, Provider, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { compactPath, title } from "../lib/format"
import { isFreeOpencodeModel, modelValue, parseModelValue, type ModelPickerOption } from "../lib/model-selection"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { MessageBundle, SessionData } from "../lib/store"
import { permissionToolPart } from "../lib/tool-display"
import { Icon } from "./icon"
import { OpencodeXLogo } from "./chrome"
import { DisplayPartView, PermissionPanel, QuestionPanel, groupTranscriptParts } from "./session-transcript"
import { StatusPill } from "./status-pill"

const OPEN_SCROLL_SETTLE_MIN_MS = 2_500
const OPEN_SCROLL_SETTLE_MAX_MS = 6_000
const OPEN_SCROLL_SETTLE_IDLE_MS = 350
const PROMPT_AUTO_SCROLL_BOTTOM_THRESHOLD = 100

export function SessionPage(props: {
  session?: Session
  data: SessionData
  loading: boolean
  prompt: string
  setPrompt: (value: string) => void
  providers: Provider[]
  agents: Agent[]
  selectedAgent: string
  setSelectedAgent: (value: string) => void
  selectedModel: string
  recentModels: string[]
  setSelectedModel: (value: string) => void
  selectedVariant: string
  setSelectedVariant: (value: string) => void
  submit: (event: SubmitEvent, text: string) => void
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  replyPermission: (request: PermissionRequest, reply: "once" | "always" | "reject") => void
  replyQuestion: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  rejectQuestion: (request: QuestionRequest) => void
  abortSession: (sessionID: string) => void
  renameSession: (session: Session) => void
  moveSession: (session: Session) => void
  deleteSession: (session: Session) => void
  slashCommands: SessionSlashCommand[]
  showTimestamps: boolean
  showThinking: boolean
  status?: string
  pending?: boolean
  composerFocusToken?: () => number
  loadOlderMessages?: (cursor: string) => Promise<void>
}) {
  const session = () => props.session
  const blocked = () => props.permissions.length > 0 || props.questions.length > 0
  let transcriptExpandedSessionID = ""
  let composerTextarea: HTMLTextAreaElement | undefined
  let startTranscriptPromptFollow: (() => void) | undefined
  const [modelPickerOpen, setModelPickerOpen] = createSignal(false)
  const [variantPickerOpen, setVariantPickerOpen] = createSignal(false)
  const [modelQuery, setModelQuery] = createSignal("")
  const [draftPrompt, setDraftPrompt] = createSignal(props.prompt)
  const [slashMenuOpen, setSlashMenuOpen] = createSignal(false)
  const [selectedSlashCommand, setSelectedSlashCommand] = createSignal(0)
  const modelOptions = createMemo(() =>
    props.providers.flatMap((provider) =>
      Object.values(provider.models)
        .filter((model) => model.status !== "deprecated")
        .map((model) => ({ provider, model })),
    ),
  )
  const recentModelOptions = createMemo(() =>
    props.recentModels.flatMap((value) => {
      const option = modelOptions().find((item) => modelValue(item.provider.id, item.model.id) === value)
      return option ? [option] : []
    }),
  )
  const providerModelOptions = createMemo(() => {
    const recents = new Set(recentModelOptions().map((item) => modelValue(item.provider.id, item.model.id)))
    return props.providers
      .toSorted((a, b) => Number(a.id !== "opencode") - Number(b.id !== "opencode") || a.name.localeCompare(b.name))
      .map((provider) => ({
        provider,
        models: Object.values(provider.models)
          .filter((model) => model.status !== "deprecated")
          .filter((model) => !recents.has(modelValue(provider.id, model.id)))
          .toSorted((a, b) => Number(!isFreeOpencodeModel(provider, a)) - Number(!isFreeOpencodeModel(provider, b)) || (a.name ?? a.id).localeCompare(b.name ?? b.id)),
      }))
      .filter((item) => item.models.length > 0)
  })
  const filteredRecentModelOptions = createMemo(() => filterModelOptions(recentModelOptions(), modelQuery()))
  const filteredProviderModelOptions = createMemo(() =>
    providerModelOptions()
      .map((group) => ({ ...group, models: filterModelOptions(group.models.map((model) => ({ provider: group.provider, model })), modelQuery()).map((item) => item.model) }))
      .filter((group) => group.models.length > 0),
  )
  const activeProvider = createMemo(() => {
    const selection = parseModelValue(props.selectedModel)
    if (!selection) return
    return props.providers.find((provider) => provider.id === selection.providerID)
  })
  const activeModel = createMemo(() => {
    const selection = parseModelValue(props.selectedModel)
    if (!selection) return
    return props.providers.find((provider) => provider.id === selection.providerID)?.models[selection.modelID]
  })
  const variants = createMemo(() => Object.keys(activeModel()?.variants ?? {}))
  const mode = createMemo(() => props.selectedAgent === "plan" ? "plan" : "build")
  const running = createMemo(() => props.status === "busy" || props.status === "retry")
  const sessionStarted = createMemo(() => props.loading || props.data.messages.length > 0 || props.status === "busy" || props.status === "retry" || blocked())
  const draftText = createMemo(() => draftPrompt().trim())
  const slashQuery = createMemo(() => {
    const draft = draftPrompt()
    if (!draft.startsWith("/") || draft.includes(" ") || draft.includes("\n")) return
    return draft.slice(1).toLowerCase()
  })
  const visibleSlashCommands = createMemo(() => {
    const query = slashQuery()
    if (query === undefined) return []
    return props.slashCommands.filter((command) =>
      [command.name, command.title, command.detail, command.disabled, ...(command.aliases ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    )
  })
  const slashMenuVisible = createMemo(() => slashMenuOpen() && !blocked() && slashQuery() !== undefined)
  const usageLabel = createMemo(() => {
    const last = props.data.messages.findLast((bundle) => isAssistantMessage(bundle.info) && bundle.info.tokens.output > 0)?.info
    if (!last || !isAssistantMessage(last)) return
    const tokens = last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return
    const limit = props.providers.find((provider) => provider.id === last.providerID)?.models[last.modelID]?.limit.context
    const pct = limit ? ` (${Math.round((tokens / limit) * 100)}%)` : ""
    return `${formatTokenCount(tokens)}${pct}`
  })
  const modelLabel = () => props.selectedModel && activeProvider() && activeModel() ? `${activeModel()!.name ?? activeModel()!.id} ${activeProvider()!.name}` : "Select model"
  const variantLabel = () => props.selectedVariant || "Default"
  const toggleMode = () => props.setSelectedAgent(mode() === "plan" ? "build" : "plan")
  const selectVariant = (variant: string) => {
    props.setSelectedVariant(variant)
    setVariantPickerOpen(false)
  }
  const cycleVariant = () => {
    const list = variants()
    if (list.length === 0) return
    const options = ["", ...list]
    const index = options.indexOf(props.selectedVariant)
    props.setSelectedVariant(options[index >= 0 ? (index + 1) % options.length : 1])
    setVariantPickerOpen(false)
  }
  const selectModel = (providerID: string, modelID: string) => {
    props.setSelectedModel(modelValue(providerID, modelID))
    setModelPickerOpen(false)
    setVariantPickerOpen(false)
    setModelQuery("")
  }
  const resizeComposer = () => {
    if (!composerTextarea) return
    composerTextarea.style.height = "auto"
    composerTextarea.style.height = `${composerTextarea.scrollHeight}px`
  }
  const submitComposer = (event: SubmitEvent) => {
    event.preventDefault()
    const text = draftText()
    if (blocked() || !text) return
    startTranscriptPromptFollow?.()
    setDraftPrompt("")
    requestAnimationFrame(resizeComposer)
    props.submit(event, text)
  }
  const runSlashCommand = (command: SessionSlashCommand | undefined) => {
    if (!command || command.disabled) return
    const currentDraft = draftPrompt()
    setDraftPrompt("")
    setSlashMenuOpen(false)
    requestAnimationFrame(resizeComposer)
    void command.run({ draftPrompt: currentDraft, setDraftPrompt, openModelPicker: () => setModelPickerOpen(true) })
  }
  const completeSlashCommand = (command: SessionSlashCommand | undefined) => {
    if (!command) return
    setDraftPrompt(`/${command.name}`)
    setSlashMenuOpen(true)
    requestAnimationFrame(resizeComposer)
  }
  const selectSlashCommand = (offset: number) => {
    const count = visibleSlashCommands().length
    if (count === 0) return
    setSelectedSlashCommand((current) => (current + offset + count) % count)
  }
  createEffect(() => {
    draftPrompt()
    resizeComposer()
  })
  createEffect(() => {
    const count = visibleSlashCommands().length
    if (selectedSlashCommand() >= count) setSelectedSlashCommand(Math.max(0, count - 1))
  })
  createEffect(() => {
    const token = props.composerFocusToken?.() ?? 0
    if (!token) return
    requestAnimationFrame(() => {
      if (props.composerFocusToken?.() !== token || !composerTextarea || composerTextarea.disabled) return
      composerTextarea.focus({ preventScroll: true })
    })
  })
  createEffect(() => {
    const id = props.session?.id ?? ""
    if (id === transcriptExpandedSessionID) return
    transcriptExpandedSessionID = id
    setDraftPrompt(props.prompt)
    setSlashMenuOpen(false)
  })
  return (
    <div class="page session-page" data-session-id={session()?.id} classList={{ "session-empty": !sessionStarted() }}>
      <Show when={session()} fallback={<Empty text="Session not found" />}>
        {(selected) => (
          <>
            <div class="session-page-top">
              <header class="session-toolbar">
                <div class="session-titleline">
                  <div>
                    <h1>{title(selected().title)}</h1>
                    <p>{compactPath(selected().directory)}</p>
                  </div>
                </div>
                <div class="session-actions compact">
                  <Show when={props.status === "busy" || props.status === "retry" || blocked()}>
                    <button class="icon-button" title="Interrupt session" aria-label="Interrupt session" onClick={() => props.abortSession(selected().id)}><Icon name="stop" /></button>
                  </Show>
                  <StatusPill status={blocked() ? "input_needed" : props.status ?? "idle"} />
                  <Show when={!props.pending}>
                    <details class="overflow-menu">
                      <summary title="Session actions" aria-label="Session actions"><Icon name="more" /></summary>
                      <div>
                        <button type="button" onClick={() => props.renameSession(selected())}>Rename</button>
                        <button type="button" onClick={() => props.moveSession(selected())}>Move to project</button>
                        <button type="button" class="danger" onClick={() => props.deleteSession(selected())}>Delete</button>
                      </div>
                    </details>
                  </Show>
                </div>
              </header>
              <For each={props.permissions}>
                {(request) => <PermissionPanel request={request} tool={permissionToolPart(request, props.data.messages)} reply={props.replyPermission} />}
              </For>
              <For each={props.questions}>
                {(request) => <QuestionPanel request={request} reply={props.replyQuestion} reject={props.rejectQuestion} />}
              </For>
            </div>
            <TranscriptPanel
              sessionID={selected().id}
              data={props.data}
              loading={props.loading}
              providers={props.providers}
              showTimestamps={props.showTimestamps}
              showThinking={props.showThinking}
              setPromptFollowStarter={(start) => { startTranscriptPromptFollow = start }}
              loadOlderMessages={props.loadOlderMessages}
            />
            <form class="composer" onSubmit={submitComposer}>
              <div class={`composer-input ${mode()}`}>
                <Show when={slashMenuVisible()}>
                  <div class="slash-command-menu" role="listbox" aria-label="Session slash commands" onMouseDown={(event) => event.preventDefault()}>
                    <For each={visibleSlashCommands()} fallback={<p>No matching commands.</p>}>
                      {(command, index) => (
                        <button
                          type="button"
                          role="option"
                          aria-selected={selectedSlashCommand() === index()}
                          disabled={!!command.disabled}
                          classList={{ selected: selectedSlashCommand() === index() }}
                          title={command.disabled}
                          onMouseEnter={() => setSelectedSlashCommand(index())}
                          onClick={() => runSlashCommand(command)}
                        >
                          <strong>/{command.name}</strong>
                          <span>{command.title} - {command.disabled ?? command.detail}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
                <textarea
                  ref={composerTextarea}
                  disabled={blocked()}
                  value={draftPrompt()}
                  onFocus={() => setSlashMenuOpen(true)}
                  onBlur={() => setSlashMenuOpen(false)}
                  onInput={(event) => {
                    setDraftPrompt(event.currentTarget.value)
                    setSlashMenuOpen(true)
                    setSelectedSlashCommand(0)
                  }}
                  onKeyDown={(event) => {
                    if (slashMenuVisible()) {
                      if (event.key === "Escape") {
                        event.preventDefault()
                        setSlashMenuOpen(false)
                        return
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault()
                        selectSlashCommand(-1)
                        return
                      }
                      if (event.key === "ArrowDown") {
                        event.preventDefault()
                        selectSlashCommand(1)
                        return
                      }
                      if (event.key === "Enter") {
                        event.preventDefault()
                        runSlashCommand(visibleSlashCommands()[selectedSlashCommand()])
                        return
                      }
                      if (event.key === "Tab") {
                        event.preventDefault()
                        completeSlashCommand(visibleSlashCommands()[selectedSlashCommand()])
                        return
                      }
                    }
                    if (event.ctrlKey && event.key.toLowerCase() === "t") {
                      event.preventDefault()
                      if (!blocked()) cycleVariant()
                      return
                    }
                    if (event.key === "Tab") {
                      event.preventDefault()
                      if (!blocked()) toggleMode()
                      return
                    }
                    if (event.key !== "Enter" || event.shiftKey) return
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }}
                  placeholder={blocked() ? "Reply to the pending permission/question before continuing..." : "Message OpencodeX..."}
                />
                <div class="composer-footer">
                  <div class="composer-meta" aria-live="polite">
                    <button class={`mode-chip ${mode()}`} type="button" disabled={blocked()} onClick={toggleMode} title="Toggle Build/Plan mode">
                      {mode() === "plan" ? "Plan" : "Build"}
                    </button>
                    <button class="model-menu" type="button" disabled={blocked()} onClick={() => setModelPickerOpen(true)} title="Choose model">{modelLabel()}</button>
                    <Show when={variants().length > 0}>
                      <div
                        class="variant-menu-wrap"
                        onFocusOut={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setVariantPickerOpen(false)
                        }}
                      >
                        <button
                          class="variant-trigger"
                          type="button"
                          disabled={blocked()}
                          aria-haspopup="listbox"
                          aria-expanded={variantPickerOpen()}
                          title="Change variant (Ctrl+T to cycle)"
                          onClick={() => setVariantPickerOpen((open) => !open)}
                        >
                          {variantLabel()}
                        </button>
                        <Show when={variantPickerOpen()}>
                          <div class="variant-menu" role="listbox" aria-label="Choose variant">
                            <button type="button" role="option" aria-selected={props.selectedVariant === ""} classList={{ selected: props.selectedVariant === "" }} onClick={() => selectVariant("")}>Default</button>
                            <For each={variants()}>
                              {(variant) => (
                                <button type="button" role="option" aria-selected={props.selectedVariant === variant} classList={{ selected: props.selectedVariant === variant }} onClick={() => selectVariant(variant)}>
                                  {variant}
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>
                  <button class="send-button" type="submit" title="Send message" aria-label="Send message" disabled={blocked() || draftText().length === 0}>
                    <Icon name="send" />
                  </button>
                </div>
              </div>
              <div class="composer-running" aria-live="polite">
                <span class="composer-running-left">
                  <Show when={running()} fallback={<span class="composer-running-placeholder" aria-hidden="true" />}>
                    <span class="composer-spinner" aria-label="running" />
                    <span class="composer-interrupt" aria-label="Press escape to interrupt the model">
                      <span class="composer-interrupt-key">esc</span>{" "}
                      <span class="composer-interrupt-action">interrupt</span>
                    </span>
                  </Show>
                </span>
                <span class="composer-running-right">
                  <Show when={usageLabel()}>
                    {(usage) => <span class="composer-token-usage">{usage()}</span>}
                  </Show>
                  <span class="composer-command-hint"><span>ctrl+p</span> commands</span>
                </span>
              </div>
            </form>
            <Show when={modelPickerOpen()}>
              <div
                class="dialog-backdrop"
                onMouseDown={() => setModelPickerOpen(false)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return
                  event.preventDefault()
                  event.stopPropagation()
                  setModelPickerOpen(false)
                }}
              >
                <section class="model-picker-modal" onMouseDown={(event) => event.stopPropagation()}>
                  <header>
                    <div>
                      <h2>Select model</h2>
                      <p>Recent routes are listed first, matching the TUI picker.</p>
                    </div>
                    <button type="button" aria-label="Close model picker" onClick={() => setModelPickerOpen(false)}>{"\u00d7"}</button>
                  </header>
                  <input value={modelQuery()} onInput={(event) => setModelQuery(event.currentTarget.value)} placeholder="Search models or providers" autofocus />
                  <div class="model-picker-list">
                    <Show when={filteredRecentModelOptions().length > 0}>
                      <ModelPickerSection title="Recently used" selectedModel={props.selectedModel} options={filteredRecentModelOptions()} select={selectModel} />
                    </Show>
                    <For each={filteredProviderModelOptions()}>
                      {(group) => (
                        <ModelPickerSection
                          title={group.provider.name}
                          selectedModel={props.selectedModel}
                          options={group.models.map((model) => ({ provider: group.provider, model }))}
                          select={selectModel}
                        />
                      )}
                    </For>
                    <Show when={filteredRecentModelOptions().length === 0 && filteredProviderModelOptions().length === 0}>
                      <p class="model-picker-empty">No matching models.</p>
                    </Show>
                  </div>
                </section>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

function TranscriptPanel(props: {
  sessionID: string
  data: SessionData
  loading: boolean
  providers: Provider[]
  showTimestamps: boolean
  showThinking: boolean
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
    setOlderMessagesLoading(true)
    await props.loadOlderMessages(cursor).finally(() => setOlderMessagesLoading(false))
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
    <section class="transcript" ref={transcript} onScroll={handleScroll} onWheel={handleWheel}>
      <div class="transcript-content" ref={transcriptContent}>
        <Show when={!props.loading} fallback={<TranscriptLoadingState />}>
          <Show when={props.data.messageCursor}>
            <Show when={olderMessagesLoading()} fallback={
              <button type="button" class="transcript-window-button" onClick={() => void loadOlderMessages()}>
                Load more
              </button>
            }>
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
                  {(item) => <DisplayPartView item={item} showThinking={props.showThinking} />}
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
  const cancelForUser = () => stop()
  const stop = () => {
    if (stopped) return
    stopped = true
    clearFrame()
    clearIdleTimer()
    clearMaxTimer()
    observer?.disconnect()
    transcript.removeEventListener("wheel", cancelForUser)
    transcript.removeEventListener("touchstart", cancelForUser)
    transcript.removeEventListener("pointerdown", cancelForUser)
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
  transcript.addEventListener("wheel", cancelForUser, { passive: true })
  transcript.addEventListener("touchstart", cancelForUser, { passive: true })
  transcript.addEventListener("pointerdown", cancelForUser, { passive: true })
  maxTimer = setTimeout(finish, OPEN_SCROLL_SETTLE_MAX_MS)
  scheduleScroll()
  scheduleIdleFinish()
  return stop
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

function ModelPickerSection(props: { title: string; selectedModel: string; options: ModelPickerOption[]; select: (providerID: string, modelID: string) => void }) {
  return (
    <section class="model-picker-section">
      <h3>{props.title}</h3>
      <div>
        <For each={props.options}>
          {(option) => {
            const value = modelValue(option.provider.id, option.model.id)
            return (
              <button type="button" classList={{ selected: props.selectedModel === value }} onClick={() => props.select(option.provider.id, option.model.id)}>
                <span>{option.model.name ?? option.model.id}</span>
                <small>{option.provider.name}</small>
                <Show when={isFreeOpencodeModel(option.provider, option.model)}><em>Free</em></Show>
              </button>
            )
          }}
        </For>
      </div>
    </section>
  )
}

function filterModelOptions(options: ModelPickerOption[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return options
  return options.filter((option) => `${option.model.name ?? option.model.id} ${option.provider.name}`.toLowerCase().includes(needle))
}

function isAssistantMessage(message: MessageBundle["info"]): message is AssistantMessage {
  return message.role === "assistant"
}

function formatTokenCount(tokens: number) {
  if (tokens >= 1_000_000) return `${trimCompactNumber(tokens / 1_000_000)}m`
  if (tokens >= 1_000) return `${trimCompactNumber(tokens / 1_000)}k`
  return tokens.toLocaleString()
}

function trimCompactNumber(value: number) {
  return value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, "")
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

function Empty(props: { text: string }) {
  return <div class="empty">{props.text}</div>
}

import type { Agent, AssistantMessage, PermissionRequest, Provider, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { compactPath, title } from "../lib/format"
import type { MessageWindow } from "../lib/message-window"
import { isFreeOpencodeModel, modelValue, parseModelValue, type ModelPickerOption } from "../lib/model-selection"
import type { MessageBundle, SessionData } from "../lib/store"
import { permissionToolPart } from "../lib/tool-display"
import { Icon } from "./icon"
import { OpencodeXLogo } from "./chrome"
import { DisplayPartView, PermissionPanel, QuestionPanel, groupTranscriptParts } from "./session-transcript"
import { StatusPill } from "./status-pill"

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
  status?: string
  pending?: boolean
  composerFocusToken?: () => number
  messageWindow: MessageWindow
  loadOlderMessages?: (cursor: string) => Promise<void>
  reloadLatestMessages?: () => Promise<void>
  onFollowBottomChange?: (sessionID: string, value: boolean) => void
}) {
  const session = () => props.session
  const blocked = () => props.permissions.length > 0 || props.questions.length > 0
  let transcriptExpandedSessionID = ""
  let composerTextarea: HTMLTextAreaElement | undefined
  const [modelPickerOpen, setModelPickerOpen] = createSignal(false)
  const [variantPickerOpen, setVariantPickerOpen] = createSignal(false)
  const [modelQuery, setModelQuery] = createSignal("")
  const [draftPrompt, setDraftPrompt] = createSignal(props.prompt)
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
    setDraftPrompt("")
    requestAnimationFrame(resizeComposer)
    props.submit(event, text)
  }
  createEffect(() => {
    draftPrompt()
    resizeComposer()
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
  })
  return (
    <div class="page session-page" classList={{ "session-empty": !sessionStarted() }}>
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
              running={running()}
              providers={props.providers}
              messageWindow={props.messageWindow}
              loadOlderMessages={props.loadOlderMessages}
              reloadLatestMessages={props.reloadLatestMessages}
              onFollowBottomChange={props.onFollowBottomChange}
            />
            <form class="composer" onSubmit={submitComposer}>
              <div class={`composer-input ${mode()}`}>
                <textarea
                  ref={composerTextarea}
                  disabled={blocked()}
                  value={draftPrompt()}
                  onInput={(event) => {
                    setDraftPrompt(event.currentTarget.value)
                  }}
                  onKeyDown={(event) => {
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
  running: boolean
  providers: Provider[]
  messageWindow: MessageWindow
  loadOlderMessages?: (cursor: string) => Promise<void>
  reloadLatestMessages?: () => Promise<void>
  onFollowBottomChange?: (sessionID: string, value: boolean) => void
}) {
  const TRANSCRIPT_BOTTOM_THRESHOLD = 8
  let transcript: HTMLElement | undefined
  let followFrame: number | undefined
  let bottomFrame: number | undefined
  let activeSessionID = ""
  let observedRenderKey = ""
  let followingBottom = true
  let topFrame: number | undefined
  let bottomStableFrames = 0
  let bottomStableTarget = 0
  let bottomFrameBudget = 0
  let bottomLastHeight = -1
  const [olderMessagesLoading, setOlderMessagesLoading] = createSignal(false)
  const [latestMessagesLoading, setLatestMessagesLoading] = createSignal(false)
  const visibleMessages = createMemo(() => props.data.messages)
  const visiblePartCount = createMemo(() => visibleMessages().reduce((total, message) => total + message.parts.length, 0))
  const renderKey = createMemo(() => [
    props.sessionID,
    props.loading ? "loading" : "ready",
    visibleMessages()[0]?.info.id ?? "",
    visibleMessages().at(-1)?.info.id ?? "",
    visiblePartCount(),
    props.data.messageTailDetached ? "detached" : "latest",
  ].join("\0"))
  const nearBottom = () => transcript ? transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <= TRANSCRIPT_BOTTOM_THRESHOLD : true
  const setFollowingBottom = (value: boolean) => {
    followingBottom = value && props.data.messageTailDetached !== true
    props.onFollowBottomChange?.(props.sessionID, followingBottom)
  }
  const forceFollowingBottom = () => {
    followingBottom = true
    props.onFollowBottomChange?.(props.sessionID, true)
  }
  const cancelBottomScroll = () => {
    if (bottomFrame === undefined) return
    cancelAnimationFrame(bottomFrame)
    bottomFrame = undefined
    bottomStableFrames = 0
    bottomFrameBudget = 0
  }
  const cancelTopScroll = () => {
    if (topFrame === undefined) return
    cancelAnimationFrame(topFrame)
    topFrame = undefined
  }
  const updateFollowingFromScroll = () => {
    setFollowingBottom(nearBottom())
  }
  const scheduleFollowingUpdate = () => {
    if (followFrame !== undefined) return
    followFrame = requestAnimationFrame(() => {
      followFrame = undefined
      updateFollowingFromScroll()
    })
  }
  const scrollToBottom = () => {
    if (!transcript) return
    transcript.scrollTop = transcript.scrollHeight
    setFollowingBottom(nearBottom())
  }
  const continueBottomScroll = (key: string) => {
    bottomFrame = requestAnimationFrame(() => {
      bottomFrame = undefined
      if (renderKey() !== key || !followingBottom || props.data.messageTailDetached) return
      const height = transcript?.scrollHeight ?? 0
      scrollToBottom()
      bottomStableFrames = height === bottomLastHeight ? bottomStableFrames + 1 : 0
      bottomLastHeight = height
      bottomFrameBudget -= 1
      if (bottomFrameBudget > 0 && bottomStableFrames < bottomStableTarget) continueBottomScroll(key)
    })
  }
  const scheduleBottomScroll = (key: string, stableFrames: number, frameBudget: number) => {
    cancelBottomScroll()
    bottomStableFrames = 0
    bottomStableTarget = stableFrames
    bottomFrameBudget = frameBudget
    bottomLastHeight = -1
    continueBottomScroll(key)
  }
  const handleUserScrollIntent = () => {
    cancelBottomScroll()
    scheduleFollowingUpdate()
  }
  const loadOlderMessages = async () => {
    const cursor = props.data.messageCursor
    if (!cursor || !props.loadOlderMessages || olderMessagesLoading()) return
    const restoreTop = transcript?.scrollTop ?? 0
    const restoreHeight = transcript?.scrollHeight ?? 0
    cancelBottomScroll()
    setFollowingBottom(false)
    setOlderMessagesLoading(true)
    await props.loadOlderMessages(cursor).finally(() => {
      setOlderMessagesLoading(false)
      cancelTopScroll()
      topFrame = requestAnimationFrame(() => {
        topFrame = undefined
        if (transcript) transcript.scrollTop = restoreTop + Math.max(0, transcript.scrollHeight - restoreHeight)
        updateFollowingFromScroll()
      })
    })
  }
  const reloadLatestMessages = async () => {
    if (!props.reloadLatestMessages || latestMessagesLoading()) return
    cancelBottomScroll()
    forceFollowingBottom()
    setLatestMessagesLoading(true)
    await props.reloadLatestMessages().finally(() => {
      setLatestMessagesLoading(false)
      scheduleBottomScroll(renderKey(), 10, 90)
    })
  }
  const handleScroll = () => {
    if (!nearBottom()) {
      cancelBottomScroll()
      if (followingBottom) setFollowingBottom(false)
    }
    scheduleFollowingUpdate()
  }

  onCleanup(() => {
    cancelBottomScroll()
    cancelTopScroll()
    if (followFrame !== undefined) cancelAnimationFrame(followFrame)
  })
  createEffect(() => {
    const key = renderKey()
    const sessionChanged = activeSessionID !== props.sessionID
    activeSessionID = props.sessionID
    if (sessionChanged) {
      observedRenderKey = ""
      setFollowingBottom(props.data.messageTailDetached !== true)
    }
    if (props.data.messageTailDetached) {
      observedRenderKey = key
      setFollowingBottom(false)
      return
    }
    if (props.loading || visibleMessages().length === 0) return
    if (!observedRenderKey) {
      observedRenderKey = key
      setFollowingBottom(true)
      scheduleBottomScroll(key, 10, 90)
      return
    }
    if (observedRenderKey === key) return
    observedRenderKey = key
    if (followingBottom) scheduleBottomScroll(key, props.running ? 2 : 1, props.running ? 12 : 4)
  })

  return (
    <section class="transcript" ref={transcript} onScroll={handleScroll} onWheel={handleUserScrollIntent} onPointerDown={handleUserScrollIntent} onTouchStart={handleUserScrollIntent}>
      <div class="transcript-content">
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
              <article class={`message ${bundle.info.role}`}>
                <Show when={showTranscriptHeader(visibleMessages(), index())}>
                  <header>{transcriptHeaderLabel(bundle.info, props.providers)}</header>
                </Show>
                <For each={groupTranscriptParts(bundle.parts)}>
                  {(item) => <DisplayPartView item={item} />}
                </For>
              </article>
            )}
          </For>
          <Show when={props.data.messageTailDetached}>
            <button type="button" class="transcript-window-button transcript-latest-button" disabled={latestMessagesLoading()} onClick={() => void reloadLatestMessages()}>
              {latestMessagesLoading() ? "Loading latest messages..." : "Jump to latest messages"}
            </button>
          </Show>
        </Show>
      </div>
    </section>
  )
}

function showTranscriptHeader(messages: MessageBundle[], index: number) {
  const message = messages[index]
  if (!message) return false
  if (message.info.role === "user") return true
  return messages[index - 1]?.info.role === "user"
}

function transcriptHeaderLabel(message: MessageBundle["info"], providers: Provider[]) {
  if (message.role === "user") return "User"
  return assistantModelLabel(message, providers)
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

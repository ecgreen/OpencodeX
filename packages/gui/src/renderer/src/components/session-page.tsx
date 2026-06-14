import type { Agent, AssistantMessage, Config, FileNode, LspStatus, McpStatus, McpResource, PermissionRequest, Provider, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { compactPath, title } from "../lib/format"
import { isFreeOpencodeModel, modelValue, parseModelValue, type ModelPickerOption } from "../lib/model-selection"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { MessageBundle, PromptPart, SessionData } from "../lib/store"
import { EMPTY_VIEW_PANE_RUNTIME_STATE, type ViewPaneRuntimeState } from "../lib/view-pane-state"
import {
  mergePromptDraft,
  nextPromptHistoryState,
  parsePromptDrafts,
  parsePromptStash,
  pushPromptStash,
  type GuiPromptInfo,
  type GuiPromptStashEntry,
} from "../lib/prompt-state"
import { buildPromptMentionOptions, prunePromptPartsForInput, referenceSearch, type PromptMentionOption } from "../lib/prompt-autocomplete"
import { permissionToolPart } from "../lib/tool-display"
import { Icon } from "./icon"
import { OpencodeXLogo } from "./chrome"
import { DisplayPartView, PermissionPanel, QuestionPanel, groupTranscriptParts } from "./session-transcript"
import { SessionInspector } from "./session-inspector"
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
  mcp: Record<string, McpStatus>
  mcpResources?: Record<string, McpResource>
  lsp: LspStatus[]
  config?: Config
  agents: Agent[]
  findFiles?: (input: { query: string; directory?: string }) => Promise<FileNode[]>
  selectedAgent: string
  setSelectedAgent: (value: string) => void
  selectedModel: string
  recentModels: string[]
  setSelectedModel: (value: string) => void
  selectedVariant: string
  setSelectedVariant: (value: string) => void
  submit: (event: SubmitEvent, prompt: GuiPromptInfo) => void
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
  concealCodeBlocks: boolean
  showTimestamps: boolean
  showThinking: boolean
  showToolDetails: boolean
  showScrollbar: boolean
  showGenericToolOutput: boolean
  toggleCodeConceal: () => void
  toggleTimestamps: () => void
  toggleThinking: () => void
  toggleToolDetails: () => void
  toggleScrollbar: () => void
  toggleGenericToolOutput: () => void
  status?: string
  pending?: boolean
  composerState?: ViewPaneRuntimeState
  updateComposerState?: (update: (state: ViewPaneRuntimeState) => ViewPaneRuntimeState) => void
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
  const [favoriteModels, setFavoriteModels] = createSignal(readFavoriteModels())
  const [localDraftPrompt, setLocalDraftPrompt] = createSignal(props.prompt)
  const [localDraftParts, setLocalDraftParts] = createSignal<PromptPart[]>([])
  const [stash, setStash] = createSignal<GuiPromptStashEntry[]>(readComposerStash())
  const [localHistoryIndex, setLocalHistoryIndex] = createSignal(-1)
  const [localHistoryDraft, setLocalHistoryDraft] = createSignal("")
  const [slashMenuOpen, setSlashMenuOpen] = createSignal(false)
  const [selectedSlashCommand, setSelectedSlashCommand] = createSignal(0)
  const composerState = () => props.composerState ?? EMPTY_VIEW_PANE_RUNTIME_STATE
  const draftPrompt = () => props.composerState ? composerState().draft.input : localDraftPrompt()
  const draftParts = () => props.composerState ? composerState().draft.parts : localDraftParts()
  const historyIndex = () => props.composerState ? composerState().historyIndex : localHistoryIndex()
  const historyDraft = () => props.composerState ? composerState().historyDraft : localHistoryDraft()
  const setDraftPrompt = (value: string | ((current: string) => string)) => {
    if (!props.updateComposerState) return setLocalDraftPrompt(value)
    props.updateComposerState((state) => {
      const next = typeof value === "function" ? value(state.draft.input) : value
      return { ...state, draft: { ...state.draft, input: next } }
    })
  }
  const setDraftParts = (value: PromptPart[] | ((current: PromptPart[]) => PromptPart[])) => {
    if (!props.updateComposerState) return setLocalDraftParts(value)
    props.updateComposerState((state) => {
      const next = typeof value === "function" ? value(state.draft.parts) : value
      return { ...state, draft: { ...state.draft, parts: next } }
    })
  }
  const setHistoryIndex = (value: number | ((current: number) => number)) => {
    if (!props.updateComposerState) return setLocalHistoryIndex(value)
    props.updateComposerState((state) => ({
      ...state,
      historyIndex: typeof value === "function" ? value(state.historyIndex) : value,
    }))
  }
  const setHistoryDraft = (value: string | ((current: string) => string)) => {
    if (!props.updateComposerState) return setLocalHistoryDraft(value)
    props.updateComposerState((state) => ({
      ...state,
      historyDraft: typeof value === "function" ? value(state.historyDraft) : value,
    }))
  }
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
  const favoriteModelOptions = createMemo(() =>
    favoriteModels().flatMap((value) => {
      const option = modelOptions().find((item) => modelValue(item.provider.id, item.model.id) === value)
      return option ? [option] : []
    }),
  )
  const providerModelOptions = createMemo(() => {
    const recents = new Set([...recentModelOptions(), ...favoriteModelOptions()].map((item) => modelValue(item.provider.id, item.model.id)))
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
  const filteredFavoriteModelOptions = createMemo(() => filterModelOptions(favoriteModelOptions(), modelQuery()))
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
  const mentionQuery = createMemo(() => {
    const draft = draftPrompt()
    const match = /(?:^|\s)@([^\s@]*)$/.exec(draft)
    return match?.[1]
  })
  const mentionReferenceQuery = createMemo(() => {
    const query = mentionQuery()
    if (query === undefined) return
    return referenceSearch({ query, config: props.config })
  })
  const mentionFileQuery = createMemo(() => {
    const query = mentionQuery()
    if (query === undefined || referenceSearch({ query, config: props.config })) return
    return query
  })
  const [mentionFiles] = createResource(mentionFileQuery, async (query) => props.findFiles ? props.findFiles({ query }) : [])
  const [mentionReferenceFiles] = createResource(mentionReferenceQuery, async (match) => {
    if (!props.findFiles) return []
    return (await props.findFiles({ query: match.query, directory: match.root })).map((file) => ({ alias: match.alias, root: match.root, file }))
  })
  const mentionOptions = createMemo(() => {
    const query = mentionQuery()
    if (query === undefined) return []
    return buildPromptMentionOptions({
      query,
      agents: props.agents,
      config: props.config,
      files: mentionFiles() ?? [],
      referenceFiles: mentionReferenceFiles() ?? [],
      mcpResources: props.mcpResources,
      limit: 10,
    })
  })
  const mentionMenuVisible = createMemo(() => mentionOptions().length > 0 && !blocked())
  const userHistory = createMemo(() =>
    props.data.messages
      .filter((bundle) => bundle.info.role === "user")
      .map((bundle) => bundle.parts.map(textPart).join("").trim())
      .filter(Boolean),
  )
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
  const toggleFavoriteModel = (value: string) => {
    setFavoriteModels((current) => {
      const next = current.includes(value) ? current.filter((item) => item !== value) : [value, ...current].slice(0, 20)
      writeFavoriteModels(next)
      return next
    })
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
    const parts = draftParts()
    const shellText = text.startsWith("!") ? text.slice(1).trimStart() : undefined
    const promptText = shellText ?? text
    startTranscriptPromptFollow?.()
    setDraftPrompt("")
    setDraftParts([])
    setHistoryIndex(-1)
    setHistoryDraft("")
    requestAnimationFrame(resizeComposer)
    clearComposerDraft(session()?.id)
    props.submit(event, {
      input: promptText,
      parts: shellText !== undefined ? [] : parts.length ? [{ type: "text", text }, ...parts] : [{ type: "text", text }],
      ...(shellText !== undefined ? { mode: "shell" } : {}),
    })
  }
  const runSlashCommand = (command: SessionSlashCommand | undefined) => {
    if (!command || command.disabled) return
    const currentDraft = draftPrompt()
    const currentParts = draftParts()
    setDraftPrompt("")
    setSlashMenuOpen(false)
    requestAnimationFrame(resizeComposer)
    void command.run({ draftPrompt: currentDraft, draftParts: currentParts, setDraftPrompt, setDraftParts, openModelPicker: () => setModelPickerOpen(true) })
  }
  const completeSlashCommand = (command: SessionSlashCommand | undefined) => {
    if (!command) return
    setDraftPrompt(`/${command.name}`)
    setSlashMenuOpen(true)
    requestAnimationFrame(resizeComposer)
  }
  const chooseMention = (option: PromptMentionOption) => {
    const nextPrompt = draftPrompt().replace(/(^|\s)@[^\s@]*$/, `$1${option.replacement}`)
    setDraftPrompt(nextPrompt)
    setDraftParts((current) => [...prunePromptPartsForInput(nextPrompt, current), option.part])
    requestAnimationFrame(resizeComposer)
  }
  const stashPrompt = () => {
    const prompt = { input: draftPrompt(), parts: draftParts() }
    const next = pushPromptStash(stash(), prompt)
    setStash(next)
    writeComposerStash(next)
    setDraftPrompt("")
    setDraftParts([])
  }
  const popStash = () => {
    const entries = stash()
    const entry = entries.at(-1)
    if (!entry) return
    const next = entries.slice(0, -1)
    setStash(next)
    writeComposerStash(next)
    setDraftPrompt(entry.input)
    setDraftParts(entry.parts)
    requestAnimationFrame(resizeComposer)
  }
  const loadHistory = (offset: number) => {
    const next = nextPromptHistoryState({
      history: userHistory(),
      offset,
      historyIndex: historyIndex(),
      historyDraft: historyDraft(),
      draftPrompt: draftPrompt(),
    })
    if (!next) return false
    setHistoryIndex(next.historyIndex)
    setHistoryDraft(next.historyDraft)
    setDraftPrompt(next.draftPrompt)
    setDraftParts([])
    requestAnimationFrame(resizeComposer)
    return true
  }
  const pasteFiles = async (files: File[]) => {
    const parts = await Promise.all(files.map(filePartFromFile))
    setDraftParts((current) => [...current, ...parts])
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
    if (!props.composerState) {
      const saved = readComposerDraft(id)
      setDraftPrompt(saved?.input ?? props.prompt)
      setDraftParts(saved?.parts ?? [])
    }
    setHistoryIndex(-1)
    setHistoryDraft("")
    setSlashMenuOpen(false)
  })
  createEffect(() => {
    if (props.composerState) return
    const id = props.session?.id
    if (!id) return
    const value = { input: draftPrompt(), parts: draftParts() }
    if (!value.input && value.parts.length === 0) clearComposerDraft(id)
    else writeComposerDraft(id, value)
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
                        <hr />
                        <button type="button" onClick={props.toggleCodeConceal}><Icon name={props.concealCodeBlocks ? "check" : "circle"} /> Code blocks</button>
                        <button type="button" onClick={props.toggleTimestamps}><Icon name={props.showTimestamps ? "check" : "circle"} /> Timestamps</button>
                        <button type="button" onClick={props.toggleThinking}><Icon name={props.showThinking ? "check" : "circle"} /> Thinking</button>
                        <button type="button" onClick={props.toggleToolDetails}><Icon name={props.showToolDetails ? "check" : "circle"} /> Tool details</button>
                        <button type="button" onClick={props.toggleScrollbar}><Icon name={props.showScrollbar ? "check" : "circle"} /> Scrollbar</button>
                        <button type="button" onClick={props.toggleGenericToolOutput}><Icon name={props.showGenericToolOutput ? "check" : "circle"} /> Generic tool output</button>
                        <hr />
                        <button type="button" class="danger" onClick={() => props.deleteSession(selected())}><Icon name="trash" /> Delete</button>
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
            <div class="session-main">
              <TranscriptPanel
                sessionID={selected().id}
                data={props.data}
                loading={props.loading}
                providers={props.providers}
                concealCodeBlocks={props.concealCodeBlocks}
                showTimestamps={props.showTimestamps}
                showThinking={props.showThinking}
                showToolDetails={props.showToolDetails}
                showScrollbar={props.showScrollbar}
                showGenericToolOutput={props.showGenericToolOutput}
                setPromptFollowStarter={(start) => { startTranscriptPromptFollow = start }}
                loadOlderMessages={props.loadOlderMessages}
              />
              <SessionInspector
                session={selected()}
                data={props.data}
                providers={props.providers}
                mcp={props.mcp}
                lsp={props.lsp}
                lspEnabled={props.config?.lsp === undefined ? undefined : props.config.lsp !== false}
              />
            </div>
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
                <Show when={mentionMenuVisible()}>
                  <div class="slash-command-menu mention-menu" role="listbox" aria-label="Mentions" onMouseDown={(event) => event.preventDefault()}>
                    <For each={mentionOptions()}>
                      {(option) => (
                        <button type="button" role="option" onClick={() => chooseMention(option)}>
                          <strong>{option.replacement}</strong>
                          <span>{option.category} - {option.detail}</span>
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
                    const value = event.currentTarget.value
                    setDraftPrompt(value)
                    setDraftParts((current) => prunePromptPartsForInput(value, current))
                    setHistoryIndex(-1)
                    setHistoryDraft("")
                    setSlashMenuOpen(true)
                    setSelectedSlashCommand(0)
                  }}
                  onPaste={(event) => {
                    const files = Array.from(event.clipboardData?.files ?? [])
                    if (files.length === 0) return
                    event.preventDefault()
                    void pasteFiles(files)
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
                    if (event.altKey && event.key === "ArrowUp") {
                      event.preventDefault()
                      loadHistory(-1)
                      return
                    }
                    if (event.altKey && event.key === "ArrowDown") {
                      event.preventDefault()
                      loadHistory(1)
                      return
                    }
                    const historyOffset = promptHistoryOffset(event)
                    if (historyOffset !== undefined && loadHistory(historyOffset)) {
                      event.preventDefault()
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
                  <Show when={draftParts().length > 0}>
                    <div class="composer-stash-actions">
                      <span>{draftParts().length} attachment{draftParts().length === 1 ? "" : "s"}</span>
                    </div>
                  </Show>
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
                    <Show when={filteredFavoriteModelOptions().length > 0}>
                      <ModelPickerSection title="Favorites" selectedModel={props.selectedModel} favorites={favoriteModels()} options={filteredFavoriteModelOptions()} select={selectModel} toggleFavorite={toggleFavoriteModel} />
                    </Show>
                    <Show when={filteredRecentModelOptions().length > 0}>
                      <ModelPickerSection title="Recently used" selectedModel={props.selectedModel} favorites={favoriteModels()} options={filteredRecentModelOptions()} select={selectModel} toggleFavorite={toggleFavoriteModel} />
                    </Show>
                    <For each={filteredProviderModelOptions()}>
                      {(group) => (
                        <ModelPickerSection
                          title={group.provider.name}
                          selectedModel={props.selectedModel}
                          favorites={favoriteModels()}
                          options={group.models.map((model) => ({ provider: group.provider, model }))}
                          select={selectModel}
                          toggleFavorite={toggleFavoriteModel}
                        />
                      )}
                    </For>
                    <Show when={filteredFavoriteModelOptions().length === 0 && filteredRecentModelOptions().length === 0 && filteredProviderModelOptions().length === 0}>
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
    <section class="transcript" classList={{ "hide-scrollbar": !props.showScrollbar }} ref={transcript} onScroll={handleScroll} onWheel={handleWheel}>
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

function ModelPickerSection(props: { title: string; selectedModel: string; favorites: string[]; options: ModelPickerOption[]; select: (providerID: string, modelID: string) => void; toggleFavorite: (value: string) => void }) {
  return (
    <section class="model-picker-section">
      <h3>{props.title}</h3>
      <div>
        <For each={props.options}>
          {(option) => {
            const value = modelValue(option.provider.id, option.model.id)
            const favorite = () => props.favorites.includes(value)
            return (
              <button type="button" classList={{ selected: props.selectedModel === value }} onClick={() => props.select(option.provider.id, option.model.id)}>
                <span>{option.model.name ?? option.model.id}</span>
                <small>{option.provider.name}</small>
                <Show when={isFreeOpencodeModel(option.provider, option.model)}><em>Free</em></Show>
                <span
                  class="model-favorite-toggle"
                  classList={{ active: favorite() }}
                  role="button"
                  tabIndex={0}
                  aria-label={favorite() ? "Remove favorite" : "Add favorite"}
                  title={favorite() ? "Remove favorite" : "Add favorite"}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.toggleFavorite(value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    event.stopPropagation()
                    props.toggleFavorite(value)
                  }}
                >
                  <Icon name="star" />
                  {favorite() ? "Favorite" : "Add"}
                </span>
              </button>
            )
          }}
        </For>
      </div>
    </section>
  )
}

function readFavoriteModels() {
  if (typeof localStorage === "undefined") return []
  try {
    const parsed = JSON.parse(localStorage.getItem("opencodex.gui.favoriteModels") ?? "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === "string").slice(0, 20)
  } catch {
    return []
  }
}

function writeFavoriteModels(values: string[]) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem("opencodex.gui.favoriteModels", JSON.stringify(values.slice(0, 20)))
}

function readComposerStash() {
  if (typeof localStorage === "undefined") return []
  return parsePromptStash(localStorage.getItem("opencodex.gui.promptStash") ?? "")
}

function writeComposerStash(entries: GuiPromptStashEntry[]) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem("opencodex.gui.promptStash", entries.map((entry) => JSON.stringify(entry)).join("\n"))
}

function readComposerDraft(sessionID?: string) {
  if (!sessionID || typeof localStorage === "undefined") return
  return parsePromptDrafts(localStorage.getItem("opencodex.gui.promptDrafts") ?? "{}")[sessionID]
}

function writeComposerDraft(sessionID: string, draft: GuiPromptInfo) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(
    "opencodex.gui.promptDrafts",
    JSON.stringify(mergePromptDraft(parsePromptDrafts(localStorage.getItem("opencodex.gui.promptDrafts") ?? "{}"), sessionID, draft)),
  )
}

function clearComposerDraft(sessionID?: string) {
  if (!sessionID || typeof localStorage === "undefined") return
  const drafts = parsePromptDrafts(localStorage.getItem("opencodex.gui.promptDrafts") ?? "{}")
  const next = Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== sessionID))
  localStorage.setItem("opencodex.gui.promptDrafts", JSON.stringify(next))
}

async function filePartFromFile(file: File): Promise<PromptPart> {
  return {
    type: "file",
    filename: file.name || undefined,
    mime: file.type || "application/octet-stream",
    url: await fileToDataURL(file),
  }
}

function fileToDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => resolve(typeof reader.result === "string" ? reader.result : ""))
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Failed to read file.")))
    reader.readAsDataURL(file)
  })
}

function textPart(part: MessageBundle["parts"][number]) {
  return part.type === "text" ? part.text : ""
}

function promptHistoryOffset(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const textarea = event.currentTarget
  if (event.key === "ArrowUp" && textarea.value.slice(0, textarea.selectionStart).includes("\n") === false) return -1
  if (event.key !== "ArrowDown") return
  if (textarea.value.slice(textarea.selectionEnd).includes("\n")) return
  return 1
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

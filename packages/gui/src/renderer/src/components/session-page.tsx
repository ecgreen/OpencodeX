import type { Provider } from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import { isFreeOpencodeModel, modelValue, parseModelValue, type ModelPickerOption } from "../lib/model-selection"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { MessageBundle, PromptPart, SessionData } from "../lib/store"
import { EMPTY_VIEW_PANE_RUNTIME_STATE, type ViewPaneRuntimeState } from "../lib/view-pane-state"
import {
  nextPromptHistoryState,
  pushPromptStash,
  type GuiPromptInfo,
  type GuiPromptStashEntry,
} from "../lib/prompt-state"
import { buildPromptMentionOptions, prunePromptPartsForInput, referenceSearch, type PromptMentionOption } from "../lib/prompt-autocomplete"
import {
  clearComposerDraft,
  filePartFromFile,
  formatTokenCount,
  isAssistantMessage,
  readComposerDraft,
  readComposerStash,
  readFavoriteModels,
  textPart,
  writeComposerDraft,
  writeComposerStash,
  writeFavoriteModels,
} from "../lib/session-composer-helpers"
import { permissionToolPart } from "../lib/tool-display"
import { SessionComposer } from "./session-composer"
import { PermissionPanel, QuestionPanel } from "./session-safety-panels"
import { TranscriptPanel } from "./session-transcript-panel"
import { SessionModelPicker } from "./session-model-picker"
import type { SessionPageProps } from "./session-page-types"
import { SessionSidePanel, type SessionSidePanelRequest, type SessionSidePanelTarget } from "./session-side-panel"
import { SessionToolbar } from "./session-toolbar"

export function SessionPage(props: SessionPageProps) {
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
  const [sidePanelOpen, setSidePanelOpen] = createSignal(readSidePanelOpen())
  const [sidePanelWidthRatio, setSidePanelWidthRatio] = createSignal(readSidePanelWidthRatio())
  const [sidePanelRequest, setSidePanelRequest] = createSignal<SessionSidePanelRequest>()
  const sidePanelEnabled = () => props.sidePanelEnabled !== false
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
  createEffect(() => {
    if (!sidePanelEnabled()) return
    writeSidePanelOpen(sidePanelOpen())
    writeSidePanelWidthRatio(sidePanelWidthRatio())
  })
  const openSidePanelTarget = (request: SessionSidePanelTarget = { tab: "git" }) => {
    if (props.openSidePanelTarget) {
      props.openSidePanelTarget(request)
      return
    }
    if (!sidePanelEnabled()) return
    openSidePanel(request)
  }
  const openSidePanel = (request: SessionSidePanelTarget = { tab: "git" }) => {
    setSidePanelOpen(true)
    setSidePanelRequest({ ...request, token: Date.now() } as SessionSidePanelRequest)
  }
  const toggleSidePanel = () => {
    if (sidePanelOpen()) {
      setSidePanelOpen(false)
      return
    }
    openSidePanel()
  }
  const startSidePanelResize = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const container = event.currentTarget.parentElement
    const containerWidth = container?.getBoundingClientRect().width ?? window.innerWidth
    const startX = event.clientX
    const startRatio = sidePanelWidthRatio()
    const onMove = (moveEvent: PointerEvent) => {
      setSidePanelWidthRatio(clampSidePanelWidthRatio(startRatio - ((moveEvent.clientX - startX) / containerWidth)))
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }
  const openTranscriptTarget = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const fileTarget = target.closest<HTMLElement>("[data-side-panel-file]")
    const filePath = fileTarget?.dataset.sidePanelFile
    if (filePath) {
      event.preventDefault()
      openSidePanelTarget({ tab: "open", value: filePath })
      return
    }
    const anchor = target.closest<HTMLAnchorElement>("a[href]")
    const href = anchor?.href
    if (!href) return
    if (href.startsWith("http://") || href.startsWith("https://")) {
      event.preventDefault()
      openSidePanelTarget({ tab: "open", value: href, title: anchor.textContent?.trim() || undefined })
      return
    }
    if (href.startsWith("file://")) {
      event.preventDefault()
      openSidePanelTarget({ tab: "open", value: href })
    }
  }
  return (
    <div class="page session-page" data-session-id={session()?.id} classList={{ "session-empty": !sessionStarted() }}>
      <Show when={session()} fallback={<Empty text="Session not found" />}>
        {(selected) => (
          <>
            <div class="session-page-top">
              <SessionToolbar
                session={selected()}
                status={props.status}
                blocked={blocked()}
                pending={props.pending}
                concealCodeBlocks={props.concealCodeBlocks}
                showTimestamps={props.showTimestamps}
                showThinking={props.showThinking}
                showToolDetails={props.showToolDetails}
                showScrollbar={props.showScrollbar}
                showGenericToolOutput={props.showGenericToolOutput}
                abortSession={props.abortSession}
                renameSession={props.renameSession}
                moveSession={props.moveSession}
                deleteSession={props.deleteSession}
                toggleCodeConceal={props.toggleCodeConceal}
                toggleTimestamps={props.toggleTimestamps}
                toggleThinking={props.toggleThinking}
                toggleToolDetails={props.toggleToolDetails}
                toggleScrollbar={props.toggleScrollbar}
                toggleGenericToolOutput={props.toggleGenericToolOutput}
                sidePanelOpen={sidePanelEnabled() ? sidePanelOpen() : undefined}
                toggleSidePanel={sidePanelEnabled() ? toggleSidePanel : undefined}
              />
              <For each={props.permissions}>
                {(request) => <PermissionPanel request={request} tool={permissionToolPart(request, props.data.messages)} reply={props.replyPermission} />}
              </For>
              <For each={props.questions}>
                {(request) => <QuestionPanel request={request} reply={props.replyQuestion} reject={props.rejectQuestion} />}
              </For>
            </div>
            <div class="session-main" onClick={openTranscriptTarget}>
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
              <Show when={sidePanelEnabled()}>
                <SessionSidePanel
                  open={sidePanelOpen()}
                  widthRatio={sidePanelWidthRatio()}
                  session={selected()}
                  data={props.data}
                  providers={props.providers}
                  mcp={props.mcp}
                  lsp={props.lsp}
                  config={props.config}
                  gui={props.gui}
                  directory={props.sidePanelDirectory ?? selected().directory}
                  request={sidePanelRequest()}
                  startResize={startSidePanelResize}
                  close={() => setSidePanelOpen(false)}
                />
              </Show>
            </div>
            <SessionComposer
              blocked={blocked()}
              running={running()}
              mode={mode()}
              draftPrompt={draftPrompt()}
              draftParts={draftParts()}
              draftText={draftText()}
              slashMenuVisible={slashMenuVisible()}
              visibleSlashCommands={visibleSlashCommands()}
              selectedSlashCommand={selectedSlashCommand()}
              mentionMenuVisible={mentionMenuVisible()}
              mentionOptions={mentionOptions()}
              variants={variants()}
              variantPickerOpen={variantPickerOpen()}
              selectedVariant={props.selectedVariant}
              modelLabel={modelLabel()}
              variantLabel={variantLabel()}
              usageLabel={usageLabel()}
              submit={submitComposer}
              setTextarea={(element) => { composerTextarea = element }}
              setDraftPrompt={setDraftPrompt}
              setDraftParts={setDraftParts}
              setHistoryIndex={setHistoryIndex}
              setHistoryDraft={setHistoryDraft}
              setSlashMenuOpen={setSlashMenuOpen}
              setSelectedSlashCommand={setSelectedSlashCommand}
              setModelPickerOpen={setModelPickerOpen}
              setVariantPickerOpen={setVariantPickerOpen}
              runSlashCommand={runSlashCommand}
              completeSlashCommand={completeSlashCommand}
              selectSlashCommand={selectSlashCommand}
              chooseMention={chooseMention}
              pasteFiles={(files) => void pasteFiles(files)}
              cycleVariant={cycleVariant}
              loadHistory={loadHistory}
              toggleMode={toggleMode}
              selectVariant={selectVariant}
            />
            <Show when={modelPickerOpen()}>
              <SessionModelPicker
                query={modelQuery()}
                favorites={favoriteModels()}
                selectedModel={props.selectedModel}
                favoriteOptions={filteredFavoriteModelOptions()}
                recentOptions={filteredRecentModelOptions()}
                providerGroups={filteredProviderModelOptions()}
                close={() => setModelPickerOpen(false)}
                setQuery={setModelQuery}
                select={selectModel}
                toggleFavorite={toggleFavoriteModel}
              />
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

function filterModelOptions(options: ModelPickerOption[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return options
  return options.filter((option) => `${option.model.name ?? option.model.id} ${option.provider.name}`.toLowerCase().includes(needle))
}

function Empty(props: { text: string }) {
  return <div class="empty">{props.text}</div>
}

const SIDE_PANEL_OPEN_KEY = "opencodex.gui.sessionSidePanel.open"
const SIDE_PANEL_WIDTH_KEY = "opencodex.gui.sessionSidePanel.width"

function readSidePanelOpen() {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem(SIDE_PANEL_OPEN_KEY) === "open"
}

function writeSidePanelOpen(value: boolean) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(SIDE_PANEL_OPEN_KEY, value ? "open" : "closed")
}

function readSidePanelWidthRatio() {
  if (typeof localStorage === "undefined") return 0.4
  const parsed = Number(localStorage.getItem(SIDE_PANEL_WIDTH_KEY))
  return clampSidePanelWidthRatio(Number.isFinite(parsed) ? parsed : 0.4)
}

function writeSidePanelWidthRatio(value: number) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(SIDE_PANEL_WIDTH_KEY, String(clampSidePanelWidthRatio(value)))
}

function clampSidePanelWidthRatio(value: number) {
  return Math.max(0.28, Math.min(0.7, value))
}

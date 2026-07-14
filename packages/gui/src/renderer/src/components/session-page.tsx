import { For, Show, Suspense, createEffect, createMemo, createResource, createSignal, lazy } from "solid-js"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { PromptPart } from "../lib/store"
import { EMPTY_VIEW_PANE_RUNTIME_STATE } from "../lib/view-pane-state"
import {
  nextPromptHistoryState,
  pushPromptStash,
  type GuiPromptStashEntry,
} from "../lib/prompt-state"
import { buildPromptMentionOptions, referenceSearch, type PromptMentionOption } from "../lib/prompt-autocomplete"
import {
  clearComposerDraft,
  filePartFromFile,
  filePartFromPath,
  formatTokenCount,
  isAssistantMessage,
  readComposerDraft,
  readComposerStash,
  textPart,
  writeComposerDraft,
  writeComposerStash,
} from "../lib/session-composer-helpers"
import { permissionToolPart } from "../lib/tool-display"
import { SessionComposer } from "./session-composer"
import { PermissionPanel, QuestionPanel } from "./session-safety-panels"
import { TranscriptPanel } from "./session-transcript-panel"
import { SessionModelPicker } from "./session-model-picker"
import { createSessionModelController } from "./session-model-controller"
import type { SessionPageProps } from "./session-page-types"
import { createSessionSidePanelController } from "./session-side-panel-controller"
import { SessionToolbar } from "./session-toolbar"

const SessionSidePanel = lazy(() => import("./session-side-panel").then((module) => ({ default: module.SessionSidePanel })))

export function SessionPage(props: SessionPageProps) {
  const session = () => props.session
  const blocked = () => props.permissions.length > 0 || props.questions.length > 0
  let transcriptExpandedSessionID = ""
  let transcriptExpandedSessionKey = ""
  let composerTextarea: HTMLTextAreaElement | undefined
  const models = createSessionModelController(props)
  const sidePanel = createSessionSidePanelController(props)
  const [localDraftPrompt, setLocalDraftPrompt] = createSignal(props.prompt)
  const [localDraftParts, setLocalDraftParts] = createSignal<PromptPart[]>([])
  const [stash, setStash] = createSignal<GuiPromptStashEntry[]>(readComposerStash())
  const [localHistoryIndex, setLocalHistoryIndex] = createSignal(-1)
  const [localHistoryDraft, setLocalHistoryDraft] = createSignal("")
  const [slashMenuOpen, setSlashMenuOpen] = createSignal(false)
  const [selectedSlashCommand, setSelectedSlashCommand] = createSignal(0)
  const [emptyStateDismissed, setEmptyStateDismissed] = createSignal(false)
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
  const running = createMemo(() => props.status === "busy" || props.status === "retry")
  const toolbarSession = createMemo(() => {
    const selected = session()
    if (!selected || selected.id.startsWith("pending:")) return
    return selected
  })
  const transcriptSessionID = createMemo(() => session()?.id ?? "empty-session")
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
  const resizeComposer = () => {
    if (!composerTextarea) return
    composerTextarea.style.height = "auto"
    composerTextarea.style.height = `${composerTextarea.scrollHeight}px`
  }
  const submitComposer = (event: SubmitEvent) => {
    event.preventDefault()
    const text = draftText()
    const parts = draftParts()
    if (blocked() || (!text && parts.length === 0)) return
    if (props.pending && sidePanel.open()) sidePanel.requestPendingOpenHandoff()
    const shellText = text.startsWith("!") ? text.slice(1).trimStart() : undefined
    const promptText = shellText ?? text
    setEmptyStateDismissed(true)
    setDraftPrompt("")
    setDraftParts([])
    setHistoryIndex(-1)
    setHistoryDraft("")
    requestAnimationFrame(resizeComposer)
    clearComposerDraft(session()?.id)
    props.submit(event, {
      input: promptText,
      parts: shellText !== undefined ? [] : parts.length ? [...(text ? [{ type: "text" as const, text }] : []), ...parts] : [{ type: "text", text }],
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
    void command.run({ draftPrompt: currentDraft, draftParts: currentParts, setDraftPrompt, setDraftParts, openModelPicker: () => models.setPickerOpen(true) })
  }
  const completeSlashCommand = (command: SessionSlashCommand | undefined) => {
    if (!command) return
    setDraftPrompt(`/${command.name}`)
    setSlashMenuOpen(true)
    requestAnimationFrame(resizeComposer)
  }
  const chooseMention = (option: PromptMentionOption) => {
    const nextPrompt = removeTrailingMentionQuery(draftPrompt())
    setDraftPrompt(nextPrompt)
    setDraftParts((current) => [...current, option.part])
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
  const addContextPaths = (items: Array<{ path: string; type?: "file" | "directory" }>) => {
    const context = items.map((item) => ({ ...item, path: item.path.trim() })).filter((item) => item.path)
    if (context.length === 0) return
    setDraftParts((current) => [...current, ...context.map((item) => filePartFromPath(item))])
    requestAnimationFrame(resizeComposer)
  }
  const addPickedContext = async () => {
    const items = await window.opencodex?.contextPaths?.(session()?.directory)
    if (!items?.length) return
    addContextPaths(items)
  }
  const dropContext = async (event: DragEvent) => {
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length === 0) return
    event.preventDefault()
    const dropped = files.map((file) => ({ file, path: window.opencodex?.pathForFile?.(file) || file.webkitRelativePath }))
    const paths = dropped.map((item) => item.path).filter((item): item is string => Boolean(item))
    if (paths.length > 0) addContextPaths(paths.map((path) => ({ path })))
    if (paths.length < files.length) await pasteFiles(dropped.filter((item) => !item.path).map((item) => item.file))
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
    const key = `${id}:${props.session?.directory ?? ""}:${props.pending ? "pending" : "ready"}`
    if (key === transcriptExpandedSessionKey) return
    const previousID = transcriptExpandedSessionID
    transcriptExpandedSessionKey = key
    transcriptExpandedSessionID = id
    if (!(emptyStateDismissed() && previousID.startsWith("pending:") && id && !id.startsWith("pending:"))) setEmptyStateDismissed(false)
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
    <div class="page session-page" data-session-id={session()?.id}>
      <div class="session-page-top">
        <Show when={toolbarSession()}>
          {(selected) => (
            <SessionToolbar
              session={selected()}
              projectName={props.projectName}
              pending={props.pending}
              showTimestamps={props.showTimestamps}
              showThinking={props.showThinking}
              showToolDetails={props.showToolDetails}
              showScrollbar={props.showScrollbar}
              showGenericToolOutput={props.showGenericToolOutput}
              renameSession={props.renameSession}
              moveSession={props.moveSession}
              deleteSession={props.deleteSession}
              readyForReview={props.readyForReview}
              markSessionReviewed={props.markSessionReviewed}
              toggleTimestamps={props.toggleTimestamps}
              toggleThinking={props.toggleThinking}
              toggleToolDetails={props.toggleToolDetails}
              toggleScrollbar={props.toggleScrollbar}
              toggleGenericToolOutput={props.toggleGenericToolOutput}
              sidePanelOpen={sidePanel.enabled() ? sidePanel.open() : undefined}
              toggleSidePanel={sidePanel.enabled() ? sidePanel.toggle : undefined}
            />
          )}
        </Show>
      </div>
      <div class="session-main" onClick={sidePanel.openTranscriptTarget}>
        <div class="session-workspace">
          <TranscriptPanel
            sessionID={transcriptSessionID()}
            data={props.data}
            loading={props.loading}
            providers={props.providers}
            showTimestamps={props.showTimestamps}
            showThinking={props.showThinking}
            showToolDetails={props.showToolDetails}
            showScrollbar={props.showScrollbar}
            showGenericToolOutput={props.showGenericToolOutput}
            running={running()}
            emptyStateDismissed={emptyStateDismissed()}
            emptyStateHandoff={props.pending === true && emptyStateDismissed()}
            loadOlderMessages={props.loadOlderMessages}
          />
          <Show when={blocked()}>
            <div class="session-feedback">
              <For each={props.permissions}>
                {(request) => <PermissionPanel request={request} tool={permissionToolPart(request, props.data.messages)} reply={props.replyPermission} />}
              </For>
              <For each={props.questions}>
                {(request) => <QuestionPanel request={request} reply={props.replyQuestion} reject={props.rejectQuestion} />}
              </For>
            </div>
          </Show>
          <SessionComposer
            blocked={blocked()}
            running={running()}
            mode={models.mode()}
            draftPrompt={draftPrompt()}
            draftParts={draftParts()}
            draftText={draftText()}
            slashMenuVisible={slashMenuVisible()}
            visibleSlashCommands={visibleSlashCommands()}
            selectedSlashCommand={selectedSlashCommand()}
            mentionMenuVisible={mentionMenuVisible()}
            mentionOptions={mentionOptions()}
            variants={models.variants()}
            variantPickerOpen={models.variantPickerOpen()}
            selectedVariant={props.selectedVariant}
            modelLabel={models.label()}
            variantLabel={models.variantLabel()}
            usageLabel={usageLabel()}
            submit={submitComposer}
            setTextarea={(element) => { composerTextarea = element }}
            setDraftPrompt={setDraftPrompt}
            setDraftParts={setDraftParts}
            setHistoryIndex={setHistoryIndex}
            setHistoryDraft={setHistoryDraft}
            setSlashMenuOpen={setSlashMenuOpen}
            setSelectedSlashCommand={setSelectedSlashCommand}
            setModelPickerOpen={models.setPickerOpen}
            setVariantPickerOpen={models.setVariantPickerOpen}
            runSlashCommand={runSlashCommand}
            completeSlashCommand={completeSlashCommand}
            selectSlashCommand={selectSlashCommand}
            chooseMention={chooseMention}
            pasteFiles={(files) => void pasteFiles(files)}
            addPickedContext={() => void addPickedContext()}
            dropContext={(event) => void dropContext(event)}
            cycleVariant={models.cycleVariant}
            loadHistory={loadHistory}
            toggleMode={models.toggleMode}
            setMode={models.setMode}
            selectVariant={models.selectVariant}
          />
        </div>
        <Show when={sidePanel.mounted() ? sidePanel.session() : undefined}>
          {(selected) => (
            <Suspense fallback={<aside class="session-side-panel open" aria-busy="true">Loading workspace tools...</aside>}>
              <SessionSidePanel
              open={sidePanel.open()}
              widthRatio={sidePanel.widthRatio()}
                session={selected()}
                data={props.data}
                providers={props.providers}
                mcp={props.mcp}
                lsp={props.lsp}
                config={props.config}
                gui={props.gui}
                directory={props.sidePanelDirectory ?? selected().directory}
              request={sidePanel.request()}
              startResize={sidePanel.startResize}
              close={() => sidePanel.setOpen(false)}
              />
            </Suspense>
          )}
        </Show>
      </div>
      <Show when={models.pickerOpen()}>
        <SessionModelPicker
          query={models.query()}
          favorites={models.favorites()}
          selectedModel={props.selectedModel}
          favoriteOptions={models.filteredFavoriteOptions()}
          recentOptions={models.filteredRecentOptions()}
          providerGroups={models.filteredProviderGroups()}
          connectedProviderIDs={props.connectedProviderIDs ?? []}
          close={() => models.setPickerOpen(false)}
          setQuery={models.setQuery}
          select={models.select}
          toggleFavorite={models.toggleFavorite}
        />
      </Show>
    </div>
  )
}

function removeTrailingMentionQuery(input: string) {
  return input.replace(/(^|\s)@[^\s@]*$/, "$1").replace(/[ \t]+$/, "")
}

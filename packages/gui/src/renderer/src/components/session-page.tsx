import { Show, Suspense, createEffect, createMemo, createSignal, lazy, onCleanup, onMount } from "solid-js"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import { nextPromptHistoryState, pushPromptStash, type GuiPromptStashEntry } from "../lib/prompt-state"
import { removeTrailingMentionQuery, type PromptMentionOption } from "../lib/prompt-autocomplete"
import {
  filePartFromFile,
  filePartFromPath,
  readComposerDraft,
  readComposerStash,
  subscribeComposerStash,
  writeComposerStash,
} from "../lib/session-composer-helpers"
import { readClaudeDriverMarker } from "../lib/claude-driver-marker"
import { Button, InlineNotice } from "./ui"
import { SessionComposer } from "./session-composer"
import { createComposerPromptRestore, createSessionMessageActionHandler } from "./session-message-actions"
import { SessionSafetyDock } from "./session-safety-dock"
import { SessionSidePanelLoading } from "./panel-loading-state"
import { TranscriptPanel } from "./session-transcript-panel"
import { SessionModelPicker } from "./session-model-picker"
import { SessionGoalGraph } from "./session-goal-graph"
import { SessionSwarmTeam } from "./swarm-team-strip"
import { createSessionModelController } from "./session-model-controller"
import type { SessionPageProps } from "./session-page-types"
import { SessionPageToolbar } from "./session-page-toolbar"
import { createSessionSidePanelController } from "./session-side-panel-controller"
import { createSessionComposerDraftState } from "./session-composer-draft-state"
import { createSessionComposerPresentation } from "./session-composer-presentation"
import { createSessionComposerInputController } from "./session-composer-input-controller"
import { subscribeSessionBrowserCaptures } from "../lib/session-browser-capture"
const SessionSidePanel = lazy(() => import("./session-side-panel").then((module) => ({ default: module.SessionSidePanel })))
export function SessionPage(props: SessionPageProps) {
  const session = () => props.session
  const blocked = () => props.permissions.length > 0 || props.questions.length > 0
  let composerWasBlocked = blocked()
  let transcriptExpandedSessionID = ""
  let transcriptExpandedSessionKey = ""
  const models = createSessionModelController(props)
  const sidePanel = createSessionSidePanelController(props)
  const [stash, setStash] = createSignal<GuiPromptStashEntry[]>(readComposerStash())
  const [slashMenuOpen, setSlashMenuOpen] = createSignal(false)
  const [selectedSlashCommand, setSelectedSlashCommand] = createSignal(0)
  const [emptyStateDismissed, setEmptyStateDismissed] = createSignal(false)
  onMount(() => onCleanup(subscribeComposerStash(setStash)))
  const composerState = createSessionComposerDraftState(props)
  const draftPrompt = composerState.draftPrompt
  const draftParts = composerState.draftParts
  const historyIndex = composerState.historyIndex
  const historyDraft = composerState.historyDraft
  const setDraftPrompt = composerState.setDraftPrompt
  const setDraftParts = composerState.setDraftParts
  const setHistoryIndex = composerState.setHistoryIndex
  const setHistoryDraft = composerState.setHistoryDraft
  const running = createMemo(() => props.status === "busy" || props.status === "retry")
  const composerInput = createSessionComposerInputController({
    sessionID: () => session()?.id,
    draft: () => ({ input: draftPrompt(), parts: draftParts() }),
    persistent: !props.composerState,
  })
  const transcriptSessionID = createMemo(() => session()?.id ?? "empty-session")
  const draftText = createMemo(() => draftPrompt().trim())
  const { slashQuery, visibleSlashCommands, slashMenuVisible, mentionQuery, mentionOptions, mentionMenuVisible, userHistory, usageLabel } = createSessionComposerPresentation({ props, draftPrompt, slashMenuOpen, blocked })
  const resizeComposer = composerInput.resize
  const submitComposer = async (event: SubmitEvent) => {
    event.preventDefault()
    const draft = draftPrompt()
    const text = draftText()
    const parts = [...draftParts()]
    if (blocked() || (!text && parts.length === 0)) return
    // Sending here fails server-side with no assistant message to hang the error
    // on, so the draft is kept and the composer banner explains the fix.
    if (models.disconnectedProvider()) return
    if (props.pending && sidePanel.open()) sidePanel.requestPendingOpenHandoff()
    const shellText = text.startsWith("!") ? text.slice(1).trimStart() : undefined
    const promptText = shellText ?? text
    setDraftPrompt("")
    setDraftParts([])
    resizeComposer()
    composerInput.flush()
    const accepted = await props.submit(event, {
      input: promptText,
      parts:
        shellText !== undefined
          ? []
          : parts.length
            ? [...(text ? [{ type: "text" as const, text }] : []), ...parts]
            : [{ type: "text", text }],
      ...(shellText !== undefined ? { mode: "shell" } : {}),
    })
    if (!accepted) {
      setDraftPrompt((current) => (!draft ? current : current ? `${draft}\n${current}` : draft))
      setDraftParts((current) => [...parts, ...current])
      resizeComposer()
      composerInput.flush()
      return
    }
    setEmptyStateDismissed(true)
    setHistoryIndex(-1)
    setHistoryDraft("")
  }
  const runSlashCommand = (command: SessionSlashCommand | undefined) => {
    if (!command || command.disabled) return
    const currentDraft = draftPrompt()
    const currentParts = draftParts()
    setDraftPrompt("")
    setSlashMenuOpen(false)
    resizeComposer()
    composerInput.flush()
    void command.run({ draftPrompt: currentDraft, draftParts: currentParts, setDraftPrompt, setDraftParts, openModelPicker: () => models.setPickerOpen(true) })
  }
  const completeSlashCommand = (command: SessionSlashCommand | undefined) => {
    if (!command) return
    setDraftPrompt(`/${command.name}`)
    setSlashMenuOpen(true)
    resizeComposer()
  }
  const chooseMention = (option: PromptMentionOption) => {
    const nextPrompt = removeTrailingMentionQuery(draftPrompt())
    setDraftPrompt(nextPrompt)
    setDraftParts((current) => [...current, option.part])
    resizeComposer()
  }
  const stashPrompt = () => {
    const prompt = { input: draftPrompt(), parts: draftParts() }
    const next = pushPromptStash(readComposerStash(), prompt)
    setStash(next)
    writeComposerStash(next)
    setDraftPrompt("")
    setDraftParts([])
    composerInput.flush()
  }
  const popStash = () => {
    const entries = readComposerStash()
    const entry = entries.at(-1)
    if (!entry) return
    const next = entries.slice(0, -1)
    setStash(next)
    writeComposerStash(next)
    setDraftPrompt(entry.input)
    setDraftParts(entry.parts)
    resizeComposer()
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
    resizeComposer()
    return true
  }
  const pasteFiles = async (files: File[]) => {
    const parts = await Promise.all(files.map(filePartFromFile))
    setDraftParts((current) => [...current, ...parts])
  }
  onMount(() => onCleanup(subscribeSessionBrowserCaptures({ sessionID: () => session()?.id, pasteFiles, focus: () => composerInput.textarea()?.focus({ preventScroll: true }) })))
  const addContextPaths = (items: Array<{ path: string; type?: "file" | "directory" }>) => {
    const context = items.map((item) => ({ ...item, path: item.path.trim() })).filter((item) => item.path)
    if (context.length === 0) return
    setDraftParts((current) => [...current, ...context.map((item) => filePartFromPath(item))])
    resizeComposer()
  }
  const addPickedContext = async () => {
    const items = await window.opencodex?.contextPaths?.(session()?.directory)
    if (!items?.length) return
    addContextPaths(items)
  }
  const restoreComposerPrompt = createComposerPromptRestore({ setDraftPrompt, setDraftParts, resizeComposer, focus: () => composerInput.textarea()?.focus({ preventScroll: true }) })
  const handleMessageAction = createSessionMessageActionHandler({ session, data: () => props.data, onMessageAction: props.onMessageAction, restorePrompt: restoreComposerPrompt })
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
      const textarea = composerInput.textarea()
      if (props.composerFocusToken?.() !== token || !textarea || textarea.disabled) return
      textarea.focus({ preventScroll: true })
    })
  })
  createEffect(() => {
    const next = blocked()
    if (composerWasBlocked && !next) requestAnimationFrame(() => composerInput.textarea()?.focus({ preventScroll: true }))
    composerWasBlocked = next
  })
  // A permission or question needs an answer; snap back to the orchestrator
  // view so the safety dock is never hidden behind a team-member pane.
  createEffect(() => {
    if (blocked() && props.teamMemberSessionID) props.selectTeamMember?.("")
  })
  createEffect(() => {
    const id = props.session?.id ?? ""
    const key = `${id}:${props.session?.directory ?? ""}:${props.pending ? "pending" : "ready"}`
    if (key === transcriptExpandedSessionKey) return
    composerInput.flushPending()
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
    composerInput.schedule({ sessionID: id, draft: value })
    if (!value.input && value.parts.length === 0) composerInput.flushPending()
  })
  // A mirrored Claude Code session cannot run headlessly until the CLI is
  // signed in; the raw terminal page is where that happens.
  const claudeDriver = createMemo(() => readClaudeDriverMarker(session()?.metadata))
  return (
    <div class="page session-page" data-session-id={session()?.id}>
      <SessionPageToolbar props={props} sidePanel={sidePanel} />
      <Show when={claudeDriver()?.authState === "needs-login" ? claudeDriver() : undefined}>
        {(marker) => (
          <InlineNotice tone="warning" title="Claude Code needs to be signed in">
            <p>Open the raw terminal to complete sign-in, then return to this session.</p>
            <Button
              appearance="outline"
              size="compact"
              onClick={() => props.openTerminalSession?.(marker().terminalSessionID)}
            >
              Open terminal to sign in
            </Button>
          </InlineNotice>
        )}
      </Show>
      <div class="session-main" onClick={sidePanel.openTranscriptTarget}>
        <div class="session-workspace">
          <Show when={props.goal} fallback={<SessionSwarmTeam page={props} />}>
            <SessionGoalGraph page={props} />
          </Show>
          <Show when={!((props.team || props.goal) && props.teamMemberSessionID)}>
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
            concealCodeBlocks={props.concealCodeBlocks === true}
            running={running()}
            emptyStateDismissed={emptyStateDismissed()}
            emptyStateHandoff={props.pending === true && emptyStateDismissed()}
            loadOlderMessages={props.loadOlderMessages}
            collapseMessageWindow={props.collapseMessageWindow}
            messageAction={props.onMessageAction ? handleMessageAction : undefined}
            emptyStateSuggestion={restoreComposerPrompt}
            connectProvider={props.connectProvider}
          />
          {/* The dock anchors the safety cards as an overlay above the composer,
              so an arriving permission never resizes the transcript viewport. */}
          <div class="session-dock-anchor">
          <Show when={blocked()}>
            <SessionSafetyDock permissions={props.permissions} questions={props.questions} messages={props.data.messages} replyPermission={props.replyPermission} replyQuestion={props.replyQuestion} rejectQuestion={props.rejectQuestion} />
          </Show>
          <SessionComposer
            blocked={blocked()}
            disconnectedProviderName={models.disconnectedProvider()?.name}
            connectProvider={props.connectProvider ? () => props.connectProvider?.(models.disconnectedProvider()?.id) : undefined}
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
            abortConfirmArmed={props.abortConfirmArmed === true}
            stashCount={stash().length}
            variants={models.variants()}
            variantPickerOpen={models.variantPickerOpen()}
            selectedVariant={props.selectedVariant}
            modelLabel={models.label()}
            variantLabel={models.variantLabel()}
            usageLabel={usageLabel()}
            submit={submitComposer}
            setTextarea={composerInput.setTextarea}
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
            stashPrompt={stashPrompt}
            popStash={popStash}
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
          </Show>
        </div>
        <Show when={sidePanel.mounted() ? sidePanel.session() : undefined}>
          {(selected) => (
            <Suspense fallback={<SessionSidePanelLoading open={sidePanel.open()} widthRatio={sidePanel.widthRatio()} />}>
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
                subscribeGlobalEvents={props.subscribeGlobalEvents}
                directory={props.sidePanelDirectory ?? selected().directory}
                request={sidePanel.request()}
                startResize={sidePanel.startResize}
                toggleMaximized={sidePanel.toggleMaximized}
                resizeByKeyboard={sidePanel.resizeByKeyboard}
              />
            </Suspense>
          )}
        </Show>
      </div>
      <Show when={models.pickerOpen()}>
        <SessionModelPicker
          query={models.query()}
          searching={models.searching()}
          swarmOptions={models.filteredSwarmOptions()}
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
          connectProvider={props.connectProvider}
        />
      </Show>
    </div>
  )
}

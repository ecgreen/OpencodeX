import { Show, Suspense, createEffect, createMemo, createSignal, lazy, onCleanup, onMount } from "solid-js"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import { nextPromptHistoryState } from "../lib/prompt-state"
import { removeTrailingMentionQuery, type PromptMentionOption } from "../lib/prompt-autocomplete"
import { filePartFromFile, filePartFromPath, readComposerDraft } from "../lib/session-composer-helpers"
import { createStableEffect } from "../lib/stable-effect"
import { SessionComposer } from "./session-composer"
import { createComposerPromptRestore, createSessionMessageActionHandler } from "./session-message-actions"
import { SessionClaudeSignInBanner } from "./session-claude-signin-banner"
import { SessionSafetyDock } from "./session-safety-dock"
import { SessionSidePanelLoading } from "./panel-loading-state"
import { TranscriptPanel } from "./session-transcript-panel"
import { SessionModelPicker } from "./session-model-picker"
import { SessionSwarmTeam } from "./swarm-team-strip"
import { SessionGraphSurface } from "./session-graph-surface"
import { SessionGraphDrawer } from "./session-graph-drawer"
import { createSessionModelController } from "./session-model-controller"
import type { SessionPageProps } from "./session-page-types"
import { SessionPageToolbar } from "./session-page-toolbar"
import { createSessionSidePanelController } from "./session-side-panel-controller"
import { createSessionComposerDraftState } from "./session-composer-draft-state"
import { createComposerStashController } from "./session-composer-stash"
import { createSessionComposerPresentation } from "./session-composer-presentation"
import { createSessionComposerInputController } from "./session-composer-input-controller"
import { subscribeSessionBrowserCaptures } from "../lib/session-browser-capture"
import { transcriptSubagentClick } from "../lib/transcript-subagent-link"
import { createSessionFollowupController } from "./session-followup-controller"
import { createSessionComposerSubmit } from "./session-composer-submit"
const SessionSidePanel = lazy(() => import("./session-side-panel").then((module) => ({ default: module.SessionSidePanel })))
export function SessionPage(props: SessionPageProps) {
  const session = () => props.session
  const blocked = () => props.permissions.length > 0 || props.questions.length > 0
  let composerWasBlocked = blocked()
  let transcriptExpandedSessionID = ""
  let transcriptExpandedSessionKey = ""
  const models = createSessionModelController(props)
  const sidePanel = createSessionSidePanelController(props)
  const [slashMenuOpen, setSlashMenuOpen] = createSignal(false)
  const [selectedSlashCommand, setSelectedSlashCommand] = createSignal(0)
  const [emptyStateDismissed, setEmptyStateDismissed] = createSignal(false)
  const composerState = createSessionComposerDraftState(props)
  const draftPrompt = composerState.draftPrompt
  const draftParts = composerState.draftParts
  const historyIndex = composerState.historyIndex
  const historyDraft = composerState.historyDraft
  const setDraftPrompt = composerState.setDraftPrompt
  const setDraftParts = composerState.setDraftParts
  const setHistoryIndex = composerState.setHistoryIndex
  const setHistoryDraft = composerState.setHistoryDraft
  // Mirrors the canonical isClientSessionWorking: a pending prompt counts as
  // running. Without it, the lag between sending a prompt and the backend
  // reporting busy reads as "run finished" - the queue would drain into the
  // starting run and the delivery buttons would flicker back to plain send.
  const running = createMemo(() => props.status === "busy" || props.status === "retry" || props.promptPending === true)
  const composerInput = createSessionComposerInputController({
    sessionID: () => session()?.id,
    draft: () => ({ input: draftPrompt(), parts: draftParts() }),
    persistent: !props.composerState,
  })
  const composerStash = createComposerStashController({
    draftPrompt,
    draftParts,
    setDraftPrompt,
    setDraftParts,
    flush: () => composerInput.flush(),
    resize: () => composerInput.resize(),
  })
  const transcriptSessionID = createMemo(() => session()?.id ?? "empty-session")
  const draftText = createMemo(() => draftPrompt().trim())
  const followup = createSessionFollowupController({ session, running, blocked, prompts: () => props.queuedPrompts ?? [], queue: props.queuePrompt, update: props.updateQueuedPrompt, remove: props.removeQueuedPrompt, submit: props.submit })
  const { visibleSlashCommands, slashMenuVisible, mentionOptions, mentionMenuVisible, userHistory, usageLabel } = createSessionComposerPresentation({ props, draftPrompt, slashMenuOpen, blocked })
  const submitComposer = createSessionComposerSubmit({
    blocked,
    disconnected: () => Boolean(models.disconnectedProvider()),
    draftPrompt, draftText, draftParts, setDraftPrompt, setDraftParts,
    resize: composerInput.resize, flush: composerInput.flush,
    prepare: () => { if (props.pending && sidePanel.open()) sidePanel.requestPendingOpenHandoff() },
    selection: () => ({ agent: props.selectedAgent, model: props.selectedModel, variant: props.selectedVariant }),
    followup, submit: props.submit,
    accepted: () => {
      setEmptyStateDismissed(true); setHistoryIndex(-1); setHistoryDraft("")
    },
  })
  const runSlashCommand = (command: SessionSlashCommand | undefined) => {
    if (!command || command.disabled) return
    const currentDraft = draftPrompt()
    const currentParts = draftParts()
    setDraftPrompt("")
    setSlashMenuOpen(false)
    composerInput.resize()
    composerInput.flush()
    void command.run({ draftPrompt: currentDraft, draftParts: currentParts, setDraftPrompt, setDraftParts, openModelPicker: () => models.setPickerOpen(true) })
  }
  const completeSlashCommand = (command: SessionSlashCommand | undefined) => {
    if (!command) return
    setDraftPrompt(`/${command.name}`)
    setSlashMenuOpen(true)
    composerInput.resize()
  }
  const chooseMention = (option: PromptMentionOption) => {
    const nextPrompt = removeTrailingMentionQuery(draftPrompt())
    setDraftPrompt(nextPrompt)
    setDraftParts((current) => [...current, option.part])
    composerInput.resize()
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
    composerInput.resize()
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
    composerInput.resize()
  }
  const addPickedContext = async () => {
    const items = await window.opencodex?.contextPaths?.(session()?.directory)
    if (!items?.length) return
    addContextPaths(items)
  }
  const restoreComposerPrompt = createComposerPromptRestore({ setDraftPrompt, setDraftParts, resizeComposer: composerInput.resize, focus: () => composerInput.textarea()?.focus({ preventScroll: true }) })
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
    composerInput.resize()
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
  // Guarded: it writes the member selection it reads.
  createStableEffect("sessionPage.clearMemberWhenBlocked", () => {
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
  // The session column is hidden rather than unmounted when it collapses: the
  // transcript keeps its scroll position and its subscriptions, so restoring it
  // is instant and does not re-fetch what the reader was already looking at.
  return (
    <div class="page session-page" data-session-id={session()?.id} data-center-collapsed={sidePanel.centerCollapsed() ? "" : undefined}>
      <SessionPageToolbar props={props} sidePanel={sidePanel} />
      <SessionClaudeSignInBanner
        session={session()}
        messages={props.data.messages}
        claudeSignInConfirmed={props.claudeSignInConfirmed}
        signInToClaude={props.signInToClaude}
        retry={(bundle) => handleMessageAction("retry", bundle)}
      />
      {/* Transcript agent rows stamp `data-subagent-session`; a click on one
          opens the same embedded view a graph node opens into. Everything else
          falls through to the side panel's file and link targets. */}
      <div
        class="session-main"
        onClick={(event) => {
          if (!transcriptSubagentClick(event, props.graph, props.openGraphNode)) sidePanel.openTranscriptTarget(event)
        }}
      >
        <div class="session-workspace" inert={sidePanel.centerCollapsed()}>
          {/* One graph, drawn from what ran. A goal no longer gets a list of its
              own here: its steps are sessions parented to this one, so the
              pipeline already carries them, gates and all. */}
          <SessionSwarmTeam page={props} />
          {/* The pane a graph node opens into; in fullscreen the same surface
              rides the Graph tab's drawer instead - never both. */}
          <Show when={!sidePanel.centerCollapsed()}>
            <SessionGraphSurface page={props} />
          </Show>
          <Show when={!((props.team || props.goal) && props.teamMemberSessionID) && !props.graphNodeSessionID}>
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
            showPromptHistory
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
            queuedPrompts={followup.prompts()}
            updateQueuedPrompt={(id, value) => followup.update(id, value)}
            removeQueuedPrompt={(id) => followup.remove(id)}
            holdQueuedPrompts={followup.hold}
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
            stashCount={composerStash.count()}
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
            stashPrompt={composerStash.push}
            popStash={composerStash.pop}
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
                graph={props.graph}
                graphSelectedNodeID={props.graphSelectedNodeID ?? ""}
                graphTopology={props.graphTopology}
                retryGraphTopology={props.retryGraphTopology}
                openGraphNode={props.openGraphNode}
                openGraphNodeFullPage={props.openGraphNodeFullPage}
                canOpenGraphNodeFullPage={props.canOpenGraphNodeFullPage}
                // Fullscreen drill-down rides the Graph tab itself, measured
                // into the tab's layout and removed with the tab on switch.
                graphDrawer={
                  sidePanel.centerCollapsed() && props.graphNodeSessionID ? (
                    <SessionGraphDrawer page={props} />
                  ) : undefined
                }
                approveGraphGate={(gate, approved) => props.approveGoalNode?.(gate.goalID, gate.nodeID, approved)}
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

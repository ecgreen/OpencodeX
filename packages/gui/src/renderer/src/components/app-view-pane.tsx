import { Show, createMemo, lazy, type Accessor } from "solid-js"
import type { GuiAppModel } from "../controllers/app-model"
import { EMPTY_SESSION_DATA } from "../controllers/authoritative-state-controller"
import { findFiles } from "../lib/session-api"
import { viewItemID, viewItemSession, type ViewItem } from "../lib/view-items"
import { ClaudeTerminalViewPane } from "./claude-terminal-surface"

const ViewPaneHost = lazy(() => import("./view-pane-host").then((module) => ({ default: module.ViewPaneHost })))

export function AppViewPane(props: { model: GuiAppModel; item: Accessor<ViewItem> }) {
  const terminalSession = createMemo(() => {
    const item = props.item()
    return item.kind === "terminal" ? item.terminalSession : undefined
  })
  const openCodeItem = createMemo(() => {
    const item = props.item()
    return item.kind === "terminal" ? undefined : item
  })
  return (
    <Show
      when={terminalSession()}
      fallback={
        <Show when={openCodeItem()}>
          {(item) => <OpenCodeViewPane model={props.model} item={item} />}
        </Show>
      }
    >
      {(terminalSession) => (
        <ClaudeTerminalViewPane
          terminalSession={terminalSession()}
          controller={props.model.claudeTerminals}
          focused={props.model.view.focusedSessionID() === terminalSession().id}
          autoStart={props.model.view.autoStartTerminalID() === terminalSession().id}
          focus={() => props.model.view.focus(terminalSession().id)}
        />
      )}
    </Show>
  )
}

function OpenCodeViewPane(props: {
  model: GuiAppModel
  item: Accessor<Exclude<ViewItem, { kind: "terminal" }>>
}) {
  const paneID = createMemo(() => viewItemID(props.item()))
  const session = createMemo(() => viewItemSession(props.item()))
  const projectName = createMemo(() => {
    const item = props.item()
    if (item.kind === "pending")
      return item.slot.projectLabel ?? props.model.view.projectNameForID(item.slot.projectID)
    return props.model.view.projectNameForSession(session())
  })
  const paneState = createMemo(() => props.model.authoritative.viewPaneState(paneID()))
  const data = createMemo(() =>
    props.item().kind === "session"
      ? (props.model.authoritative.viewSessionData()[paneID()] ?? EMPTY_SESSION_DATA)
      : EMPTY_SESSION_DATA,
  )
  const updatePane = props.model.authoritative.updateViewPaneState
  const run = props.model.notices.run

  return (
    <ViewPaneHost
      item={props.item()}
      projectName={projectName()}
      data={data()}
      loading={paneState().loading}
      status={
        props.item().kind === "session"
          ? (props.model.authoritative.snapshot()?.sessionStatus[paneID()]?.type ?? "idle")
          : "idle"
      }
      promptPending={
        props.item().kind === "session" &&
        props.model.authoritative.snapshot()?.sessionPendingPrompt?.[paneID()] === true
      }
      abortConfirmArmed={props.model.commands.abortConfirmSessionID() === paneID()}
      permissions={
        props.item().kind === "session"
          ? (props.model.authoritative.snapshot()?.permissions.filter((request) => request.sessionID === paneID()) ?? [])
          : []
      }
      questions={
        props.item().kind === "session"
          ? (props.model.authoritative.snapshot()?.questions.filter((request) => request.sessionID === paneID()) ?? [])
          : []
      }
      composerState={paneState()}
      updateComposerState={(update) => updatePane(paneID(), update)}
      focusedSessionID={props.model.view.focusedSessionID()}
      composerFocusRequest={props.model.view.composerFocusRequest()}
      providers={props.model.authoritative.snapshot()?.providers ?? []}
      connectedProviderIDs={props.model.authoritative.snapshot()?.connectedProviderIDs ?? []}
      swarms={props.model.authoritative.snapshot()?.swarms ?? []}
      connectProvider={(providerID) => void props.model.notices.run(() => props.model.capabilities.connectProvider(providerID))}
      mcp={props.model.authoritative.snapshot()?.mcp ?? {}}
      mcpResources={props.model.authoritative.snapshot()?.mcpResources ?? {}}
      lsp={props.model.authoritative.snapshot()?.lsp ?? []}
      config={props.model.authoritative.snapshot()?.config}
      agents={props.model.authoritative.snapshot()?.agents ?? []}
      findFiles={(input) =>
        props.model.authoritative.client()
          ? findFiles(props.model.authoritative.client()!, input)
          : Promise.resolve([])
      }
      recentModels={props.model.sessionState.recentModels()}
      selectedAgent={props.model.view.agentValue(paneID(), session())}
      setSelectedAgent={(sessionID, value) =>
        updatePane(sessionID, (state) =>
          state.selectedAgent === value ? state : { ...state, selectedAgent: value },
        )
      }
      selectedModel={props.model.view.modelValue(paneID(), session())}
      setSelectedModel={(sessionID, value) => {
        updatePane(sessionID, (state) =>
          state.selectedModel === value && state.selectedVariant === ""
            ? state
            : { ...state, selectedModel: value, selectedVariant: "" },
        )
        if (value) props.model.sessionActions.rememberModel(value)
      }}
      selectedVariant={props.model.view.variantValue(paneID(), session())}
      setSelectedVariant={(sessionID, value) =>
        updatePane(sessionID, (state) =>
          state.selectedVariant === value ? state : { ...state, selectedVariant: value },
        )
      }
      focus={(sessionID, focusComposer) => props.model.view.focus(sessionID, { focusComposer })}
      openSidePanelTarget={props.model.view.openSidePanel}
      submit={(item, text, options) => props.model.notices.attempt(() => props.model.view.submitPrompt(item, text, options))}
      queuedPrompts={props.model.sessionState.queuedPrompts(paneID())}
      queuePrompt={props.model.sessionState.queuePrompt}
      updateQueuedPrompt={props.model.sessionState.updateQueuedPrompt}
      removeQueuedPrompt={props.model.sessionState.removeQueuedPrompt}
      queuedPromptDelivered={(text) => props.model.notices.succeed(`Sent queued message: ${text}`)}
      replyPermission={(request, reply) => void run(() => props.model.management.permission(request, reply))}
      replyQuestion={(request, answers) => void run(() => props.model.management.replyToQuestion(request, answers))}
      rejectQuestion={(request) => void run(() => props.model.management.rejectQuestionRequest(request))}
      renameSession={(session) => void run(() => props.model.sessionActions.rename(session))}
      moveSession={(session) => void run(() => props.model.sessionActions.move(session))}
      deleteSession={(session) => void run(() => props.model.sessionActions.remove(session))}
      slashCommands={props.model.sessionSlash.commands(session(), {
        data: data(),
        selectedAgent: props.model.view.agentValue(paneID(), session()),
        selectedModel: props.model.view.modelValue(paneID(), session()),
        selectedVariant: props.model.view.variantValue(paneID(), session()),
        switchModel: () =>
          props.model.sessionActions.switchModelFor({
            setSelectedModel: (value) =>
              updatePane(paneID(), (state) =>
                state.selectedModel === value ? state : { ...state, selectedModel: value },
              ),
            setSelectedVariant: (value) =>
              updatePane(paneID(), (state) =>
                state.selectedVariant === value ? state : { ...state, selectedVariant: value },
              ),
          }),
        switchAgent: () =>
          props.model.sessionActions.switchAgentFor((value) =>
            updatePane(paneID(), (state) =>
              state.selectedAgent === value ? state : { ...state, selectedAgent: value },
            ),
          ),
        switchVariant: () =>
          props.model.sessionActions.switchVariantFor({
            selectedModel: props.model.view.modelValue(paneID(), session()),
            setSelectedVariant: (value) =>
              updatePane(paneID(), (state) =>
                state.selectedVariant === value ? state : { ...state, selectedVariant: value },
              ),
          }),
      })}
      showTimestamps={props.model.transcriptPreferences.showTranscriptTimestamps()}
      concealCodeBlocks={props.model.transcriptPreferences.concealTranscriptCodeBlocks()}
      showThinking={props.model.transcriptPreferences.showTranscriptThinking()}
      showToolDetails={props.model.transcriptPreferences.showTranscriptToolDetails()}
      showScrollbar={props.model.transcriptPreferences.showTranscriptScrollbar()}
      showGenericToolOutput={props.model.transcriptPreferences.showTranscriptGenericToolOutput()}
      toggleCodeConceal={props.model.transcriptPreferences.handleToggleCodeConcealSlash}
      toggleTimestamps={props.model.transcriptPreferences.handleToggleTimestampsSlash}
      toggleThinking={props.model.transcriptPreferences.handleToggleThinkingSlash}
      toggleToolDetails={props.model.transcriptPreferences.handleToggleToolDetailsSlash}
      toggleScrollbar={props.model.transcriptPreferences.handleToggleScrollbarSlash}
      toggleGenericToolOutput={props.model.transcriptPreferences.handleToggleGenericToolOutputSlash}
      loadOlderMessages={(sessionID, cursor) =>
        run(() => props.model.authoritative.loadOlderViewSessionMessages(sessionID, cursor))
      }
      collapseMessageWindow={(sessionID) => props.model.authoritative.collapseViewSessionMessageWindow(sessionID)}
      onMessageAction={(action, context) => run(() => props.model.sessionSlash.messageAction(action, context))}
    />
  )
}

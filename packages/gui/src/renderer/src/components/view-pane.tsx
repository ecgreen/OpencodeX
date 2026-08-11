import type { Agent, Config, FileNode, LspStatus, McpStatus, McpResource, OpencodeXSwarm, PermissionRequest, Provider, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiPromptInfo } from "../lib/prompt-state"
import type { SessionMessageActionContext, SessionMessageActionKind } from "../lib/message-actions"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { PromptDelivery, SessionData } from "../lib/session-api"
import type { QueuedSessionPrompt } from "../controllers/session-state"
import type { ViewPaneRuntimeState } from "../lib/view-pane-state"
import type { SessionSidePanelTarget } from "./session-side-panel"
import { SessionPage } from "./session-page"

export function ViewPane(props: {
  session: Session
  projectName?: string
  pending?: boolean
  focused: () => boolean
  composerFocusToken: () => number
  data: SessionData
  loading: boolean
  status: string
  promptPending?: boolean
  abortConfirmArmed?: boolean
  composerState: ViewPaneRuntimeState
  updateComposerState: (update: (state: ViewPaneRuntimeState) => ViewPaneRuntimeState) => void
  providers: Provider[]
  connectedProviderIDs?: string[]
  connectProvider?: (providerID?: string) => void
  swarms?: OpencodeXSwarm[]
  mcp: Record<string, McpStatus>
  mcpResources?: Record<string, McpResource>
  lsp: LspStatus[]
  config?: Config
  agents: Agent[]
  findFiles?: (input: { query: string; directory?: string; signal?: AbortSignal }) => Promise<FileNode[]>
  recentModels: string[]
  selectedAgent: string
  setSelectedAgent: (value: string) => void
  selectedModel: string
  setSelectedModel: (value: string) => void
  selectedVariant: string
  setSelectedVariant: (value: string) => void
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  focus: (focusComposer: boolean) => void
  openSidePanelTarget?: (target: SessionSidePanelTarget) => void
  submit: (prompt: GuiPromptInfo, options?: { delivery?: PromptDelivery; agent?: string; model?: string; variant?: string }) => Promise<boolean>
  queuedPrompts?: QueuedSessionPrompt[]
  queuePrompt?: (prompt: Omit<QueuedSessionPrompt, "id">) => void
  updateQueuedPrompt?: (sessionID: string, id: string, value: string) => void
  removeQueuedPrompt?: (sessionID: string, id: string) => void
  replyPermission: (request: PermissionRequest, reply: "once" | "always" | "reject") => void
  replyQuestion: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  rejectQuestion: (request: QuestionRequest) => void
  renameSession: (session: Session) => void
  moveSession: (session: Session) => void
  deleteSession: (session: Session) => void
  slashCommands: SessionSlashCommand[]
  concealCodeBlocks?: boolean
  showTimestamps: boolean
  showThinking: boolean
  showToolDetails: boolean
  showScrollbar: boolean
  showGenericToolOutput: boolean
  toggleTimestamps: () => void
  toggleThinking: () => void
  toggleToolDetails: () => void
  toggleScrollbar: () => void
  toggleGenericToolOutput: () => void
  toggleCodeConceal?: () => void
  loadOlderMessages: (cursor: string) => Promise<void>
  collapseMessageWindow: () => void
  onMessageAction?: (action: SessionMessageActionKind, context: SessionMessageActionContext) => void | Promise<void>
}) {
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    props.focus(shouldAutoFocusViewComposer(event))
  }
  return (
    <article class="view-pane" classList={{ focused: props.focused() }} onPointerDown={handlePointerDown}>
      <SessionPage
        session={props.session}
        projectName={props.projectName}
        data={props.data}
        loading={props.loading}
        prompt=""
        setPrompt={() => undefined}
        providers={props.providers}
        connectedProviderIDs={props.connectedProviderIDs}
        connectProvider={props.connectProvider}
        swarms={props.swarms}
        mcp={props.mcp}
        mcpResources={props.mcpResources}
        lsp={props.lsp}
        config={props.config}
        agents={props.agents}
        findFiles={props.findFiles}
        selectedAgent={props.selectedAgent}
        setSelectedAgent={props.setSelectedAgent}
        selectedModel={props.selectedModel}
        recentModels={props.recentModels}
        setSelectedModel={props.setSelectedModel}
        selectedVariant={props.selectedVariant}
        setSelectedVariant={props.setSelectedVariant}
        submit={props.submit}
        queuedPrompts={props.queuedPrompts}
        queuePrompt={props.queuePrompt}
        updateQueuedPrompt={props.updateQueuedPrompt}
        removeQueuedPrompt={props.removeQueuedPrompt}
        permissions={props.permissions}
        questions={props.questions}
        replyPermission={props.replyPermission}
        replyQuestion={props.replyQuestion}
        rejectQuestion={props.rejectQuestion}
        renameSession={props.renameSession}
        moveSession={props.moveSession}
        deleteSession={props.deleteSession}
        slashCommands={props.slashCommands}
        concealCodeBlocks={props.concealCodeBlocks}
        showTimestamps={props.showTimestamps}
        showThinking={props.showThinking}
        showToolDetails={props.showToolDetails}
        showScrollbar={props.showScrollbar}
        showGenericToolOutput={props.showGenericToolOutput}
        toggleTimestamps={props.toggleTimestamps}
        toggleThinking={props.toggleThinking}
        toggleToolDetails={props.toggleToolDetails}
        toggleScrollbar={props.toggleScrollbar}
        toggleGenericToolOutput={props.toggleGenericToolOutput}
        toggleCodeConceal={props.toggleCodeConceal}
        status={props.status}
        promptPending={props.promptPending}
        abortConfirmArmed={props.abortConfirmArmed}
        pending={props.pending}
        composerState={props.composerState}
        updateComposerState={props.updateComposerState}
        composerFocusToken={props.composerFocusToken}
        sidePanelEnabled={false}
        openSidePanelTarget={props.openSidePanelTarget}
        loadOlderMessages={props.loadOlderMessages}
        collapseMessageWindow={props.collapseMessageWindow}
        onMessageAction={props.onMessageAction}
      />
    </article>
  )
}

function shouldAutoFocusViewComposer(event: PointerEvent) {
  const target = event.target
  if (!(target instanceof Element)) return true
  return !target.closest("button, input, textarea, select, a, summary, [contenteditable='true'], [role='button'], [role='option']")
}

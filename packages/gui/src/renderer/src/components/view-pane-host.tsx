import type { Agent, FileNode, OpencodeXSwarm, PermissionRequest, Provider, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiPromptInfo } from "../lib/prompt-state"
import type { SessionMessageActionContext, SessionMessageActionKind } from "../lib/message-actions"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { GuiSnapshot, PromptDelivery, SessionData } from "../lib/session-api"
import type { QueuedSessionPrompt } from "../controllers/session-state"
import type { ViewPaneRuntimeState } from "../lib/view-pane-state"
import type { SessionSidePanelTarget } from "./session-side-panel"
import { viewItemID, viewItemSession, type ViewItem } from "../lib/view-items"
import { ViewPane } from "./view-pane"

export function ViewPaneHost(props: {
  item: Exclude<ViewItem, { kind: "terminal" }>
  projectName?: string
  data: SessionData
  loading: boolean
  status: string
  promptPending?: boolean
  abortConfirmArmed?: boolean
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  composerState: ViewPaneRuntimeState
  updateComposerState: (update: (state: ViewPaneRuntimeState) => ViewPaneRuntimeState) => void
  focusedSessionID: string
  composerFocusRequest: { sessionID: string; token: number }
  recentModels: string[]
  selectedAgent: string
  selectedModel: string
  selectedVariant: string
  providers: Provider[]
  connectedProviderIDs?: string[]
  connectProvider?: (providerID?: string) => void
  swarms?: OpencodeXSwarm[]
  mcp?: GuiSnapshot["mcp"]
  mcpResources?: GuiSnapshot["mcpResources"]
  lsp?: GuiSnapshot["lsp"]
  config?: GuiSnapshot["config"]
  agents: Agent[]
  findFiles?: (input: { query: string; directory?: string; signal?: AbortSignal }) => Promise<FileNode[]>
  setSelectedAgent: (sessionID: string, value: string) => void
  setSelectedModel: (sessionID: string, value: string) => void
  setSelectedVariant: (sessionID: string, value: string) => void
  focus: (sessionID: string, focusComposer: boolean) => void
  openSidePanelTarget?: (sessionID: string, target: SessionSidePanelTarget) => void
  submit: (item: ViewItem, prompt: GuiPromptInfo, options?: { delivery?: PromptDelivery; agent?: string; model?: string; variant?: string }) => Promise<boolean>
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
  signInToClaude?: () => void
  /** True once the sign-in controller has confirmed a fresh, working credential. */
  claudeSignInConfirmed?: boolean
  slashCommands: SessionSlashCommand[]
  concealCodeBlocks?: boolean
  showTimestamps: boolean
  showThinking: boolean
  showToolDetails: boolean
  showScrollbar: boolean
  showGenericToolOutput: boolean
  toggleCodeConceal?: () => void
  toggleTimestamps: () => void
  toggleThinking: () => void
  toggleToolDetails: () => void
  toggleScrollbar: () => void
  toggleGenericToolOutput: () => void
  loadOlderMessages: (sessionID: string, cursor: string) => Promise<void>
  collapseMessageWindow: (sessionID: string) => void
  onMessageAction?: (action: SessionMessageActionKind, context: SessionMessageActionContext) => void | Promise<void>
}) {
  const session = () => viewItemSession(props.item)
  const id = () => viewItemID(props.item)
  return (
      <ViewPane
        session={session()}
        projectName={props.projectName}
        pending={props.item.kind === "pending"}
      focused={() => props.focusedSessionID === id()}
      composerFocusToken={() => props.composerFocusRequest.sessionID === id() ? props.composerFocusRequest.token : 0}
      data={props.data}
      loading={props.loading}
      status={props.status}
      promptPending={props.promptPending}
      abortConfirmArmed={props.abortConfirmArmed}
      composerState={props.composerState}
      updateComposerState={props.updateComposerState}
      providers={props.providers}
      connectedProviderIDs={props.connectedProviderIDs}
      connectProvider={props.connectProvider}
      swarms={props.swarms}
      mcp={props.mcp ?? {}}
      mcpResources={props.mcpResources}
      lsp={props.lsp ?? []}
      config={props.config}
      agents={props.agents}
      findFiles={props.findFiles}
      recentModels={props.recentModels}
      selectedAgent={props.selectedAgent}
      setSelectedAgent={(value) => props.setSelectedAgent(id(), value)}
      selectedModel={props.selectedModel}
      setSelectedModel={(value) => props.setSelectedModel(id(), value)}
      selectedVariant={props.selectedVariant}
      setSelectedVariant={(value) => props.setSelectedVariant(id(), value)}
      permissions={props.permissions}
      questions={props.questions}
      focus={(focusComposer) => props.focus(id(), focusComposer)}
      openSidePanelTarget={(target) => props.openSidePanelTarget?.(id(), target)}
      submit={(text, options) => props.submit(props.item, text, options)}
      queuedPrompts={props.queuedPrompts}
      queuePrompt={props.queuePrompt}
      updateQueuedPrompt={props.updateQueuedPrompt}
      removeQueuedPrompt={props.removeQueuedPrompt}
      replyPermission={props.replyPermission}
      replyQuestion={props.replyQuestion}
      rejectQuestion={props.rejectQuestion}
      renameSession={props.renameSession}
      moveSession={props.moveSession}
      deleteSession={props.deleteSession}
      signInToClaude={props.signInToClaude}
      claudeSignInConfirmed={props.claudeSignInConfirmed}
      slashCommands={props.slashCommands}
      concealCodeBlocks={props.concealCodeBlocks}
      showTimestamps={props.showTimestamps}
      showThinking={props.showThinking}
      showToolDetails={props.showToolDetails}
      showScrollbar={props.showScrollbar}
      showGenericToolOutput={props.showGenericToolOutput}
      toggleCodeConceal={props.toggleCodeConceal}
      toggleTimestamps={props.toggleTimestamps}
      toggleThinking={props.toggleThinking}
      toggleToolDetails={props.toggleToolDetails}
      toggleScrollbar={props.toggleScrollbar}
      toggleGenericToolOutput={props.toggleGenericToolOutput}
      loadOlderMessages={(cursor) => props.loadOlderMessages(id(), cursor)}
      collapseMessageWindow={() => props.collapseMessageWindow(id())}
      onMessageAction={props.onMessageAction}
    />
  )
}

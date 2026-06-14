import type { Agent, Config, FileNode, LspStatus, McpStatus, McpResource, PermissionRequest, Provider, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import type { GuiPromptInfo } from "../lib/prompt-state"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { SessionData } from "../lib/store"
import type { ViewPaneRuntimeState } from "../lib/view-pane-state"
import { SessionPage } from "./session-page"

export function ViewPane(props: {
  session: Session
  pending?: boolean
  focused: () => boolean
  composerFocusToken: () => number
  data: SessionData
  loading: boolean
  status: string
  composerState: ViewPaneRuntimeState
  updateComposerState: (update: (state: ViewPaneRuntimeState) => ViewPaneRuntimeState) => void
  providers: Provider[]
  mcp: Record<string, McpStatus>
  mcpResources?: Record<string, McpResource>
  lsp: LspStatus[]
  config?: Config
  agents: Agent[]
  findFiles?: (input: { query: string; directory?: string }) => Promise<FileNode[]>
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
  submit: (event: SubmitEvent, prompt: GuiPromptInfo) => void
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
  loadOlderMessages: (cursor: string) => Promise<void>
}) {
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || props.focused()) return
    props.focus(shouldAutoFocusViewComposer(event))
  }
  return (
    <article class="view-pane" classList={{ focused: props.focused() }} onPointerDown={handlePointerDown}>
      <SessionPage
        session={props.session}
        data={props.data}
        loading={props.loading}
        prompt=""
        setPrompt={() => undefined}
        providers={props.providers}
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
        permissions={props.permissions}
        questions={props.questions}
        replyPermission={props.replyPermission}
        replyQuestion={props.replyQuestion}
        rejectQuestion={props.rejectQuestion}
        abortSession={props.abortSession}
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
        toggleCodeConceal={props.toggleCodeConceal}
        toggleTimestamps={props.toggleTimestamps}
        toggleThinking={props.toggleThinking}
        toggleToolDetails={props.toggleToolDetails}
        toggleScrollbar={props.toggleScrollbar}
        toggleGenericToolOutput={props.toggleGenericToolOutput}
        status={props.status}
        pending={props.pending}
        composerState={props.composerState}
        updateComposerState={props.updateComposerState}
        composerFocusToken={props.composerFocusToken}
        loadOlderMessages={props.loadOlderMessages}
      />
    </article>
  )
}

function shouldAutoFocusViewComposer(event: PointerEvent) {
  const target = event.target
  if (!(target instanceof Element)) return true
  return !target.closest("button, input, textarea, select, a, summary, [contenteditable='true'], [role='button'], [role='option']")
}

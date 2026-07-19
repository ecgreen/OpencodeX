import type { Agent, Config, FileNode, LspStatus, McpResource, McpStatus, PermissionRequest, Provider, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import type { SessionMessageActionContext, SessionMessageActionKind } from "../lib/message-actions"
import type { GuiPromptInfo } from "../lib/prompt-state"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { SessionData } from "../lib/store"
import type { GuiClient } from "../lib/client"
import type { ViewPaneRuntimeState } from "../lib/view-pane-state"
import type { SessionSidePanelTarget } from "./session-side-panel"

export type SessionPageProps = {
  session?: Session
  projectName?: string
  data: SessionData
  loading: boolean
  prompt: string
  setPrompt: (value: string) => void
  providers: Provider[]
  connectedProviderIDs?: string[]
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
  toggleCodeConceal?: () => void
  toggleTimestamps: () => void
  toggleThinking: () => void
  toggleToolDetails: () => void
  toggleScrollbar: () => void
  toggleGenericToolOutput: () => void
  status?: string
  abortConfirmArmed?: boolean
  readyForReview?: boolean
  markSessionReviewed?: (session: Session) => void
  pending?: boolean
  composerState?: ViewPaneRuntimeState
  updateComposerState?: (update: (state: ViewPaneRuntimeState) => ViewPaneRuntimeState) => void
  composerFocusToken?: () => number
  loadOlderMessages?: (cursor: string) => Promise<void>
  onMessageAction?: (action: SessionMessageActionKind, context: SessionMessageActionContext) => void | Promise<void>
  gui?: GuiClient
  sidePanelDirectory?: string
  sidePanelEnabled?: boolean
  openSidePanelTarget?: (target: SessionSidePanelTarget) => void
}

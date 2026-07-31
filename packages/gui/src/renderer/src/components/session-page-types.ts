import type { Agent, Config, FileNode, GlobalEvent, LspStatus, McpResource, McpStatus, OpencodeXSwarm, PermissionRequest, Provider, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import type { SessionMessageActionContext, SessionMessageActionKind } from "../lib/message-actions"
import type { GuiPromptInfo } from "../lib/prompt-state"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { SessionData } from "../lib/session-api"
import type { GuiClient } from "../lib/client"
import type { SessionGraph, SessionGraphNode } from "../lib/session-graph"
import type { SwarmTeamView } from "../lib/swarm-team"
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
  /** Swarm catalog, used to enrich the model picker's Swarms section. */
  swarms?: OpencodeXSwarm[]
  /** Team view for sessions running on a swarm model. */
  team?: SwarmTeamView
  /** Child session the reader has toggled into, "" for the orchestrator. */
  teamMemberSessionID?: string
  selectTeamMember?: (sessionID: string) => void
  teamMemberData?: SessionData
  teamMemberLoading?: boolean
  /** Pages an embedded pane back through its own history, so the delegation
   * prompt at the top of a long specialist run stays reachable. */
  loadOlderEmbeddedMessages?: (sessionID: string, cursor: string) => Promise<void>
  /** The session's workflow graph, for the canvas and the opened-node header. */
  graph?: SessionGraph
  /** Opens the workspace Graph tab; offered from the toolbar for any session. */
  openGraphTab?: () => void
  /** Child session opened from a graph node, "" for the top session. */
  graphNodeSessionID?: string
  graphNodeData?: SessionData
  graphNodeLoading?: boolean
  openGraphNode?: (node: SessionGraphNode) => void
  openGraphNodeFullPage?: (node: SessionGraphNode) => void
  closeGraphNode?: () => void
  /** Opens the credential flow, optionally pre-selecting a provider. */
  connectProvider?: (providerID?: string) => void
  mcp: Record<string, McpStatus>
  mcpResources?: Record<string, McpResource>
  lsp: LspStatus[]
  config?: Config
  agents: Agent[]
  findFiles?: (input: { query: string; directory?: string; signal?: AbortSignal }) => Promise<FileNode[]>
  selectedAgent: string
  setSelectedAgent: (value: string) => void
  selectedModel: string
  recentModels: string[]
  setSelectedModel: (value: string) => void
  selectedVariant: string
  setSelectedVariant: (value: string) => void
  submit: (event: SubmitEvent, prompt: GuiPromptInfo) => Promise<boolean>
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  replyPermission: (request: PermissionRequest, reply: "once" | "always" | "reject") => void
  replyQuestion: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  rejectQuestion: (request: QuestionRequest) => void
  renameSession: (session: Session) => void
  moveSession: (session: Session) => void
  deleteSession: (session: Session) => void
  /** Opens the raw Claude Code terminal page, used for sign-in recovery. */
  openTerminalSession?: (terminalSessionID: string) => void
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
  collapseMessageWindow?: () => void
  onMessageAction?: (action: SessionMessageActionKind, context: SessionMessageActionContext) => void | Promise<void>
  gui?: GuiClient
  subscribeGlobalEvents?: (listener: (event: GlobalEvent) => void | Promise<void>) => () => void
  sidePanelDirectory?: string
  sidePanelEnabled?: boolean
  openSidePanelTarget?: (target: SessionSidePanelTarget) => void
}

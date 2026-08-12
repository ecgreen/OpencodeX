import type { Agent, Config, FileNode, GlobalEvent, LspStatus, McpResource, McpStatus, OpencodeXGoal, OpencodeXJob, OpencodeXSwarm, PermissionRequest, Provider, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import type { SessionMessageActionContext, SessionMessageActionKind } from "../lib/message-actions"
import type { GuiPromptInfo } from "../lib/prompt-state"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import type { SessionData } from "../lib/session-api"
import type { GuiClient } from "../lib/client"
import type { SessionGraph, SessionGraphNode } from "../lib/session-graph"
import type { GraphTopologyState } from "../lib/session-graph-fetch"
import type { WorkItem } from "@opencode-ai/sdk/v2/work-item"
import type { SwarmTeamView } from "../lib/swarm-team"
import type { ViewPaneRuntimeState } from "../lib/view-pane-state"
import type { SessionSidePanelTarget } from "./session-side-panel"
import type { QueuedSessionPrompt } from "../controllers/session-state"
import type { PromptDelivery } from "../lib/session-api"

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
  /** The goal graph this session owns, when a planner authored one. */
  goal?: OpencodeXGoal
  approveGoalNode?: (goalID: string, nodeID: string, approved: boolean) => void
  cancelGoal?: (goalID: string) => void
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
  /** Completeness of the graph's delegation tree: loading, stale, truncated. */
  graphTopology?: GraphTopologyState
  retryGraphTopology?: () => void
  /** The activated graph node - selectable even without a transcript. */
  graphSelectedNodeID?: string
  /** Child session opened from a graph node, "" for the top session. */
  graphNodeSessionID?: string
  graphNodeData?: SessionData
  graphNodeLoading?: boolean
  /** The selected node's work item, for the supervision inspector. */
  graphNodeWorkItem?: WorkItem
  /** The opened node's session record - the fallback source for hidden children. */
  graphNodeSession?: Session
  /** The opened node's jobs, for attempt counts and failure history. */
  graphNodeJobs?: readonly OpencodeXJob[]
  openGraphNode?: (node: SessionGraphNode) => void
  openGraphNodeFullPage?: (node: SessionGraphNode) => void
  /**
   * One capability check for every full-page entry point - the embedded
   * header's button and the canvas's Ctrl/Cmd-click. False for steps the
   * catalog does not carry, which have no full-page route.
   */
  canOpenGraphNodeFullPage?: (sessionID: string) => boolean
  /** Why an embedded pane's transcript failed to load, if it did. */
  embeddedSessionError?: (sessionID: string) => string | undefined
  retryEmbeddedSession?: (sessionID: string) => void
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
  submit: (
    prompt: GuiPromptInfo,
    options?: { delivery?: PromptDelivery; agent?: string; model?: string; variant?: string },
  ) => Promise<boolean>
  queuedPrompts?: QueuedSessionPrompt[]
  queuePrompt?: (prompt: Omit<QueuedSessionPrompt, "id">) => void
  updateQueuedPrompt?: (sessionID: string, id: string, value: string) => void
  removeQueuedPrompt?: (sessionID: string, id: string) => void
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
  /**
   * The optimistic `sessionPendingPrompt` marker: a prompt left this client but
   * the backend has not reported `busy` yet. Running-state consumers (queue
   * drain, delivery buttons) must treat it as running, mirroring the canonical
   * `isClientSessionWorking`, or the queue drains into a starting run.
   */
  promptPending?: boolean
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

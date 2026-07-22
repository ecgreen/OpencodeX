import type {
  Agent,
  Command,
  Config,
  Event,
  FormatterStatus,
  LspStatus,
  McpResource,
  McpStatus,
  Message,
  OpencodeClient,
  OpencodeXCatalogProject,
  OpencodeXCatalogView,
  OpencodeXJob,
  OpencodeXOperationsSnapshot,
  OpencodeXPlugin,
  OpencodeXSessionSnapshot,
  OpencodeXSessionCardPage,
  OpencodeXSessionUiState,
  OpencodeXStateScope,
  OpencodeXStateSnapshot,
  OpencodeXSwarm,
  Part,
  PermissionRequest,
  Provider,
  QuestionRequest,
  Session,
  SessionStatus,
} from "./client.js"

export type ClientEntityState<T> = {
  ids: string[]
  records: Record<string, T>
}

export type ClientSessionDetailState = {
  revision: number
  snapshot: OpencodeXSessionSnapshot
  messageIDs: string[]
  messageCoverage: Record<string, "older" | "tail">
  messages: Record<string, Message>
  partIDs: Record<string, string[]>
  parts: Record<string, Part>
  livePartText?: Record<string, { base: string; text: string }>
}

export type ClientStateSyncLifecycle = {
  status: "idle" | "bootstrapping" | "connected" | "reconnecting" | "resetting" | "error"
  data: "empty" | "current" | "stale"
  attempt: number
  retryAt?: number
  connectedAt?: number
  error?: string
}

export type ClientSessionLoadState = {
  initial: "idle" | "loading" | "ready" | "error"
  older: "idle" | "loading" | "error"
  error?: string
}

export type ClientSessionTailOptions = {
  limit?: number
  signal?: AbortSignal
}

export type ClientSessionPageOptions = {
  limit?: number
  before?: string
  signal?: AbortSignal
}

export type ClientSessionPageResult = OpencodeXSessionSnapshot

export type ClientSessionCardPageState = {
  next?: string
  hasMore: boolean
  pages: number
  loading: boolean
  error?: string
}

export type ClientSessionCardPageOptions = {
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

export type ClientEnsureSessionCardsOptions = {
  signal?: AbortSignal
}

export type ClientCatalogProject = OpencodeXCatalogProject & { sessions: Session[] }
export type ClientCatalogView = OpencodeXCatalogView & { sessions: Session[] }

export type ClientCatalogSnapshot = {
  projects: ClientCatalogProject[]
  sessions: Session[]
  views: ClientCatalogView[]
  sessionStatus: Record<string, SessionStatus>
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  sessionUiState: Record<string, OpencodeXSessionUiState>
}

export type ClientCapabilitiesSnapshot = {
  scope: OpencodeXStateScope
  epoch: string
  revision: string
  providers: Provider[]
  connectedProviderIDs: string[]
  providerDefaults: Record<string, string>
  agents: Agent[]
  commands: Command[]
  lsp: LspStatus[]
  mcp: Record<string, McpStatus>
  config: Config
  mcpResources: Record<string, McpResource>
  plugins: OpencodeXPlugin[]
  formatter: FormatterStatus[]
}

export type ClientStateSyncState = {
  phase: "idle" | "bootstrapping" | "ready" | "resetting" | "error"
  lifecycle: ClientStateSyncLifecycle
  scope?: OpencodeXStateScope
  epoch?: string
  cursor?: string
  position?: number
  digest?: string
  projects: ClientEntityState<OpencodeXCatalogProject>
  sessions: ClientEntityState<Session>
  views: ClientEntityState<OpencodeXCatalogView>
  sessionCards: ClientSessionCardPageState
  permissions: ClientEntityState<PermissionRequest>
  questions: ClientEntityState<QuestionRequest>
  jobs: ClientEntityState<OpencodeXJob>
  swarms: ClientEntityState<OpencodeXSwarm>
  sessionStatus: Record<string, SessionStatus>
  sessionUiState: Record<string, OpencodeXSessionUiState>
  sessionDetails: Record<string, ClientSessionDetailState>
  sessionLoads: Record<string, ClientSessionLoadState>
  capabilities?: ClientCapabilitiesSnapshot
  dirtyCatalog: boolean
  dirtyOperations: boolean
  dirtyCapabilities: boolean
  dirtySessions: Record<string, true>
  tombstones: {
    sessions: Record<string, true>
    messages: Record<string, true>
    parts: Record<string, true>
    messageSessions: Record<string, string>
    partSessions: Record<string, string>
  }
  aggregateSequences: Record<string, number>
  pendingMutations: Record<string, { status: "pending" | "failed"; error?: string }>
  error?: string
}

export type ClientStateSyncTransport = {
  snapshot: () => Promise<OpencodeXStateSnapshot>
  operations?: () => Promise<OpencodeXOperationsSnapshot>
  cards?: (input: {
    cursor?: string
    limit?: number
    sessionIDs?: string[]
    signal: AbortSignal
  }) => Promise<OpencodeXSessionCardPage>
  session: (input: {
    sessionID: string
    limit?: number
    before?: string
    signal: AbortSignal
  }) => Promise<OpencodeXSessionSnapshot>
  events: (input: { after?: string; signal: AbortSignal }) => Promise<AsyncIterable<unknown>>
  capabilities?: () => Promise<ClientCapabilitiesSnapshot>
}

export type ClientStateSyncMetrics = {
  commits: number
  rootSnapshots: number
  operationsSnapshots: number
  sessionSnapshots: number
  sessionCardPages: number
  sessionCardResolutions: number
  streamConnections: number
  streamFrames: number
  batches: number
  reconnects: number
  resets: number
  liveEvents: number
  liveEventDuplicates: number
  sessionInvalidations: number
  sessionCorrectionsCoalesced: number
  capabilitySnapshots: number
  capabilityRefreshesCoalesced: number
  operationsRefreshesCoalesced: number
  retryActions: number
  retainedSessionDetails: number
  retainedSessionLoads: number
  sessionTailOptions: number
  activeSessionRequests: number
  activeCardRequests: number
  sessionRefreshTimers: number
  bufferedSessionEvents: number
  queuedFrames: number
}

export type ClientStateSyncController = {
  getState: () => ClientStateSyncState
  getMetrics: () => ClientStateSyncMetrics
  subscribe: (listener: (state: ClientStateSyncState) => void) => () => void
  start: () => Promise<void>
  stop: () => void
  refresh: () => Promise<void>
  refreshOperations: () => Promise<void>
  refreshCapabilities: () => Promise<void>
  loadSessionCards: (input?: ClientSessionCardPageOptions) => Promise<OpencodeXSessionCardPage>
  ensureSessionCards: (
    sessionIDs: readonly string[],
    input?: ClientEnsureSessionCardsOptions,
  ) => Promise<OpencodeXSessionCardPage | undefined>
  refreshSessionTail: (sessionID: string, input?: ClientSessionTailOptions) => Promise<OpencodeXSessionSnapshot>
  loadOlderSessionPage: (
    sessionID: string,
    input: ClientSessionPageOptions & { before: string },
  ) => Promise<ClientSessionPageResult>
  fetchSessionPage: (sessionID: string, input?: ClientSessionPageOptions) => Promise<ClientSessionPageResult>
  releaseSession: (sessionID: string) => void
  retry: () => Promise<void>
  applyEvents: (events: readonly Event[]) => boolean[]
  applyEvent: (event: Event) => boolean
  runMutation: <T>(key: string, mutation: () => Promise<T>) => Promise<T>
}

export type ClientStateSyncOptions = {
  client?: OpencodeClient
  transport?: ClientStateSyncTransport
  directory?: string
  workspace?: string
  batchMs?: number
  reconnectDelayMs?: number
  reconnectMaxDelayMs?: number
  reconnectJitter?: () => number
  clock?: () => number
  sessionRefreshDelayMs?: number
  pollIntervalMs?: number
}

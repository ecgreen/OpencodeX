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
  OpencodeXJob,
  OpencodeXOperationsSnapshot,
  OpencodeXPlugin,
  OpencodeXProject,
  OpencodeXSessionSnapshot,
  OpencodeXSessionSyncSnapshot,
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

export type ClientCapabilitiesSnapshot = {
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
  digest?: string
  projects: ClientEntityState<OpencodeXProject>
  sessions: ClientEntityState<Session>
  views: ClientEntityState<OpencodeXSessionSyncSnapshot["views"][number]>
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
  }
  aggregateSequences: Record<string, number>
  pendingMutations: Record<string, { status: "pending" | "failed"; error?: string }>
  error?: string
}

export type ClientStateSyncTransport = {
  snapshot: () => Promise<OpencodeXStateSnapshot>
  operations?: () => Promise<OpencodeXOperationsSnapshot>
  session: (input: { sessionID: string; limit?: number; before?: string }) => Promise<OpencodeXSessionSnapshot>
  events: (input: { after?: string; signal: AbortSignal }) => Promise<AsyncIterable<unknown>>
  capabilities?: () => Promise<ClientCapabilitiesSnapshot>
}

export type ClientStateSyncMetrics = {
  commits: number
  rootSnapshots: number
  operationsSnapshots: number
  sessionSnapshots: number
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
  hydrateSession: (sessionID: string, input?: { limit?: number; before?: string }) => Promise<void>
  retry: () => Promise<void>
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
}

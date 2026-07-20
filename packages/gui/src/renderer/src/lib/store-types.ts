import type {
  Agent,
  Command,
  Config,
  LspStatus,
  McpStatus,
  Message,
  OpencodeXJob,
  OpencodeXSessionUiState,
  OpencodeXSwarm,
  Part,
  PermissionRequest,
  Provider,
  QuestionRequest,
  SnapshotFileDiff,
  Session,
  SessionStatus,
  Todo,
  TextPartInput,
  FilePartInput,
  AgentPartInput,
  McpResource,
  VcsFileDiff,
  OpencodexWorkbenchChangesPageResponse,
  OpencodexWorkbenchChangesMetricsPageResponse,
  OpencodexWorkbenchChangesPatchPageResponse,
  OpencodexWorkbenchChangesPatchResponse,
} from "@opencode-ai/sdk/v2/client"
import type { ClientCatalogProject, ClientCatalogView } from "@opencode-ai/sdk/v2/client-sync"

export type MessageBundle = {
  info: Message
  parts: Part[]
}

export type SessionData = {
  messages: MessageBundle[]
  messageCursor?: string
  messageWindowExpanded?: boolean
  todos: Todo[]
  diffs: SnapshotFileDiff[]
}

export type PromptPart = TextPartInput | FilePartInput | AgentPartInput

export type DiffFile = SnapshotFileDiff | VcsFileDiff

export type GuiPlugin = {
  id: string
  pluginID: string
  kind: "server" | "tui"
  spec: string
  source: string
  scope: "global" | "local" | "internal"
  enabled: boolean
  active: boolean
  canToggle: boolean
  target?: string
  note?: string
}

export type GuiPluginInstallResult = {
  ok: boolean
  message?: string
  dir?: string
  tui: boolean
  server: boolean
  items: Array<{ kind: "server" | "tui"; mode: "noop" | "add" | "replace"; file: string }>
}

export type WorkbenchOperationResult = {
  ok: boolean
  reason?: string
  message?: string
  content?: string
}

export type WorkbenchFileReadResult = WorkbenchOperationResult & {
  bytes?: number
  truncated?: boolean
}

export type WorkbenchGitBranches = {
  ok: boolean
  message?: string
  current?: string
  branches: string[]
}

export type WorkbenchChangesPage = OpencodexWorkbenchChangesPageResponse
export type WorkbenchChangeNode = WorkbenchChangesPage["items"][number]
export type WorkbenchChangeFile = Extract<WorkbenchChangeNode, { type: "file" }>
export type WorkbenchChangePatch = OpencodexWorkbenchChangesPatchResponse
export type WorkbenchChangeMetricsPage = OpencodexWorkbenchChangesMetricsPageResponse
export type WorkbenchChangePatchPage = OpencodexWorkbenchChangesPatchPageResponse

export type WorkbenchGitHistoryFile = {
  path: string
  status: string
  previousPath?: string
}

export type WorkbenchGitHistoryCommit = {
  hash: string
  shortHash: string
  author: string
  email?: string
  date: string
  subject: string
  body?: string
  files: WorkbenchGitHistoryFile[]
}

export type WorkbenchDiagnostic = {
  path?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  severity: "error" | "warning" | "info"
  message: string
}

export type WorkbenchFileDiagnosticsResult = {
  ok: boolean
  supported: boolean
  reason?: string
  message?: string
  diagnostics: WorkbenchDiagnostic[]
}

export type WorkbenchDefinitionLocation = {
  path: string
  root?: string
  readOnly?: true
  line: number
  column: number
  endLine: number
  endColumn: number
}

export type WorkbenchHoverResult = {
  supported: boolean
  message?: string
  contents: Array<{
    kind: "code" | "markdown" | "plaintext"
    value: string
    language?: string
  }>
  definitions: WorkbenchDefinitionLocation[]
  range?: {
    line: number
    column: number
    endLine: number
    endColumn: number
  }
}

export type WorkbenchCompletionItem = {
  label: string
  detail?: string
  documentation?: string
  insertText?: string
  filterText?: string
  sortText?: string
  kind?: number
  insertTextFormat?: number
}

export type WorkbenchCompletionResult = {
  supported: boolean
  message?: string
  items: WorkbenchCompletionItem[]
}

export type WorkbenchDiagnosticsResult = {
  ok: boolean
  command?: string
  message?: string
  output?: string
  diagnostics: WorkbenchDiagnostic[]
}

export type WorkbenchGitStash = {
  ref: string
  hash?: string
  age?: string
  message?: string
}

export type WorkbenchDataResult<T = unknown> = {
  ok: boolean
  message?: string
  data?: T
}

export type SessionLoadOptions = {
  messageLimit?: number
  messageRenderBudget?: number
  messageBefore?: string
  includeSideData?: boolean
}

export type GuiSnapshot = {
  projects: ClientCatalogProject[]
  sessions: Session[]
  sessionStatus: Record<string, SessionStatus>
  sessionUiState: Record<string, OpencodeXSessionUiState>
  stateRevision?: string
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  providers: Provider[]
  connectedProviderIDs?: string[]
  agents: Agent[]
  commands?: Command[]
  lsp?: LspStatus[]
  mcp?: Record<string, McpStatus>
  config?: Config
  mcpResources?: Record<string, McpResource>
  plugins?: GuiPlugin[]
  swarms: OpencodeXSwarm[]
  jobs: OpencodeXJob[]
  views: ClientCatalogView[]
}

export type SessionCardSnapshot = Pick<
  GuiSnapshot,
  "projects" | "sessions" | "sessionStatus" | "sessionUiState" | "stateRevision" | "permissions" | "questions" | "views"
>

export type GuiCapabilitiesSnapshot = Pick<
  GuiSnapshot,
  "providers" | "connectedProviderIDs" | "agents" | "commands" | "lsp" | "mcp" | "config" | "mcpResources" | "plugins"
>

import type {
  Agent,
  Command,
  Config,
  LspStatus,
  McpStatus,
  Message,
  OpencodeXJob,
  OpencodeXProject,
  OpencodeXSessionUiState,
  OpencodeXSwarm,
  OpencodeXView,
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
} from "@opencode-ai/sdk/v2/client"

export type MessageBundle = {
  info: Message
  parts: Part[]
}

export type SessionData = {
  messages: MessageBundle[]
  messageCursor?: string
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

export type WorkbenchGitFileStatus = {
  path: string
  code: string
  status: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
}

export type WorkbenchGitStatus = {
  ok: boolean
  message?: string
  branch?: string
  defaultBranch?: string
  upstream?: string
  ahead?: number
  behind?: number
  remote?: string
  remoteUrl?: string
  githubUrl?: string
  clean: boolean
  files: WorkbenchGitFileStatus[]
}

export type WorkbenchGitBranches = {
  ok: boolean
  message?: string
  current?: string
  branches: string[]
}

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
  severity: "error" | "warning" | "info"
  message: string
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
  projects: OpencodeXProject[]
  sessions: Session[]
  sessionStatus: Record<string, SessionStatus>
  sessionUiState: Record<string, OpencodeXSessionUiState>
  sessionSyncRevision?: string
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  providers: Provider[]
  agents: Agent[]
  commands?: Command[]
  lsp?: LspStatus[]
  mcp?: Record<string, McpStatus>
  config?: Config
  mcpResources?: Record<string, McpResource>
  plugins?: GuiPlugin[]
  swarms: OpencodeXSwarm[]
  jobs: OpencodeXJob[]
  views: OpencodeXView[]
}

export type SessionCardSnapshot = Pick<
  GuiSnapshot,
  "projects" | "sessions" | "sessionStatus" | "sessionUiState" | "sessionSyncRevision" | "permissions" | "questions" | "views"
>

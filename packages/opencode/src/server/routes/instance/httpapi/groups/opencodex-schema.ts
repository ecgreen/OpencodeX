import { File } from "@/file"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXProject } from "@/opencodex/project"
import { OpencodeXSessionState } from "@/opencodex/session-state"
import { OpencodeXTerminalSession } from "@/opencodex/terminal-session"
import { OpencodeXView } from "@/opencodex/view"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Schema, Struct } from "effect"
import { WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { QueryBoolean } from "./query"

export const OPENCODEX_ROOT = "/experimental/opencodex"

export const UpdateProjectPayload = Schema.Struct(Struct.omit(OpencodeXProject.UpdateInput.fields, ["projectID"]))
export const UpdateJobPayload = Schema.Struct(Struct.omit(OpencodeXJob.UpdateInput.fields, ["id"]))
export const ClaimJobPayload = Schema.Struct(Struct.omit(OpencodeXJob.ClaimInput.fields, ["jobID"]))
export const CompleteJobPayload = Schema.Struct(Struct.omit(OpencodeXJob.CompleteInput.fields, ["jobID"]))
export const FailJobPayload = Schema.Struct(Struct.omit(OpencodeXJob.FailInput.fields, ["jobID"]))
export const StartJobPayload = Schema.Struct({ owner: Schema.String })
export const ListGoalsQuery = Schema.Struct({
  projectID: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
})
export const ApproveGoalNodePayload = Schema.Struct({ approved: Schema.Boolean })
export const UpdateViewPayload = Schema.Struct(Struct.omit(OpencodeXView.UpdateInput.fields, ["id"]))
export const UpdateTerminalSessionPayload = Schema.Struct(
  Struct.omit(OpencodeXTerminalSession.UpdateInput.fields, ["id"]),
)
export const UpdateSessionStatePayload = Schema.Struct(
  Struct.omit(OpencodeXSessionState.UpdateInput.fields, ["sessionID"]),
)
export const PluginListQuery = Schema.Struct({ ...WorkspaceRoutingQueryFields })
export const WorkbenchFileWritePayload = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
  previousContent: Schema.optional(Schema.String),
})
export const WorkbenchFileReadQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
  root: Schema.optional(Schema.String),
  maxBytes: Schema.optional(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(File.MAX_CONTENT_BYTES),
    ),
  ),
})
export const WorkbenchFileCreatePayload = Schema.Struct({
  path: Schema.String,
  content: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.Boolean),
})
export const WorkbenchFileRenamePayload = Schema.Struct({ from: Schema.String, to: Schema.String })
export const WorkbenchFileDeletePayload = Schema.Struct({ path: Schema.String })
export const WorkbenchFileAnalysisPayload = Schema.Struct({
  path: Schema.String,
  root: Schema.optional(Schema.String),
  content: Schema.String,
})
export const WorkbenchFileDefinitionPayload = Schema.Struct({
  ...WorkbenchFileAnalysisPayload.fields,
  line: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  column: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
})
export const WorkbenchFileCompletionPayload = Schema.Struct({
  ...WorkbenchFileDefinitionPayload.fields,
  triggerKind: Schema.optional(Schema.Literals([1, 2, 3])),
  triggerCharacter: Schema.optional(Schema.String),
})
export const WorkbenchGitPathsPayload = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)),
  all: Schema.optional(Schema.Boolean),
})
export const WorkbenchGitBranchPayload = Schema.Struct({ branch: Schema.String })
export const WorkbenchGitCommitPayload = Schema.Struct({
  message: Schema.String,
  body: Schema.optional(Schema.String),
  paths: Schema.optional(Schema.Array(Schema.String)),
})
export const WorkbenchGitStashCreatePayload = Schema.Struct({ message: Schema.optional(Schema.String) })
export const WorkbenchGitStashPayload = Schema.Struct({ ref: Schema.String })
export const WorkbenchGithubPullPayload = Schema.Struct({ number: Schema.Number })
export const WorkbenchGithubCreatePullPayload = Schema.Struct({
  title: Schema.String,
  body: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
})
export const WorkbenchOperationResult = Schema.Struct({
  ok: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
})
export const WorkbenchFileReadResult = Schema.Struct({
  ...WorkbenchOperationResult.fields,
  bytes: Schema.optional(NonNegativeInt),
  truncated: Schema.optional(Schema.Boolean),
})
export const WorkbenchGitBranches = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.optional(Schema.String),
  current: Schema.optional(Schema.String),
  branches: Schema.Array(Schema.String),
})
export const WorkbenchChangesQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  revision: Schema.optional(Schema.String),
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)),
  ),
})
export const WorkbenchChangePatchQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
  revision: Schema.optional(Schema.String),
  context: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100)),
  ),
  maxBytes: Schema.optional(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(2 * 1024 * 1024),
    ),
  ),
})
export const WorkbenchChangeMetricsQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  revision: Schema.String,
  path: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(32)),
  ),
})
export const WorkbenchChangePatchPageQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
  revision: Schema.String,
  cursor: Schema.optional(Schema.String),
  context: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100)),
  ),
})
export const WorkbenchChangeDirectory = Schema.Struct({
  type: Schema.Literal("directory"),
  name: Schema.String,
  path: Schema.String,
})
export const WorkbenchChangeFile = Schema.Struct({
  type: Schema.Literal("file"),
  name: Schema.String,
  path: Schema.String,
  status: Schema.Literals(["added", "deleted", "modified"]),
  staged: Schema.Boolean,
  unstaged: Schema.Boolean,
  untracked: Schema.Boolean,
  openable: Schema.Boolean,
  additions: Schema.optional(NonNegativeInt),
  deletions: Schema.optional(NonNegativeInt),
  binary: Schema.optional(Schema.Boolean),
})
export const WorkbenchChangeSummary = Schema.Struct({
  fileCount: NonNegativeInt,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  metricsResolved: NonNegativeInt,
  metricsTotal: NonNegativeInt,
  metricsComplete: Schema.Boolean,
})
export const WorkbenchChangesPage = Schema.Struct({
  ok: Schema.Boolean,
  stale: Schema.optional(Schema.Boolean),
  mode: Schema.Literals(["git", "directory"]),
  revision: Schema.String,
  path: Schema.String,
  items: Schema.Array(WorkbenchChangeFile),
  summary: WorkbenchChangeSummary,
  next: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  defaultBranch: Schema.optional(Schema.String),
  upstream: Schema.optional(Schema.String),
  ahead: Schema.optional(NonNegativeInt),
  behind: Schema.optional(NonNegativeInt),
  remoteUrl: Schema.optional(Schema.String),
  githubUrl: Schema.optional(Schema.String),
})
export const WorkbenchChangePatch = Schema.Struct({
  ok: Schema.Boolean,
  stale: Schema.optional(Schema.Boolean),
  path: Schema.String,
  revision: Schema.String,
  status: Schema.Literals(["added", "deleted", "modified"]),
  patch: Schema.optional(Schema.String),
  additions: Schema.optional(NonNegativeInt),
  deletions: Schema.optional(NonNegativeInt),
  binary: Schema.Boolean,
  truncated: Schema.Boolean,
  message: Schema.optional(Schema.String),
})
export const WorkbenchChangeMetric = Schema.Struct({
  path: Schema.String,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  binary: Schema.Boolean,
})
export const WorkbenchChangeMetricsPage = Schema.Struct({
  ok: Schema.Boolean,
  stale: Schema.Boolean,
  revision: Schema.String,
  items: Schema.Array(WorkbenchChangeMetric),
  next: Schema.optional(Schema.String),
  summary: WorkbenchChangeSummary,
  message: Schema.optional(Schema.String),
})
export const WorkbenchChangePatchPage = Schema.Struct({
  ok: Schema.Boolean,
  stale: Schema.Boolean,
  path: Schema.String,
  revision: Schema.String,
  status: Schema.Literals(["added", "deleted", "modified"]),
  patch: Schema.optional(Schema.String),
  additions: Schema.optional(NonNegativeInt),
  deletions: Schema.optional(NonNegativeInt),
  binary: Schema.Boolean,
  complete: Schema.Boolean,
  next: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
})
export const WorkbenchGitHistoryFile = Schema.Struct({
  path: Schema.String,
  status: Schema.String,
  previousPath: Schema.optional(Schema.String),
})
export const WorkbenchGitHistoryCommit = Schema.Struct({
  hash: Schema.String,
  shortHash: Schema.String,
  author: Schema.String,
  email: Schema.optional(Schema.String),
  date: Schema.String,
  subject: Schema.String,
  body: Schema.optional(Schema.String),
  files: Schema.Array(WorkbenchGitHistoryFile),
})
export const WorkbenchDiagnostic = Schema.Struct({
  path: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
  column: Schema.optional(Schema.Number),
  endLine: Schema.optional(Schema.Number),
  endColumn: Schema.optional(Schema.Number),
  severity: Schema.Literals(["error", "warning", "info"]),
  message: Schema.String,
})
export const WorkbenchFileDiagnosticsResult = Schema.Struct({
  ok: Schema.Boolean,
  supported: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  diagnostics: Schema.Array(WorkbenchDiagnostic),
})
export const WorkbenchDefinitionLocation = Schema.Struct({
  path: Schema.String,
  root: Schema.optional(Schema.String),
  readOnly: Schema.optional(Schema.Literal(true)),
  line: Schema.Number,
  column: Schema.Number,
  endLine: Schema.Number,
  endColumn: Schema.Number,
})
export const WorkbenchHoverRange = Schema.Struct({
  line: Schema.Number,
  column: Schema.Number,
  endLine: Schema.Number,
  endColumn: Schema.Number,
})
export const WorkbenchHoverResult = Schema.Struct({
  supported: Schema.Boolean,
  message: Schema.optional(Schema.String),
  contents: Schema.Array(Schema.Struct({
    kind: Schema.Literals(["code", "markdown", "plaintext"]),
    value: Schema.String,
    language: Schema.optional(Schema.String),
  })),
  definitions: Schema.Array(WorkbenchDefinitionLocation),
  range: Schema.optional(WorkbenchHoverRange),
})
export const WorkbenchCompletionItem = Schema.Struct({
  label: Schema.String,
  detail: Schema.optional(Schema.String),
  documentation: Schema.optional(Schema.String),
  insertText: Schema.optional(Schema.String),
  filterText: Schema.optional(Schema.String),
  sortText: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Number),
  insertTextFormat: Schema.optional(Schema.Number),
})
export const WorkbenchCompletionResult = Schema.Struct({
  supported: Schema.Boolean,
  message: Schema.optional(Schema.String),
  items: Schema.Array(WorkbenchCompletionItem),
})
export const WorkbenchDiagnosticsResult = Schema.Struct({
  ok: Schema.Boolean,
  command: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
  diagnostics: Schema.Array(WorkbenchDiagnostic),
})
export const WorkbenchDataResult = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Unknown),
})
export const SessionSyncQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  scope: Schema.optional(Schema.Literals(["project"])),
  path: Schema.optional(Schema.String),
  roots: Schema.optional(QueryBoolean),
  start: Schema.optional(Schema.NumberFromString),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  since: Schema.optional(Schema.String),
})
export const StateQuery = Schema.Struct({ ...WorkspaceRoutingQueryFields })
export const StateSessionCardQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)),
  ),
  ids: Schema.optional(Schema.String),
})
export const StateSessionQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  limit: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0))),
  before: Schema.optional(Schema.String),
})
export const StateEventQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  after: Schema.optional(Schema.String),
})

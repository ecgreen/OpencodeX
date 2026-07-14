import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXProject } from "@/opencodex/project"
import { OpencodeXSessionState } from "@/opencodex/session-state"
import { OpencodeXView } from "@/opencodex/view"
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
export const UpdateViewPayload = Schema.Struct(Struct.omit(OpencodeXView.UpdateInput.fields, ["id"]))
export const UpdateSessionStatePayload = Schema.Struct(
  Struct.omit(OpencodeXSessionState.UpdateInput.fields, ["sessionID"]),
)
export const PluginListQuery = Schema.Struct({ ...WorkspaceRoutingQueryFields })
export const WorkbenchFileWritePayload = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
  previousContent: Schema.optional(Schema.String),
})
export const WorkbenchFileReadQuery = Schema.Struct({ ...WorkspaceRoutingQueryFields, path: Schema.String })
export const WorkbenchFileCreatePayload = Schema.Struct({
  path: Schema.String,
  content: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.Boolean),
})
export const WorkbenchFileRenamePayload = Schema.Struct({ from: Schema.String, to: Schema.String })
export const WorkbenchFileDeletePayload = Schema.Struct({ path: Schema.String })
export const WorkbenchGitPathsPayload = Schema.Struct({ paths: Schema.Array(Schema.String) })
export const WorkbenchGitBranchPayload = Schema.Struct({ branch: Schema.String })
export const WorkbenchGitCommitPayload = Schema.Struct({
  message: Schema.String,
  body: Schema.optional(Schema.String),
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
export const WorkbenchBridgeRegisterPayload = Schema.Struct({
  browserBridge: Schema.optional(Schema.Struct({ url: Schema.String, token: Schema.String })),
})
export const WorkbenchOperationResult = Schema.Struct({
  ok: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
})
export const WorkbenchGitFileStatus = Schema.Struct({
  path: Schema.String,
  code: Schema.String,
  status: Schema.String,
  staged: Schema.Boolean,
  unstaged: Schema.Boolean,
  untracked: Schema.Boolean,
})
export const WorkbenchGitStatus = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  defaultBranch: Schema.optional(Schema.String),
  upstream: Schema.optional(Schema.String),
  ahead: Schema.optional(Schema.Number),
  behind: Schema.optional(Schema.Number),
  remote: Schema.optional(Schema.String),
  remoteUrl: Schema.optional(Schema.String),
  githubUrl: Schema.optional(Schema.String),
  clean: Schema.Boolean,
  files: Schema.Array(WorkbenchGitFileStatus),
})
export const WorkbenchGitBranches = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.optional(Schema.String),
  current: Schema.optional(Schema.String),
  branches: Schema.Array(Schema.String),
})
export const WorkbenchGitDiffFile = Schema.Struct({
  file: Schema.String,
  patch: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  status: Schema.Literals(["added", "deleted", "modified"]),
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
  severity: Schema.Literals(["error", "warning", "info"]),
  message: Schema.String,
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
export const StateSessionQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  limit: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0))),
  before: Schema.optional(Schema.String),
})
export const StateEventQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  after: Schema.optional(Schema.String),
})

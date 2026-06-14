import { OpencodeXProject } from "@/opencodex/project"
import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXPlugin } from "@/opencodex/plugin"
import { OpencodeXSwarm } from "@/opencodex/swarm"
import { OpencodeXSessionState } from "@/opencodex/session-state"
import { OpencodeXView } from "@/opencodex/view"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Schema, Struct } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { ApiNotFoundError, ProjectNotFoundError } from "../errors"
import { QueryBoolean } from "./query"

const root = "/experimental/opencodex"

export const UpdateProjectPayload = Schema.Struct(Struct.omit(OpencodeXProject.UpdateInput.fields, ["projectID"]))
export const UpdateJobPayload = Schema.Struct(Struct.omit(OpencodeXJob.UpdateInput.fields, ["id"]))
export const UpdateViewPayload = Schema.Struct(Struct.omit(OpencodeXView.UpdateInput.fields, ["id"]))
export const UpdateSessionStatePayload = Schema.Struct(
  Struct.omit(OpencodeXSessionState.UpdateInput.fields, ["sessionID"]),
)
export const PluginListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
})
export const WorkbenchFileWritePayload = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
  previousContent: Schema.optional(Schema.String),
})
export const WorkbenchFileCreatePayload = Schema.Struct({
  path: Schema.String,
  content: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.Boolean),
})
export const WorkbenchFileRenamePayload = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
})
export const WorkbenchFileDeletePayload = Schema.Struct({
  path: Schema.String,
})
export const WorkbenchGitPathsPayload = Schema.Struct({
  paths: Schema.Array(Schema.String),
})
export const WorkbenchGitBranchPayload = Schema.Struct({
  branch: Schema.String,
})
export const WorkbenchGitCommitPayload = Schema.Struct({
  message: Schema.String,
  body: Schema.optional(Schema.String),
})
export const WorkbenchGitStashCreatePayload = Schema.Struct({
  message: Schema.optional(Schema.String),
})
export const WorkbenchGitStashPayload = Schema.Struct({
  ref: Schema.String,
})
export const WorkbenchGithubPullPayload = Schema.Struct({
  number: Schema.Number,
})
export const WorkbenchGithubCreatePullPayload = Schema.Struct({
  title: Schema.String,
  body: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
})
export const WorkbenchBridgeRegisterPayload = Schema.Struct({
  browserBridge: Schema.optional(Schema.Struct({
    url: Schema.String,
    token: Schema.String,
  })),
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

export const OpencodeXApi = HttpApi.make("opencodex")
  .add(
    HttpApiGroup.make("opencodex")
      .add(
        HttpApiEndpoint.get("listProjects", `${root}/project`, {
          success: described(Schema.Array(OpencodeXProject.Info), "List of OpencodeX projects"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.project.list",
            summary: "List OpencodeX projects",
          }),
        ),
        HttpApiEndpoint.post("createProject", `${root}/project`, {
          payload: OpencodeXProject.CreateInput,
          success: described(OpencodeXProject.Info, "Created OpencodeX project"),
          error: [HttpApiError.BadRequest, ProjectNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.project.create",
            summary: "Create OpencodeX project",
          }),
        ),
        HttpApiEndpoint.post("validateProject", `${root}/project/validate`, {
          payload: OpencodeXProject.ValidateInput,
          success: described(OpencodeXProject.Validation, "Validated OpencodeX project folders"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.project.validate",
            summary: "Validate OpencodeX project folders",
          }),
        ),
        HttpApiEndpoint.patch("updateProject", `${root}/project/:projectID`, {
          params: { projectID: Schema.String },
          payload: UpdateProjectPayload,
          success: described(OpencodeXProject.Info, "Updated OpencodeX project"),
          error: [HttpApiError.BadRequest, ProjectNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.project.update",
            summary: "Update OpencodeX project",
          }),
        ),
        HttpApiEndpoint.post("reorderProjects", `${root}/project/reorder`, {
          payload: OpencodeXProject.ReorderInput,
          success: described(Schema.Array(OpencodeXProject.Info), "Reordered OpencodeX projects"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.project.reorder",
            summary: "Reorder OpencodeX projects",
          }),
        ),
        HttpApiEndpoint.post("createSession", `${root}/session`, {
          payload: OpencodeXProject.CreateSessionInput,
          success: described(Session.Info, "Created session"),
          error: [HttpApiError.BadRequest, ProjectNotFoundError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.session.create",
            summary: "Create a session under an OpencodeX project",
          }),
        ),
        HttpApiEndpoint.get("sessionSync", `${root}/session-sync`, {
          query: SessionSyncQuery,
          success: described(OpencodeXSessionState.SyncResponse, "OpencodeX session sync snapshot"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.session.sync",
            summary: "Get lightweight OpencodeX session sync snapshot",
          }),
        ),
        HttpApiEndpoint.patch("updateSessionState", `${root}/session-state/:sessionID`, {
          params: { sessionID: SessionID },
          payload: UpdateSessionStatePayload,
          success: described(OpencodeXSessionState.Info, "Updated OpencodeX session UI state"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.session_state.update",
            summary: "Update OpencodeX session UI state",
          }),
        ),
        HttpApiEndpoint.post("moveSession", `${root}/session/move`, {
          payload: OpencodeXProject.MoveSessionInput,
          success: described(Session.Info, "Moved session"),
          error: [HttpApiError.BadRequest, ProjectNotFoundError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.session.move",
            summary: "Move a session into an OpencodeX project",
          }),
        ),
        HttpApiEndpoint.delete("removeSession", `${root}/session/:sessionID`, {
          params: { sessionID: SessionID },
          success: described(Schema.Boolean, "Deleted session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.session.delete",
            summary: "Delete a session",
          }),
        ),
        HttpApiEndpoint.delete("removeProject", `${root}/project/:projectID`, {
          params: { projectID: Schema.String },
          success: described(Schema.Boolean, "Deleted OpencodeX project"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.project.delete",
            summary: "Delete an OpencodeX project",
          }),
        ),
        HttpApiEndpoint.get("listJobs", `${root}/job`, {
          success: described(Schema.Array(OpencodeXJob.Info), "List OpencodeX jobs"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.job.list",
            summary: "List OpencodeX jobs",
          }),
        ),
        HttpApiEndpoint.get("listPlugins", `${root}/plugin`, {
          query: PluginListQuery,
          success: described(Schema.Array(OpencodeXPlugin.Info), "List configured OpencodeX plugins"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.plugin.list",
            summary: "List configured OpencodeX plugins",
          }),
        ),
        HttpApiEndpoint.post("installPlugin", `${root}/plugin/install`, {
          query: PluginListQuery,
          payload: OpencodeXPlugin.InstallInput,
          success: described(OpencodeXPlugin.InstallResult, "Installed OpencodeX plugin"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.plugin.install",
            summary: "Install an OpencodeX plugin",
          }),
        ),
        HttpApiEndpoint.patch("togglePlugin", `${root}/plugin/toggle`, {
          query: PluginListQuery,
          payload: OpencodeXPlugin.ToggleInput,
          success: described(OpencodeXPlugin.Info, "Updated OpencodeX plugin enabled state"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.plugin.toggle",
            summary: "Enable or disable a TUI plugin",
          }),
        ),
        HttpApiEndpoint.post("workbenchFileWrite", `${root}/workbench/file/write`, {
          payload: WorkbenchFileWritePayload,
          success: described(WorkbenchOperationResult, "Write a text file from the GUI workbench"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.file.write",
            summary: "Write a text file from the GUI workbench",
          }),
        ),
        HttpApiEndpoint.post("workbenchFileCreate", `${root}/workbench/file/create`, {
          payload: WorkbenchFileCreatePayload,
          success: described(WorkbenchOperationResult, "Create a text file from the GUI workbench"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.file.create",
            summary: "Create a text file from the GUI workbench",
          }),
        ),
        HttpApiEndpoint.post("workbenchFileRename", `${root}/workbench/file/rename`, {
          payload: WorkbenchFileRenamePayload,
          success: described(WorkbenchOperationResult, "Rename a file from the GUI workbench"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.file.rename",
            summary: "Rename a file from the GUI workbench",
          }),
        ),
        HttpApiEndpoint.post("workbenchFileDelete", `${root}/workbench/file/delete`, {
          payload: WorkbenchFileDeletePayload,
          success: described(WorkbenchOperationResult, "Delete a file from the GUI workbench"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.file.delete",
            summary: "Delete a file from the GUI workbench",
          }),
        ),
        HttpApiEndpoint.get("workbenchGitStatus", `${root}/workbench/git/status`, {
          success: described(WorkbenchGitStatus, "Workbench Git status"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.status",
            summary: "Get Git status for the GUI workbench",
          }),
        ),
        HttpApiEndpoint.get("workbenchGitBranches", `${root}/workbench/git/branches`, {
          success: described(WorkbenchGitBranches, "Workbench Git branches"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.branches",
            summary: "List Git branches for the GUI workbench",
          }),
        ),
        HttpApiEndpoint.get("workbenchGitDiff", `${root}/workbench/git/diff`, {
          success: described(WorkbenchDataResult, "Workbench Git diffs"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.diff",
            summary: "Load Git diffs for the GUI workbench",
          }),
        ),
        HttpApiEndpoint.get("workbenchGitHistory", `${root}/workbench/git/history`, {
          success: described(WorkbenchDataResult, "Workbench Git history"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.history",
            summary: "Load Git history for the GUI workbench",
          }),
        ),
        HttpApiEndpoint.get("workbenchDiagnostics", `${root}/workbench/diagnostics`, {
          success: described(WorkbenchDiagnosticsResult, "Workbench project diagnostics"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.diagnostics",
            summary: "Run project checks for the GUI workbench",
          }),
        ),
        HttpApiEndpoint.post("workbenchGitCheckout", `${root}/workbench/git/checkout`, {
          payload: WorkbenchGitBranchPayload,
          success: described(WorkbenchOperationResult, "Checkout a Git branch"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.checkout",
            summary: "Checkout a Git branch",
          }),
        ),
        HttpApiEndpoint.post("workbenchGitCreateBranch", `${root}/workbench/git/create-branch`, {
          payload: WorkbenchGitBranchPayload,
          success: described(WorkbenchOperationResult, "Create and checkout a Git branch"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.create_branch",
            summary: "Create and checkout a Git branch",
          }),
        ),
        HttpApiEndpoint.post("workbenchGitStage", `${root}/workbench/git/stage`, {
          payload: WorkbenchGitPathsPayload,
          success: described(WorkbenchOperationResult, "Stage Git files"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.stage",
            summary: "Stage Git files",
          }),
        ),
        HttpApiEndpoint.post("workbenchGitUnstage", `${root}/workbench/git/unstage`, {
          payload: WorkbenchGitPathsPayload,
          success: described(WorkbenchOperationResult, "Unstage Git files"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.unstage",
            summary: "Unstage Git files",
          }),
        ),
        HttpApiEndpoint.post("workbenchGitDiscard", `${root}/workbench/git/discard`, {
          payload: WorkbenchGitPathsPayload,
          success: described(WorkbenchOperationResult, "Discard Git file changes"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.discard",
            summary: "Discard Git file changes",
          }),
        ),
        HttpApiEndpoint.post("workbenchGitCommit", `${root}/workbench/git/commit`, {
          payload: WorkbenchGitCommitPayload,
          success: described(WorkbenchOperationResult, "Commit staged Git changes"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.commit",
            summary: "Commit staged Git changes",
          }),
        ),
        HttpApiEndpoint.post("workbenchGitFetch", `${root}/workbench/git/fetch`, {
          success: described(WorkbenchOperationResult, "Fetch Git remotes"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.fetch",
            summary: "Fetch Git remotes",
          }),
        ),
        HttpApiEndpoint.post("workbenchGitPull", `${root}/workbench/git/pull`, {
          success: described(WorkbenchOperationResult, "Pull current Git branch"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.pull",
            summary: "Pull current Git branch",
          }),
        ),
        HttpApiEndpoint.post("workbenchGitPush", `${root}/workbench/git/push`, {
          success: described(WorkbenchOperationResult, "Push current Git branch"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.push",
            summary: "Push current Git branch",
          }),
        ),
        HttpApiEndpoint.post("workbenchGitPublish", `${root}/workbench/git/publish`, {
          success: described(WorkbenchOperationResult, "Publish current Git branch and set upstream"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.publish",
            summary: "Publish current Git branch and set upstream",
          }),
        ),
        HttpApiEndpoint.get("workbenchGitStashes", `${root}/workbench/git/stashes`, {
          success: described(WorkbenchDataResult, "List Git stashes"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.stashes",
            summary: "List Git stashes",
          }),
        ),
        HttpApiEndpoint.post("workbenchGitStashCreate", `${root}/workbench/git/stash`, {
          payload: WorkbenchGitStashCreatePayload,
          success: described(WorkbenchOperationResult, "Stash current Git changes"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.stash",
            summary: "Stash current Git changes",
          }),
        ),
        HttpApiEndpoint.post("workbenchGitStashApply", `${root}/workbench/git/stash/apply`, {
          payload: WorkbenchGitStashPayload,
          success: described(WorkbenchOperationResult, "Apply a Git stash"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.stash_apply",
            summary: "Apply a Git stash",
          }),
        ),
        HttpApiEndpoint.post("workbenchGitStashPop", `${root}/workbench/git/stash/pop`, {
          payload: WorkbenchGitStashPayload,
          success: described(WorkbenchOperationResult, "Pop a Git stash"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.stash_pop",
            summary: "Pop a Git stash",
          }),
        ),
        HttpApiEndpoint.post("workbenchGitStashDrop", `${root}/workbench/git/stash/drop`, {
          payload: WorkbenchGitStashPayload,
          success: described(WorkbenchOperationResult, "Drop a Git stash"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.git.stash_drop",
            summary: "Drop a Git stash",
          }),
        ),
        HttpApiEndpoint.get("workbenchGithubAuth", `${root}/workbench/github/auth`, {
          success: described(WorkbenchDataResult, "GitHub remote status"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.github.auth",
            summary: "Get GitHub remote status",
          }),
        ),
        HttpApiEndpoint.get("workbenchGithubRepo", `${root}/workbench/github/repo`, {
          success: described(WorkbenchDataResult, "GitHub repository information"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.github.repo",
            summary: "Get GitHub repository information",
          }),
        ),
        HttpApiEndpoint.get("workbenchGithubIssues", `${root}/workbench/github/issues`, {
          success: described(WorkbenchDataResult, "GitHub issues"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.github.issues",
            summary: "List GitHub issues from the remote repository",
          }),
        ),
        HttpApiEndpoint.get("workbenchGithubPulls", `${root}/workbench/github/pulls`, {
          success: described(WorkbenchDataResult, "GitHub pull requests"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.github.pulls",
            summary: "List GitHub pull requests from the remote repository",
          }),
        ),
        HttpApiEndpoint.post("workbenchGithubPull", `${root}/workbench/github/pull`, {
          payload: WorkbenchGithubPullPayload,
          success: described(WorkbenchDataResult, "GitHub pull request detail"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.github.pull",
            summary: "Get GitHub pull request detail from the remote repository",
          }),
        ),
        HttpApiEndpoint.post("workbenchGithubChecks", `${root}/workbench/github/checks`, {
          payload: WorkbenchGithubPullPayload,
          success: described(WorkbenchDataResult, "GitHub pull request checks"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.github.checks",
            summary: "Get GitHub pull request checks from the remote repository",
          }),
        ),
        HttpApiEndpoint.post("workbenchGithubCheckoutPull", `${root}/workbench/github/checkout-pull`, {
          payload: WorkbenchGithubPullPayload,
          success: described(WorkbenchOperationResult, "Checkout a GitHub pull request"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.github.checkout_pull",
            summary: "Checkout a GitHub pull request with Git",
          }),
        ),
        HttpApiEndpoint.post("workbenchGithubCreatePull", `${root}/workbench/github/create-pull`, {
          payload: WorkbenchGithubCreatePullPayload,
          success: described(WorkbenchDataResult, "Created GitHub pull request"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.workbench.github.create_pull",
            summary: "Create a GitHub pull request browser handoff",
          }),
        ),
        HttpApiEndpoint.post("workbenchBridgeRegister", `${root}/gui-bridge/register`, {
          payload: WorkbenchBridgeRegisterPayload,
          success: described(WorkbenchOperationResult, "Register GUI bridge capabilities"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.gui_bridge.register",
            summary: "Register GUI bridge capabilities",
          }),
        ),
        HttpApiEndpoint.post("createJob", `${root}/job`, {
          payload: OpencodeXJob.CreateInput,
          success: described(OpencodeXJob.Info, "Created OpencodeX job"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.job.create",
            summary: "Create OpencodeX job",
          }),
        ),
        HttpApiEndpoint.get("getJob", `${root}/job/:jobID`, {
          params: { jobID: Schema.String },
          success: described(OpencodeXJob.Info, "OpencodeX job"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.job.get",
            summary: "Get OpencodeX job",
          }),
        ),
        HttpApiEndpoint.patch("updateJob", `${root}/job/:jobID`, {
          params: { jobID: Schema.String },
          payload: UpdateJobPayload,
          success: described(OpencodeXJob.Info, "Updated OpencodeX job"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.job.update",
            summary: "Update OpencodeX job",
          }),
        ),
        HttpApiEndpoint.post("cancelJob", `${root}/job/:jobID/cancel`, {
          params: { jobID: Schema.String },
          success: described(OpencodeXJob.Info, "Cancelled OpencodeX job"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.job.cancel",
            summary: "Cancel OpencodeX job",
          }),
        ),
        HttpApiEndpoint.get("listSwarms", `${root}/swarm`, {
          success: described(Schema.Array(OpencodeXSwarm.Info), "List OpencodeX swarms"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.list",
            summary: "List OpencodeX swarms",
          }),
        ),
        HttpApiEndpoint.post("createSwarm", `${root}/swarm`, {
          payload: OpencodeXSwarm.CreateInput,
          success: described(OpencodeXSwarm.Info, "Created OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ProjectNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.create",
            summary: "Create OpencodeX swarm",
          }),
        ),
        HttpApiEndpoint.get("getSwarm", `${root}/swarm/:swarmID`, {
          params: { swarmID: Schema.String },
          success: described(OpencodeXSwarm.Info, "OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.get",
            summary: "Get OpencodeX swarm",
          }),
        ),
        HttpApiEndpoint.patch("updateSwarm", `${root}/swarm/:swarmID`, {
          params: { swarmID: Schema.String },
          payload: OpencodeXSwarm.UpdateInput,
          success: described(OpencodeXSwarm.Info, "Updated OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.update",
            summary: "Update OpencodeX swarm",
          }),
        ),
        HttpApiEndpoint.post("startSwarm", `${root}/swarm/:swarmID/start`, {
          params: { swarmID: Schema.String },
          success: described(OpencodeXSwarm.Info, "Started OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.start",
            summary: "Start OpencodeX swarm",
          }),
        ),
        HttpApiEndpoint.post("assignSwarmTask", `${root}/swarm/:swarmID/task`, {
          params: { swarmID: Schema.String },
          payload: OpencodeXSwarm.AssignTaskInput,
          success: described(OpencodeXSwarm.Info, "Assigned task to OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.task.assign",
            summary: "Assign task to OpencodeX swarm",
          }),
        ),
        HttpApiEndpoint.post("cancelSwarm", `${root}/swarm/:swarmID/cancel`, {
          params: { swarmID: Schema.String },
          success: described(OpencodeXSwarm.Info, "Cancelled OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.cancel",
            summary: "Cancel OpencodeX swarm",
          }),
        ),
        HttpApiEndpoint.delete("removeSwarm", `${root}/swarm/:swarmID`, {
          params: { swarmID: Schema.String },
          success: described(Schema.Boolean, "Deleted OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.delete",
            summary: "Delete OpencodeX swarm",
          }),
        ),
        HttpApiEndpoint.post("addSwarmRole", `${root}/swarm/:swarmID/role`, {
          params: { swarmID: Schema.String },
          payload: OpencodeXSwarm.AddRoleInput,
          success: described(OpencodeXSwarm.Info, "Updated OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.role.add",
            summary: "Add OpencodeX swarm role",
          }),
        ),
        HttpApiEndpoint.patch("updateSwarmRole", `${root}/swarm/:swarmID/role/:roleID`, {
          params: { swarmID: Schema.String, roleID: Schema.String },
          payload: OpencodeXSwarm.UpdateRoleInput,
          success: described(OpencodeXSwarm.Info, "Updated OpencodeX swarm"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.swarm.role.update",
            summary: "Update OpencodeX swarm role",
          }),
        ),
        HttpApiEndpoint.get("listViews", `${root}/view`, {
          success: described(Schema.Array(OpencodeXView.Info), "List OpencodeX views"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.view.list",
            summary: "List OpencodeX views",
          }),
        ),
        HttpApiEndpoint.post("createView", `${root}/view`, {
          payload: OpencodeXView.CreateInput,
          success: described(OpencodeXView.Info, "Created OpencodeX view"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.view.create",
            summary: "Create OpencodeX view",
          }),
        ),
        HttpApiEndpoint.post("reorderViews", `${root}/view/reorder`, {
          payload: OpencodeXView.ReorderInput,
          success: described(Schema.Array(OpencodeXView.Info), "Reordered OpencodeX views"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.view.reorder",
            summary: "Reorder OpencodeX views",
          }),
        ),
        HttpApiEndpoint.get("getView", `${root}/view/:viewID`, {
          params: { viewID: Schema.String },
          success: described(OpencodeXView.Info, "OpencodeX view"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.view.get",
            summary: "Get OpencodeX view",
          }),
        ),
        HttpApiEndpoint.patch("updateView", `${root}/view/:viewID`, {
          params: { viewID: Schema.String },
          payload: UpdateViewPayload,
          success: described(OpencodeXView.Info, "Updated OpencodeX view"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.view.update",
            summary: "Update OpencodeX view",
          }),
        ),
        HttpApiEndpoint.delete("removeView", `${root}/view/:viewID`, {
          params: { viewID: Schema.String },
          success: described(Schema.Boolean, "Deleted OpencodeX view"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "opencodex.view.delete",
            summary: "Delete OpencodeX view",
          }),
        ),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencodex",
      version: "0.0.1",
      description: "OpencodeX project and session overlay routes.",
    }),
  )

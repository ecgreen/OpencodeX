import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXPlugin } from "@/opencodex/plugin"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { opencodexProjectGroup } from "./opencodex-project-group"
import {
  OPENCODEX_ROOT,
  PluginListQuery,
  WorkbenchDataResult,
  WorkbenchDiagnosticsResult,
  WorkbenchFileCreatePayload,
  WorkbenchFileDeletePayload,
  WorkbenchFileReadQuery,
  WorkbenchFileRenamePayload,
  WorkbenchFileWritePayload,
  WorkbenchGitBranches,
  WorkbenchGitStatus,
  WorkbenchOperationResult,
} from "./opencodex-schema"

export const opencodexReadGroup = opencodexProjectGroup.add(
  HttpApiEndpoint.get("listJobs", `${OPENCODEX_ROOT}/job`, {
    success: described(Schema.Array(OpencodeXJob.Info), "List OpencodeX jobs"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.job.list", summary: "List OpencodeX jobs" })),
  HttpApiEndpoint.get("listPlugins", `${OPENCODEX_ROOT}/plugin`, {
    query: PluginListQuery,
    success: described(Schema.Array(OpencodeXPlugin.Info), "List configured OpencodeX plugins"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.plugin.list", summary: "List configured OpencodeX plugins" })),
  HttpApiEndpoint.post("installPlugin", `${OPENCODEX_ROOT}/plugin/install`, {
    query: PluginListQuery,
    payload: OpencodeXPlugin.InstallInput,
    success: described(OpencodeXPlugin.InstallResult, "Installed OpencodeX plugin"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.plugin.install", summary: "Install an OpencodeX plugin" })),
  HttpApiEndpoint.patch("togglePlugin", `${OPENCODEX_ROOT}/plugin/toggle`, {
    query: PluginListQuery,
    payload: OpencodeXPlugin.ToggleInput,
    success: described(OpencodeXPlugin.Info, "Updated OpencodeX plugin enabled state"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.plugin.toggle", summary: "Enable or disable a TUI plugin" })),
  HttpApiEndpoint.get("workbenchFileRead", `${OPENCODEX_ROOT}/workbench/file/read`, {
    query: WorkbenchFileReadQuery,
    success: described(WorkbenchOperationResult, "Read exact text from the GUI workbench"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.file.read", summary: "Read exact text from the GUI workbench" })),
  HttpApiEndpoint.post("workbenchFileWrite", `${OPENCODEX_ROOT}/workbench/file/write`, {
    payload: WorkbenchFileWritePayload,
    success: described(WorkbenchOperationResult, "Write a text file from the GUI workbench"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.file.write", summary: "Write a text file from the GUI workbench" })),
  HttpApiEndpoint.post("workbenchFileCreate", `${OPENCODEX_ROOT}/workbench/file/create`, {
    payload: WorkbenchFileCreatePayload,
    success: described(WorkbenchOperationResult, "Create a text file from the GUI workbench"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.file.create", summary: "Create a text file from the GUI workbench" })),
  HttpApiEndpoint.post("workbenchFileRename", `${OPENCODEX_ROOT}/workbench/file/rename`, {
    payload: WorkbenchFileRenamePayload,
    success: described(WorkbenchOperationResult, "Rename a file from the GUI workbench"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.file.rename", summary: "Rename a file from the GUI workbench" })),
  HttpApiEndpoint.post("workbenchFileDelete", `${OPENCODEX_ROOT}/workbench/file/delete`, {
    payload: WorkbenchFileDeletePayload,
    success: described(WorkbenchOperationResult, "Delete a file from the GUI workbench"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.file.delete", summary: "Delete a file from the GUI workbench" })),
  HttpApiEndpoint.get("workbenchGitStatus", `${OPENCODEX_ROOT}/workbench/git/status`, {
    success: described(WorkbenchGitStatus, "Workbench Git status"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.status", summary: "Get Git status for the GUI workbench" })),
  HttpApiEndpoint.get("workbenchGitBranches", `${OPENCODEX_ROOT}/workbench/git/branches`, {
    success: described(WorkbenchGitBranches, "Workbench Git branches"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.branches", summary: "List Git branches for the GUI workbench" })),
  HttpApiEndpoint.get("workbenchGitDiff", `${OPENCODEX_ROOT}/workbench/git/diff`, {
    success: described(WorkbenchDataResult, "Workbench Git diffs"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.diff", summary: "Load Git diffs for the GUI workbench" })),
  HttpApiEndpoint.get("workbenchGitHistory", `${OPENCODEX_ROOT}/workbench/git/history`, {
    success: described(WorkbenchDataResult, "Workbench Git history"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.history", summary: "Load Git history for the GUI workbench" })),
  HttpApiEndpoint.get("workbenchDiagnostics", `${OPENCODEX_ROOT}/workbench/diagnostics`, {
    success: described(WorkbenchDiagnosticsResult, "Workbench project diagnostics"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.diagnostics", summary: "Run project checks for the GUI workbench" })),
)

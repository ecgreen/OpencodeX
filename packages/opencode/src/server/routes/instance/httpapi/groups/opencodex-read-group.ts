import { OpencodeXJob } from "@/opencodex/job"
import { OpencodeXPlugin } from "@/opencodex/plugin"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { opencodexProjectGroup } from "./opencodex-project-group"
import {
  OPENCODEX_ROOT,
  PluginListQuery,
  WorkbenchChangePatch,
  WorkbenchChangePatchPage,
  WorkbenchChangePatchPageQuery,
  WorkbenchChangePatchQuery,
  WorkbenchChangeMetricsPage,
  WorkbenchChangeMetricsQuery,
  WorkbenchChangesPage,
  WorkbenchChangesQuery,
  WorkbenchDataResult,
  WorkbenchDiagnosticsResult,
  WorkbenchDefinitionLocation,
  WorkbenchFileAnalysisPayload,
  WorkbenchFileCreatePayload,
  WorkbenchFileDefinitionPayload,
  WorkbenchFileCompletionPayload,
  WorkbenchHoverResult,
  WorkbenchCompletionResult,
  WorkbenchFileDeletePayload,
  WorkbenchFileReadQuery,
  WorkbenchFileReadResult,
  WorkbenchFileDiagnosticsResult,
  WorkbenchFileRenamePayload,
  WorkbenchFileWritePayload,
  WorkbenchGitBranches,
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
    success: described(WorkbenchFileReadResult, "Read exact text from the GUI workbench"),
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
  HttpApiEndpoint.post("workbenchFileDiagnostics", `${OPENCODEX_ROOT}/workbench/file/diagnostics`, {
    query: PluginListQuery,
    payload: WorkbenchFileAnalysisPayload,
    success: described(WorkbenchFileDiagnosticsResult, "Active-file diagnostics from the configured language server"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.file.diagnostics", summary: "Check one GUI workbench file" })),
  HttpApiEndpoint.post("workbenchFileDefinition", `${OPENCODEX_ROOT}/workbench/file/definition`, {
    query: PluginListQuery,
    payload: WorkbenchFileDefinitionPayload,
    success: described(Schema.Array(WorkbenchDefinitionLocation), "Definition locations for a GUI workbench file position"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.file.definition", summary: "Find a definition from the GUI workbench" })),
  HttpApiEndpoint.post("workbenchFileHover", `${OPENCODEX_ROOT}/workbench/file/hover`, {
    query: PluginListQuery,
    payload: WorkbenchFileDefinitionPayload,
    success: described(WorkbenchHoverResult, "Type and definition details for a GUI workbench file position"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.file.hover", summary: "Describe a symbol in the GUI workbench" })),
  HttpApiEndpoint.post("workbenchFileCompletion", `${OPENCODEX_ROOT}/workbench/file/completion`, {
    query: PluginListQuery,
    payload: WorkbenchFileCompletionPayload,
    success: described(WorkbenchCompletionResult, "Completion items for a GUI workbench file position"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.file.completion", summary: "Complete a symbol in the GUI workbench" })),
  HttpApiEndpoint.get("workbenchGitBranches", `${OPENCODEX_ROOT}/workbench/git/branches`, {
    success: described(WorkbenchGitBranches, "Workbench Git branches"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.branches", summary: "List Git branches for the GUI workbench" })),
  HttpApiEndpoint.get("workbenchChangesPage", `${OPENCODEX_ROOT}/workbench/changes/page`, {
    query: WorkbenchChangesQuery,
    success: described(WorkbenchChangesPage, "Paged GUI workbench changes"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.changes.page", summary: "List paged GUI workbench changes" })),
  HttpApiEndpoint.get("workbenchChangePatch", `${OPENCODEX_ROOT}/workbench/changes/patch`, {
    query: WorkbenchChangePatchQuery,
    success: described(WorkbenchChangePatch, "One bounded GUI workbench patch"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.changes.patch", summary: "Load one bounded GUI workbench patch" })),
  HttpApiEndpoint.get("workbenchChangeMetricsPage", `${OPENCODEX_ROOT}/workbench/changes/metrics/page`, {
    query: WorkbenchChangeMetricsQuery,
    success: described(WorkbenchChangeMetricsPage, "Progressive GUI workbench change metrics"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.changes.metricsPage", summary: "Measure a page of GUI workbench changes" })),
  HttpApiEndpoint.get("workbenchChangePatchPage", `${OPENCODEX_ROOT}/workbench/changes/patch/page`, {
    query: WorkbenchChangePatchPageQuery,
    success: described(WorkbenchChangePatchPage, "One page of a selected GUI workbench patch"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.changes.patchPage", summary: "Load a selected GUI workbench patch page" })),
  HttpApiEndpoint.get("workbenchGitHistory", `${OPENCODEX_ROOT}/workbench/git/history`, {
    success: described(WorkbenchDataResult, "Workbench Git history"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.history", summary: "Load Git history for the GUI workbench" })),
  HttpApiEndpoint.get("workbenchDiagnostics", `${OPENCODEX_ROOT}/workbench/diagnostics`, {
    success: described(WorkbenchDiagnosticsResult, "Workbench project diagnostics"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.diagnostics", summary: "Run project checks for the GUI workbench" })),
)

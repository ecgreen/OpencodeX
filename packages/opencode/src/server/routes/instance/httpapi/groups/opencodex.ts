import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { opencodexGroup } from "./opencodex-operations-group"

export {
  ClaimJobPayload,
  CompleteJobPayload,
  FailJobPayload,
  PluginListQuery,
  SessionSyncQuery,
  StartJobPayload,
  StateEventQuery,
  StateQuery,
  StateSessionQuery,
  UpdateJobPayload,
  UpdateProjectPayload,
  UpdateSessionStatePayload,
  UpdateViewPayload,
  WorkbenchDataResult,
  WorkbenchDiagnostic,
  WorkbenchDiagnosticsResult,
  WorkbenchFileCreatePayload,
  WorkbenchFileDeletePayload,
  WorkbenchFileReadQuery,
  WorkbenchFileRenamePayload,
  WorkbenchFileWritePayload,
  WorkbenchGitBranches,
  WorkbenchGitBranchPayload,
  WorkbenchGitCommitPayload,
  WorkbenchGitDiffFile,
  WorkbenchGitFileStatus,
  WorkbenchGitHistoryCommit,
  WorkbenchGitHistoryFile,
  WorkbenchGitPathsPayload,
  WorkbenchGitStashCreatePayload,
  WorkbenchGitStashPayload,
  WorkbenchGitStatus,
  WorkbenchGithubCreatePullPayload,
  WorkbenchGithubPullPayload,
  WorkbenchOperationResult,
} from "./opencodex-schema"

export const OpencodeXApi = HttpApi.make("opencodex")
  .add(opencodexGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "opencodex",
      version: "0.0.1",
      description: "OpencodeX project and session overlay routes.",
    }),
  )

import { HttpApiEndpoint, HttpApiError, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { opencodexReadGroup } from "./opencodex-read-group"
import {
  OPENCODEX_ROOT,
  WorkbenchDataResult,
  WorkbenchGitBranchPayload,
  WorkbenchGitCommitPayload,
  WorkbenchGitPathsPayload,
  WorkbenchGitStashCreatePayload,
  WorkbenchGitStashPayload,
  WorkbenchGithubCreatePullPayload,
  WorkbenchGithubPullPayload,
  WorkbenchOperationResult,
} from "./opencodex-schema"

export const opencodexWorkbenchGroup = opencodexReadGroup.add(
  HttpApiEndpoint.post("workbenchGitCheckout", `${OPENCODEX_ROOT}/workbench/git/checkout`, {
    payload: WorkbenchGitBranchPayload,
    success: described(WorkbenchOperationResult, "Checkout a Git branch"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.checkout", summary: "Checkout a Git branch" })),
  HttpApiEndpoint.post("workbenchGitCreateBranch", `${OPENCODEX_ROOT}/workbench/git/create-branch`, {
    payload: WorkbenchGitBranchPayload,
    success: described(WorkbenchOperationResult, "Create and checkout a Git branch"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.workbench.git.create_branch", summary: "Create and checkout a Git branch" }),
  ),
  HttpApiEndpoint.post("workbenchGitStage", `${OPENCODEX_ROOT}/workbench/git/stage`, {
    payload: WorkbenchGitPathsPayload,
    success: described(WorkbenchOperationResult, "Stage Git files"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.stage", summary: "Stage Git files" })),
  HttpApiEndpoint.post("workbenchGitUnstage", `${OPENCODEX_ROOT}/workbench/git/unstage`, {
    payload: WorkbenchGitPathsPayload,
    success: described(WorkbenchOperationResult, "Unstage Git files"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.unstage", summary: "Unstage Git files" })),
  HttpApiEndpoint.post("workbenchGitDiscard", `${OPENCODEX_ROOT}/workbench/git/discard`, {
    payload: WorkbenchGitPathsPayload,
    success: described(WorkbenchOperationResult, "Discard Git file changes"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.discard", summary: "Discard Git file changes" })),
  HttpApiEndpoint.post("workbenchGitCommit", `${OPENCODEX_ROOT}/workbench/git/commit`, {
    payload: WorkbenchGitCommitPayload,
    success: described(WorkbenchOperationResult, "Commit staged Git changes"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.commit", summary: "Commit staged Git changes" })),
  HttpApiEndpoint.post("workbenchGitFetch", `${OPENCODEX_ROOT}/workbench/git/fetch`, {
    success: described(WorkbenchOperationResult, "Fetch Git remotes"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.fetch", summary: "Fetch Git remotes" })),
  HttpApiEndpoint.post("workbenchGitPull", `${OPENCODEX_ROOT}/workbench/git/pull`, {
    success: described(WorkbenchOperationResult, "Pull current Git branch"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.pull", summary: "Pull current Git branch" })),
  HttpApiEndpoint.post("workbenchGitPush", `${OPENCODEX_ROOT}/workbench/git/push`, {
    success: described(WorkbenchOperationResult, "Push current Git branch"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.push", summary: "Push current Git branch" })),
  HttpApiEndpoint.post("workbenchGitPublish", `${OPENCODEX_ROOT}/workbench/git/publish`, {
    success: described(WorkbenchOperationResult, "Publish current Git branch and set upstream"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.workbench.git.publish", summary: "Publish current Git branch and set upstream" }),
  ),
  HttpApiEndpoint.get("workbenchGitStashes", `${OPENCODEX_ROOT}/workbench/git/stashes`, {
    success: described(WorkbenchDataResult, "List Git stashes"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.stashes", summary: "List Git stashes" })),
  HttpApiEndpoint.post("workbenchGitStashCreate", `${OPENCODEX_ROOT}/workbench/git/stash`, {
    payload: WorkbenchGitStashCreatePayload,
    success: described(WorkbenchOperationResult, "Stash current Git changes"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.stash", summary: "Stash current Git changes" })),
  HttpApiEndpoint.post("workbenchGitStashApply", `${OPENCODEX_ROOT}/workbench/git/stash/apply`, {
    payload: WorkbenchGitStashPayload,
    success: described(WorkbenchOperationResult, "Apply a Git stash"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.stash_apply", summary: "Apply a Git stash" })),
  HttpApiEndpoint.post("workbenchGitStashPop", `${OPENCODEX_ROOT}/workbench/git/stash/pop`, {
    payload: WorkbenchGitStashPayload,
    success: described(WorkbenchOperationResult, "Pop a Git stash"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.stash_pop", summary: "Pop a Git stash" })),
  HttpApiEndpoint.post("workbenchGitStashDrop", `${OPENCODEX_ROOT}/workbench/git/stash/drop`, {
    payload: WorkbenchGitStashPayload,
    success: described(WorkbenchOperationResult, "Drop a Git stash"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.git.stash_drop", summary: "Drop a Git stash" })),
  HttpApiEndpoint.get("workbenchGithubAuth", `${OPENCODEX_ROOT}/workbench/github/auth`, {
    success: described(WorkbenchDataResult, "GitHub remote status"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.github.auth", summary: "Get GitHub remote status" })),
  HttpApiEndpoint.get("workbenchGithubRepo", `${OPENCODEX_ROOT}/workbench/github/repo`, {
    success: described(WorkbenchDataResult, "GitHub repository information"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.github.repo", summary: "Get GitHub repository information" })),
  HttpApiEndpoint.get("workbenchGithubIssues", `${OPENCODEX_ROOT}/workbench/github/issues`, {
    success: described(WorkbenchDataResult, "GitHub issues"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(OpenApi.annotations({ identifier: "opencodex.workbench.github.issues", summary: "List GitHub issues from the remote repository" })),
  HttpApiEndpoint.get("workbenchGithubPulls", `${OPENCODEX_ROOT}/workbench/github/pulls`, {
    success: described(WorkbenchDataResult, "GitHub pull requests"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.workbench.github.pulls", summary: "List GitHub pull requests from the remote repository" }),
  ),
  HttpApiEndpoint.post("workbenchGithubPull", `${OPENCODEX_ROOT}/workbench/github/pull`, {
    payload: WorkbenchGithubPullPayload,
    success: described(WorkbenchDataResult, "GitHub pull request detail"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.workbench.github.pull", summary: "Get GitHub pull request detail from the remote repository" }),
  ),
  HttpApiEndpoint.post("workbenchGithubChecks", `${OPENCODEX_ROOT}/workbench/github/checks`, {
    payload: WorkbenchGithubPullPayload,
    success: described(WorkbenchDataResult, "GitHub pull request checks"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.workbench.github.checks", summary: "Get GitHub pull request checks from the remote repository" }),
  ),
  HttpApiEndpoint.post("workbenchGithubCheckoutPull", `${OPENCODEX_ROOT}/workbench/github/checkout-pull`, {
    payload: WorkbenchGithubPullPayload,
    success: described(WorkbenchOperationResult, "Checkout a GitHub pull request"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.workbench.github.checkout_pull", summary: "Checkout a GitHub pull request with Git" }),
  ),
  HttpApiEndpoint.post("workbenchGithubCreatePull", `${OPENCODEX_ROOT}/workbench/github/create-pull`, {
    payload: WorkbenchGithubCreatePullPayload,
    success: described(WorkbenchDataResult, "Created GitHub pull request"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({ identifier: "opencodex.workbench.github.create_pull", summary: "Create a GitHub pull request browser handoff" }),
  ),
)

import { InstanceState } from "@/effect/instance-state"
import { workbenchDiagnostics } from "@/opencodex/workbench-diagnostics"
import { workbenchGitDiffFiles, workbenchGitHistory } from "@/opencodex/workbench-git"
import { Effect } from "effect"
import {
  WorkbenchGitBranchPayload,
  WorkbenchGitCommitPayload,
  WorkbenchGitPathsPayload,
  WorkbenchGitStashCreatePayload,
  WorkbenchGitStashPayload,
} from "../groups/opencodex"
import {
  branchNameValid,
  gitBranch,
  gitDefaultBranch,
  gitHubWebUrl,
  gitMessage,
  gitOperationResult,
  gitPaths,
  gitRemoteUrl,
  gitResult,
  gitRun,
  gitTracking,
  parseGitStashes,
  parseGitStatus,
  stashRefValid,
  workbenchCwd,
  workbenchFailure,
  workbenchRunCommand,
} from "./opencodex-workbench-common"

export function makeOpencodeXWorkbenchGitHandlers() {
  const workbenchGitStatus = Effect.fn("OpencodeXHttpApi.workbenchGitStatus")(function* () {
    const cwd = workbenchCwd(yield* InstanceState.context)
    const status = gitResult(
      yield* Effect.promise(() => gitRun(["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."], cwd)),
    )
    if (status.exitCode !== 0) {
      return { ok: false, message: gitMessage(status) || "Not a Git repository.", clean: true, files: [] }
    }
    const branch = yield* Effect.promise(() => gitBranch(cwd))
    const defaultBranch = yield* Effect.promise(() => gitDefaultBranch(cwd))
    const remoteUrl = yield* Effect.promise(() => gitRemoteUrl(cwd))
    const tracking = yield* Effect.promise(() => gitTracking(cwd))
    const files = parseGitStatus(status.text())
    return {
      ok: true,
      branch,
      defaultBranch,
      ...tracking,
      remote: remoteUrl ? "origin" : undefined,
      remoteUrl,
      githubUrl: gitHubWebUrl(remoteUrl),
      clean: files.length === 0,
      files,
    }
  })

  const workbenchGitBranches = Effect.fn("OpencodeXHttpApi.workbenchGitBranches")(function* () {
    const cwd = workbenchCwd(yield* InstanceState.context)
    const list = gitResult(yield* Effect.promise(() => gitRun(["branch", "--format=%(refname:short)"], cwd)))
    if (list.exitCode !== 0) return { ok: false, message: gitMessage(list) || "Could not list branches.", branches: [] }
    return {
      ok: true,
      current: yield* Effect.promise(() => gitBranch(cwd)),
      branches: list.text().split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    }
  })

  const workbenchGitDiff = Effect.fn("OpencodeXHttpApi.workbenchGitDiff")(function* () {
    const cwd = workbenchCwd(yield* InstanceState.context)
    return yield* Effect.promise(() => workbenchGitDiffFiles(cwd, gitRun))
  })

  const workbenchGitHistoryEndpoint = Effect.fn("OpencodeXHttpApi.workbenchGitHistory")(function* () {
    const cwd = workbenchCwd(yield* InstanceState.context)
    return yield* Effect.promise(() => workbenchGitHistory(cwd, gitRun))
  })

  const workbenchDiagnosticsEndpoint = Effect.fn("OpencodeXHttpApi.workbenchDiagnostics")(function* () {
    const cwd = workbenchCwd(yield* InstanceState.context)
    return yield* Effect.promise(() => workbenchDiagnostics(cwd, workbenchRunCommand))
  })

  const workbenchGitCheckout = Effect.fn("OpencodeXHttpApi.workbenchGitCheckout")(function* (ctx: {
    payload: typeof WorkbenchGitBranchPayload.Type
  }) {
    if (!branchNameValid(ctx.payload.branch)) return workbenchFailure("invalid_branch", "Invalid branch name.")
    const cwd = workbenchCwd(yield* InstanceState.context)
    const result = gitResult(
      yield* Effect.promise(() => gitRun(["checkout", ctx.payload.branch.trim()], cwd)),
    )
    return gitOperationResult(result, "Checked out branch.")
  })

  const workbenchGitCreateBranch = Effect.fn("OpencodeXHttpApi.workbenchGitCreateBranch")(function* (ctx: {
    payload: typeof WorkbenchGitBranchPayload.Type
  }) {
    if (!branchNameValid(ctx.payload.branch)) return workbenchFailure("invalid_branch", "Invalid branch name.")
    const cwd = workbenchCwd(yield* InstanceState.context)
    const result = gitResult(
      yield* Effect.promise(() => gitRun(["checkout", "-b", ctx.payload.branch.trim()], cwd)),
    )
    return gitOperationResult(result, "Created branch.")
  })

  const workbenchGitStage = Effect.fn("OpencodeXHttpApi.workbenchGitStage")(function* (ctx: {
    payload: typeof WorkbenchGitPathsPayload.Type
  }) {
    const paths = gitPaths(ctx.payload.paths)
    if (paths.length === 0) return workbenchFailure("empty", "Choose at least one file.")
    const cwd = workbenchCwd(yield* InstanceState.context)
    const result = gitResult(yield* Effect.promise(() => gitRun(["add", "--", ...paths], cwd)))
    return gitOperationResult(result, "Staged files.")
  })

  const workbenchGitUnstage = Effect.fn("OpencodeXHttpApi.workbenchGitUnstage")(function* (ctx: {
    payload: typeof WorkbenchGitPathsPayload.Type
  }) {
    const paths = gitPaths(ctx.payload.paths)
    if (paths.length === 0) return workbenchFailure("empty", "Choose at least one file.")
    const cwd = workbenchCwd(yield* InstanceState.context)
    const result = gitResult(
      yield* Effect.promise(() => gitRun(["restore", "--staged", "--", ...paths], cwd)),
    )
    return gitOperationResult(result, "Unstaged files.")
  })

  const workbenchGitDiscard = Effect.fn("OpencodeXHttpApi.workbenchGitDiscard")(function* (ctx: {
    payload: typeof WorkbenchGitPathsPayload.Type
  }) {
    const paths = gitPaths(ctx.payload.paths)
    if (paths.length === 0) return workbenchFailure("empty", "Choose at least one file.")
    const cwd = workbenchCwd(yield* InstanceState.context)
    const restore = gitResult(yield* Effect.promise(() => gitRun(["restore", "--worktree", "--", ...paths], cwd)))
    if (restore.exitCode !== 0) return gitOperationResult(restore, "Discarded files.")
    return gitOperationResult(gitResult(yield* Effect.promise(() => gitRun(["clean", "-f", "--", ...paths], cwd))), "Discarded files.")
  })

  const workbenchGitCommit = Effect.fn("OpencodeXHttpApi.workbenchGitCommit")(function* (ctx: {
    payload: typeof WorkbenchGitCommitPayload.Type
  }) {
    const message = ctx.payload.message.trim()
    if (!message) return workbenchFailure("empty", "Commit message is required.")
    const body = ctx.payload.body?.trim()
    const cwd = workbenchCwd(yield* InstanceState.context)
    const result = gitResult(
      yield* Effect.promise(() =>
        gitRun(["commit", "--no-gpg-sign", "-m", message, ...(body ? ["-m", body] : [])], cwd),
      ),
    )
    return gitOperationResult(result, "Committed changes.")
  })

  const workbenchGitFetch = gitCommand("workbenchGitFetch", ["fetch", "--all", "--prune"], "Fetched remotes.")
  const workbenchGitPull = gitCommand("workbenchGitPull", ["pull", "--ff-only"], "Pulled current branch.")
  const workbenchGitPush = gitCommand("workbenchGitPush", ["push"], "Pushed current branch.")

  const workbenchGitPublish = Effect.fn("OpencodeXHttpApi.workbenchGitPublish")(function* () {
    const cwd = workbenchCwd(yield* InstanceState.context)
    const branch = yield* Effect.promise(() => gitBranch(cwd))
    if (!branch || !branchNameValid(branch)) return workbenchFailure("invalid_branch", "Checkout a named branch before publishing.")
    const result = gitResult(yield* Effect.promise(() => gitRun(["push", "--set-upstream", "origin", branch], cwd)))
    return gitOperationResult(result, `Published ${branch}.`)
  })

  const workbenchGitStashes = Effect.fn("OpencodeXHttpApi.workbenchGitStashes")(function* () {
    const cwd = workbenchCwd(yield* InstanceState.context)
    const result = gitResult(
      yield* Effect.promise(() =>
        gitRun(["stash", "list", "--format=%gd%x00%H%x00%cr%x00%s%x1e"], cwd),
      ),
    )
    if (result.exitCode !== 0) return { ok: false, message: gitMessage(result) || "Could not list Git stashes.", data: [] }
    return { ok: true, data: parseGitStashes(result.text()) }
  })

  const workbenchGitStashCreate = Effect.fn("OpencodeXHttpApi.workbenchGitStashCreate")(function* (ctx: {
    payload: typeof WorkbenchGitStashCreatePayload.Type
  }) {
    const message = ctx.payload.message?.trim() || "Workbench changes"
    const cwd = workbenchCwd(yield* InstanceState.context)
    const result = gitResult(
      yield* Effect.promise(() => gitRun(["stash", "push", "--include-untracked", "-m", message], cwd)),
    )
    return gitOperationResult(result, "Stashed changes.")
  })

  const workbenchGitStashApply = stashCommand("workbenchGitStashApply", "apply", "Applied")
  const workbenchGitStashPop = stashCommand("workbenchGitStashPop", "pop", "Popped")
  const workbenchGitStashDrop = stashCommand("workbenchGitStashDrop", "drop", "Dropped")

  return {
    workbenchGitStatus,
    workbenchGitBranches,
    workbenchGitDiff,
    workbenchGitHistoryEndpoint,
    workbenchDiagnosticsEndpoint,
    workbenchGitCheckout,
    workbenchGitCreateBranch,
    workbenchGitStage,
    workbenchGitUnstage,
    workbenchGitDiscard,
    workbenchGitCommit,
    workbenchGitFetch,
    workbenchGitPull,
    workbenchGitPush,
    workbenchGitPublish,
    workbenchGitStashes,
    workbenchGitStashCreate,
    workbenchGitStashApply,
    workbenchGitStashPop,
    workbenchGitStashDrop,
  }
}

function gitCommand(name: string, args: string[], success: string) {
  return Effect.fn(`OpencodeXHttpApi.${name}`)(function* () {
    const cwd = workbenchCwd(yield* InstanceState.context)
    const result = gitResult(yield* Effect.promise(() => gitRun(args, cwd)))
    return gitOperationResult(result, success)
  })
}

function stashCommand(name: string, command: "apply" | "pop" | "drop", action: string) {
  return Effect.fn(`OpencodeXHttpApi.${name}`)(function* (ctx: { payload: typeof WorkbenchGitStashPayload.Type }) {
    const ref = ctx.payload.ref.trim()
    if (!stashRefValid(ref)) return workbenchFailure("invalid_stash", "Invalid stash reference.")
    const cwd = workbenchCwd(yield* InstanceState.context)
    const result = gitResult(yield* Effect.promise(() => gitRun(["stash", command, ref], cwd)))
    return gitOperationResult(result, `${action} ${ref}.`)
  })
}

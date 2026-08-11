import { InstanceState } from "@/effect/instance-state"
import { workbenchDiagnostics } from "@/opencodex/workbench-diagnostics"
import { loadWorkbenchChangePatch, loadWorkbenchChangePatchPage } from "@/opencodex/workbench-change-patch"
import { listWorkbenchChanges, loadWorkbenchChangeMetrics, loadWorkbenchRepositoryMetadata, runWorkbenchGit } from "@/opencodex/workbench-changes"
import { workbenchGitHistory } from "@/opencodex/workbench-git"
import { Effect } from "effect"
import {
  WorkbenchGitBranchPayload,
  WorkbenchChangeMetricsQuery,
  WorkbenchChangePatchPageQuery,
  WorkbenchChangePatchQuery,
  WorkbenchChangesQuery,
  WorkbenchGitCommitPayload,
  WorkbenchGitPathsPayload,
  WorkbenchGitStashCreatePayload,
  WorkbenchGitStashPayload,
} from "../groups/opencodex"
import {
  branchNameValid,
  gitBranch,
  gitMessage,
  gitOperationResult,
  gitPaths,
  gitResult,
  gitRun,
  parseGitStashes,
  stashRefValid,
  workbenchCwd,
  workbenchFailure,
  workbenchRunCommand,
  workbenchSuccess,
} from "./opencodex-workbench-common"

export function makeOpencodeXWorkbenchGitHandlers() {
  const workbenchChanges = Effect.fn("OpencodeXHttpApi.workbenchChanges")(function* (ctx: {
    query: typeof WorkbenchChangesQuery.Type
  }) {
    return yield* listWorkbenchChanges({ ...ctx.query, metadata: ctx.query.metadata !== "false" })
  })

  const workbenchChangePatch = Effect.fn("OpencodeXHttpApi.workbenchChangePatch")(function* (ctx: {
    query: typeof WorkbenchChangePatchQuery.Type
  }) {
    return yield* loadWorkbenchChangePatch(ctx.query)
  })

  const workbenchChangeMetricsPage = Effect.fn("OpencodeXHttpApi.workbenchChangeMetricsPage")(function* (ctx: {
    query: typeof WorkbenchChangeMetricsQuery.Type
  }) {
    return yield* loadWorkbenchChangeMetrics(ctx.query)
  })

  const workbenchChangePatchPage = Effect.fn("OpencodeXHttpApi.workbenchChangePatchPage")(function* (ctx: {
    query: typeof WorkbenchChangePatchPageQuery.Type
  }) {
    return yield* loadWorkbenchChangePatchPage(ctx.query)
  })

  const workbenchGitBranches = Effect.fn("OpencodeXHttpApi.workbenchGitBranches")(function* () {
    const cwd = workbenchCwd(yield* InstanceState.context)
    const [list, repository] = yield* Effect.all([
      runWorkbenchGit(cwd, ["branch", "--format=%(refname:short)"], 64 * 1024, "3 seconds"),
      loadWorkbenchRepositoryMetadata(cwd),
    ], { concurrency: 2 })
    if (list.exitCode !== 0) return { ok: false, message: list.stderr.toString("utf8").trim() || "Could not list branches.", branches: [] }
    return {
      ok: true,
      current: repository.branch,
      branches: list.stdout.toString("utf8").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      defaultBranch: repository.defaultBranch,
      upstream: repository.upstream,
      ahead: repository.ahead,
      behind: repository.behind,
      remoteUrl: repository.remoteUrl,
      githubUrl: repository.githubUrl,
    }
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
    const paths = gitPaths(ctx.payload.paths ?? [])
    const cwd = workbenchCwd(yield* InstanceState.context)
    if (ctx.payload.all) {
      const result = gitResult(yield* Effect.promise(() => gitRun(["add", "-A", "--", "."], cwd)))
      return gitOperationResult(result, "Staged all changes.")
    }
    if (paths.length === 0) return workbenchFailure("empty", "Choose at least one file.")
    const result = gitResult(yield* Effect.promise(() => gitRun(["--literal-pathspecs", "add", "--", ...paths], cwd)))
    return gitOperationResult(result, "Staged files.")
  })

  const workbenchGitUnstage = Effect.fn("OpencodeXHttpApi.workbenchGitUnstage")(function* (ctx: {
    payload: typeof WorkbenchGitPathsPayload.Type
  }) {
    const paths = gitPaths(ctx.payload.paths ?? [])
    if (paths.length === 0) return workbenchFailure("empty", "Choose at least one file.")
    const cwd = workbenchCwd(yield* InstanceState.context)
    const head = gitResult(yield* Effect.promise(() => gitRun(["rev-parse", "--verify", "HEAD"], cwd)))
    const result = gitResult(
      yield* Effect.promise(() =>
        gitRun(
          head.exitCode === 0
            ? ["--literal-pathspecs", "restore", "--staged", "--", ...paths]
            : ["--literal-pathspecs", "rm", "--cached", "--force", "--ignore-unmatch", "--", ...paths],
          cwd,
        ),
      ),
    )
    return gitOperationResult(result, "Unstaged files.")
  })

  const workbenchGitDiscard = Effect.fn("OpencodeXHttpApi.workbenchGitDiscard")(function* (ctx: {
    payload: typeof WorkbenchGitPathsPayload.Type
  }) {
    const paths = gitPaths(ctx.payload.paths ?? [])
    if (paths.length === 0) return workbenchFailure("empty", "Choose at least one file.")
    const cwd = workbenchCwd(yield* InstanceState.context)
    const tracked = gitResult(
      yield* Effect.promise(() => gitRun(["--literal-pathspecs", "ls-files", "--cached", "-z", "--", ...paths], cwd)),
    )
    if (tracked.exitCode !== 0) return gitOperationResult(tracked, "Discarded files.")
    const indexed = new Set(tracked.text().split("\0").filter(Boolean))
    const trackedPaths = paths.filter((item) => indexed.has(item))
    const untrackedPaths = paths.filter((item) => !indexed.has(item))
    if (trackedPaths.length > 0) {
      const restore = gitResult(
        yield* Effect.promise(() =>
          gitRun(["--literal-pathspecs", "restore", "--worktree", "--", ...trackedPaths], cwd),
        ),
      )
      if (restore.exitCode !== 0) return gitOperationResult(restore, "Discarded files.")
    }
    if (untrackedPaths.length === 0) return workbenchSuccess("Discarded files.")
    return gitOperationResult(
      gitResult(
        yield* Effect.promise(() => gitRun(["--literal-pathspecs", "clean", "-f", "--", ...untrackedPaths], cwd)),
      ),
      "Discarded files.",
    )
  })

  const workbenchGitCommit = Effect.fn("OpencodeXHttpApi.workbenchGitCommit")(function* (ctx: {
    payload: typeof WorkbenchGitCommitPayload.Type
  }) {
    const message = ctx.payload.message.trim()
    if (!message) return workbenchFailure("empty", "Commit message is required.")
    const paths = ctx.payload.paths === undefined ? undefined : gitPaths(ctx.payload.paths)
    if (ctx.payload.paths !== undefined && paths?.length === 0)
      return workbenchFailure("empty", "Choose at least one file.")
    const body = ctx.payload.body?.trim()
    const cwd = workbenchCwd(yield* InstanceState.context)
    const result = gitResult(
      yield* Effect.promise(() =>
        gitRun(
          [
            ...(paths ? ["--literal-pathspecs"] : []),
            "commit",
            "--no-gpg-sign",
            "-m",
            message,
            ...(body ? ["-m", body] : []),
            ...(paths ? ["--only", "--", ...paths] : []),
          ],
          cwd,
        ),
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
    workbenchChanges,
    workbenchChangePatch,
    workbenchChangeMetricsPage,
    workbenchChangePatchPage,
    workbenchGitBranches,
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

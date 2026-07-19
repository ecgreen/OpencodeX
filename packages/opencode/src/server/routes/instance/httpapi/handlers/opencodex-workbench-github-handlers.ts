import { InstanceState } from "@/effect/instance-state"
import { Effect } from "effect"
import { WorkbenchGithubCreatePullPayload, WorkbenchGithubPullPayload } from "../groups/opencodex"
import {
  gitBranch,
  gitDefaultBranch,
  gitHubRepository,
  githubApiData,
  githubIssueRows,
  githubPullRows,
  gitOperationResult,
  gitRemoteUrl,
  gitResult,
  gitRun,
  workbenchCwd,
  workbenchFailure,
} from "./opencodex-workbench-common"

export function makeOpencodeXWorkbenchGithubHandlers() {
  const workbenchGithubAuth = Effect.fn("OpencodeXHttpApi.workbenchGithubAuth")(function* () {
    const cwd = workbenchCwd(yield* InstanceState.context)
    const remoteUrl = yield* Effect.promise(() => gitRemoteUrl(cwd))
    const repository = gitHubRepository(remoteUrl)
    if (!repository) return { ok: false, message: "No GitHub origin remote found. Local Git features are still available." }
    return { ok: true, data: { mode: "git-remote", repository: repository.webUrl, remoteUrl } }
  })

  const workbenchGithubRepo = Effect.fn("OpencodeXHttpApi.workbenchGithubRepo")(function* () {
    const cwd = workbenchCwd(yield* InstanceState.context)
    const result = yield* Effect.promise(() => githubApiData(cwd, ""))
    if (!result.ok) return result
    const data = isRecord(result.data) ? result.data : {}
    return {
      ok: true,
      data: {
        nameWithOwner: data.full_name,
        url: data.html_url,
        defaultBranchRef: typeof data.default_branch === "string" ? { name: data.default_branch } : undefined,
      },
    }
  })

  const workbenchGithubIssues = Effect.fn("OpencodeXHttpApi.workbenchGithubIssues")(function* () {
    const cwd = workbenchCwd(yield* InstanceState.context)
    const result = yield* Effect.promise(() => githubApiData(cwd, "/issues?state=open&per_page=30"))
    if (!result.ok) return result
    return { ok: true, data: githubIssueRows(result.data) }
  })

  const workbenchGithubPulls = Effect.fn("OpencodeXHttpApi.workbenchGithubPulls")(function* () {
    const cwd = workbenchCwd(yield* InstanceState.context)
    const result = yield* Effect.promise(() => githubApiData(cwd, "/pulls?state=open&per_page=30"))
    if (!result.ok) return result
    return { ok: true, data: githubPullRows(result.data) }
  })

  const workbenchGithubPull = Effect.fn("OpencodeXHttpApi.workbenchGithubPull")(function* (ctx: {
    payload: typeof WorkbenchGithubPullPayload.Type
  }) {
    if (!validPullNumber(ctx.payload.number)) return { ok: false, message: "Pull request number is required." }
    const cwd = workbenchCwd(yield* InstanceState.context)
    const result = yield* Effect.promise(() => githubApiData(cwd, `/pulls/${ctx.payload.number}`))
    if (!result.ok) return result
    return { ok: true, data: githubPullRows([result.data])[0] ?? result.data }
  })

  const workbenchGithubChecks = Effect.fn("OpencodeXHttpApi.workbenchGithubChecks")(function* (ctx: {
    payload: typeof WorkbenchGithubPullPayload.Type
  }) {
    if (!validPullNumber(ctx.payload.number)) return { ok: false, message: "Pull request number is required." }
    const cwd = workbenchCwd(yield* InstanceState.context)
    const pull = yield* Effect.promise(() => githubApiData(cwd, `/pulls/${ctx.payload.number}`))
    if (!pull.ok) return pull
    const head = isRecord(pull.data) && isRecord(pull.data.head) ? pull.data.head : {}
    if (typeof head.sha !== "string") return { ok: false, message: "Could not find the pull request head commit." }
    return yield* Effect.promise(() => githubApiData(cwd, `/commits/${head.sha}/check-runs`))
  })

  const workbenchGithubCheckoutPull = Effect.fn("OpencodeXHttpApi.workbenchGithubCheckoutPull")(function* (ctx: {
    payload: typeof WorkbenchGithubPullPayload.Type
  }) {
    if (!validPullNumber(ctx.payload.number)) return workbenchFailure("invalid_pull", "Pull request number is required.")
    const cwd = workbenchCwd(yield* InstanceState.context)
    if (!gitHubRepository(yield* Effect.promise(() => gitRemoteUrl(cwd)))) {
      return workbenchFailure("no_github_remote", "Add a GitHub origin remote to checkout pull requests with Git.")
    }
    const branch = `pr-${ctx.payload.number}`
    const fetch = gitResult(
      yield* Effect.promise(() => gitRun(["fetch", "origin", `pull/${ctx.payload.number}/head:${branch}`], cwd)),
    )
    if (fetch.exitCode !== 0) return gitOperationResult(fetch, "Fetched pull request.")
    return gitOperationResult(
      gitResult(yield* Effect.promise(() => gitRun(["checkout", branch], cwd))),
      `Checked out pull request #${ctx.payload.number}.`,
    )
  })

  const workbenchGithubCreatePull = Effect.fn("OpencodeXHttpApi.workbenchGithubCreatePull")(function* (ctx: {
    payload: typeof WorkbenchGithubCreatePullPayload.Type
  }) {
    const title = ctx.payload.title.trim()
    if (!title) return { ok: false, message: "Pull request title is required." }
    const cwd = workbenchCwd(yield* InstanceState.context)
    const repository = gitHubRepository(yield* Effect.promise(() => gitRemoteUrl(cwd)))
    if (!repository) return { ok: false, message: "Add a GitHub origin remote to create pull requests." }
    const current = yield* Effect.promise(() => gitBranch(cwd))
    const base = ctx.payload.base ?? (yield* Effect.promise(() => gitDefaultBranch(cwd))) ?? "main"
    const head = ctx.payload.head ?? current
    return {
      ok: true,
      message: "Open this URL in your browser to create the pull request.",
      data: {
        title,
        url: head
          ? `${repository.webUrl}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?quick_pull=1`
          : `${repository.webUrl}/compare`,
      },
    }
  })

  return {
    workbenchGithubAuth,
    workbenchGithubRepo,
    workbenchGithubIssues,
    workbenchGithubPulls,
    workbenchGithubPull,
    workbenchGithubChecks,
    workbenchGithubCheckoutPull,
    workbenchGithubCreatePull,
  }
}

function validPullNumber(value: number) {
  return Number.isInteger(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

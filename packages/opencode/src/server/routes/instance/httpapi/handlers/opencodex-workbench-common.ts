import { containsPath, type InstanceContext } from "@/project/instance-context"
import { errorMessage } from "@/util/error"
import { Process } from "@/util/process"
import path from "path"

const gitBaseArgs = [
  "--no-optional-locks",
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.longpaths=true",
  "-c",
  "core.symlinks=true",
  "-c",
  "core.quotepath=false",
] as const

export function workbenchPath(input: string, instance: InstanceContext) {
  const resolved = path.resolve(path.isAbsolute(input) ? input : path.join(instance.directory, input))
  if (!containsPath(resolved, instance)) return
  return resolved
}

export function workbenchCwd(instance: InstanceContext) {
  if (instance.worktree !== "/") return instance.worktree
  return instance.directory
}

export function workbenchFailure(reason: string, message: string, content?: string) {
  return { ok: false, reason, message, content }
}

export function workbenchSuccess(message?: string) {
  return { ok: true, message }
}

export function binaryText(value: string) {
  return value.includes("\0")
}

export function branchNameValid(value: string) {
  const branch = value.trim()
  if (!branch || branch.startsWith("-") || branch.includes("..") || branch.includes("@{")) return false
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)
}

export function gitPaths(input: readonly string[]) {
  return input.map((item) => item.trim()).filter((item) => item && !item.startsWith("-"))
}

export async function gitRun(args: string[], cwd: string) {
  return Process.text(["git", ...gitBaseArgs, ...args], { cwd, nothrow: true })
}

export async function workbenchRunCommand(args: string[], cwd: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    return await Process.run(args, { cwd, nothrow: true, abort: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export function gitResult(result: { code: number; text: string; stderr: Buffer }) {
  return { exitCode: result.code, stderr: result.stderr, text: () => result.text }
}

export async function gitBranch(cwd: string) {
  const result = await gitRun(["branch", "--show-current"], cwd)
  if (result.code !== 0) return undefined
  return result.text.trim() || undefined
}

export async function gitDefaultBranch(cwd: string) {
  const result = await gitRun(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], cwd)
  if (result.code !== 0) return undefined
  const branch = result.text.trim()
  if (!branch) return undefined
  return branch.startsWith("origin/") ? branch.slice("origin/".length) : branch
}

export async function gitRemoteUrl(cwd: string) {
  const result = await gitRun(["remote", "get-url", "origin"], cwd)
  if (result.code !== 0) return undefined
  return result.text.trim() || undefined
}

export async function gitTracking(cwd: string) {
  const upstreamResult = await gitRun(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd)
  if (upstreamResult.code !== 0) return {}
  const upstream = upstreamResult.text.trim()
  if (!upstream) return {}
  const count = await gitRun(["rev-list", "--left-right", "--count", "HEAD...@{u}"], cwd)
  if (count.code !== 0) return { upstream }
  const values = count.text.trim().split(/\s+/)
  return { upstream, ahead: Number(values[0]) || 0, behind: Number(values[1]) || 0 }
}

export function gitHubWebUrl(remoteUrl: string | undefined) {
  if (!remoteUrl) return undefined
  if (remoteUrl.startsWith("https://github.com/")) return remoteUrl.replace(/\.git$/, "")
  if (remoteUrl.startsWith("http://github.com/")) return remoteUrl.replace(/^http:/, "https:").replace(/\.git$/, "")
  const ssh = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/.exec(remoteUrl)
  if (ssh) return `https://github.com/${ssh[1]}`
  const sshUrl = /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(remoteUrl)
  if (sshUrl) return `https://github.com/${sshUrl[1]}`
  return undefined
}

export function gitHubRepository(remoteUrl: string | undefined) {
  const webUrl = gitHubWebUrl(remoteUrl)
  if (!webUrl) return undefined
  const url = new URL(webUrl)
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/")
  if (parts.length !== 2) return undefined
  return { owner: parts[0], repo: parts[1], webUrl }
}

export function gitMessage(result: { text(): string; stderr: Buffer }) {
  return result.stderr.toString("utf8").trim() || result.text().trim()
}

export function gitOperationResult(result: { exitCode: number; text(): string; stderr: Buffer }, success: string) {
  if (result.exitCode === 0) return workbenchSuccess(success)
  return workbenchFailure("git_failed", gitMessage(result) || "Git command failed.")
}

export function parseGitStatus(text: string) {
  return text
    .split("\0")
    .filter(Boolean)
    .flatMap((item) => {
      const code = item.slice(0, 2)
      const file = item.slice(3)
      if (!file) return []
      return [
        {
          path: file,
          code,
          status: code === "??" ? "added" : code.includes("D") ? "deleted" : code.includes("A") ? "added" : "modified",
          staged: code !== "??" && code[0] !== " " && code[0] !== "?",
          unstaged: code === "??" || (code[1] !== " " && code[1] !== "?"),
          untracked: code === "??",
        },
      ]
    })
}

export function parseGitStashes(text: string) {
  return text
    .split("\x1e")
    .filter(Boolean)
    .flatMap((item) => {
      const [ref, hash, age, ...messageParts] = item.split("\0")
      if (!ref) return []
      return [{ ref, hash, age, message: messageParts.join("\0") }]
    })
}

export function stashRefValid(ref: string) {
  return /^stash@\{\d+\}$/.test(ref.trim())
}

export async function githubApiData(cwd: string, resource: string) {
  const repository = gitHubRepository(await gitRemoteUrl(cwd))
  if (!repository) {
    return {
      ok: false as const,
      message: "Add a GitHub origin remote to enable GitHub repository data. Local Git features are still available.",
    }
  }
  return fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}${resource}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "OpencodeX-Workbench" },
  })
    .then(async (response) => {
      if (!response.ok) {
        return {
          ok: false as const,
          message:
            response.status === 404 || response.status === 401 || response.status === 403
              ? "GitHub did not allow API access for this repository. Browser links still work, and private repositories can use your normal browser login."
              : `GitHub returned HTTP ${response.status}.`,
        }
      }
      return { ok: true as const, data: await response.json() }
    })
    .catch((error) => ({
      ok: false as const,
      message: errorMessage(error) || "Could not reach GitHub. Browser links and local Git operations are still available.",
    }))
}

export function githubIssueRows(data: unknown) {
  if (!Array.isArray(data)) return []
  return data
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !("pull_request" in item))
    .map((item) => ({
      number: item.number,
      title: item.title,
      state: item.state,
      author: githubUser(item.user),
      updatedAt: item.updated_at,
      labels: item.labels,
      url: item.html_url,
    }))
}

export function githubPullRows(data: unknown) {
  if (!Array.isArray(data)) return []
  return data
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      number: item.number,
      title: item.title,
      state: item.state,
      author: githubUser(item.user),
      updatedAt: item.updated_at,
      headRefName: githubRefName(item.head),
      baseRefName: githubRefName(item.base),
      url: item.html_url,
    }))
}

function githubUser(input: unknown) {
  if (typeof input !== "object" || input === null || !("login" in input)) return undefined
  return { login: String(input.login) }
}

function githubRefName(input: unknown) {
  if (typeof input !== "object" || input === null || !("ref" in input)) return undefined
  return String(input.ref)
}

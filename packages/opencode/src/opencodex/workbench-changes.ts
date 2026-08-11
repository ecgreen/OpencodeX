import { InstanceState } from "@/effect/instance-state"
import { File } from "@/file"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { AppProcess } from "@opencode-ai/core/process"
import { Duration, Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import path from "path"
import {
  decodeWorkbenchCursor,
  encodeWorkbenchCursor,
  findWorkbenchSnapshot,
  acquireWorkbenchSnapshotLock,
  latestWorkbenchSnapshot,
  rememberWorkbenchSnapshot,
  workbenchChangeSummary,
  type WorkbenchChangeFile,
  type WorkbenchChangeSnapshot,
  type WorkbenchRepositoryMetadata,
} from "./workbench-change-snapshot"

const DEFAULT_PAGE_SIZE = 100
const METRIC_PAGE_SIZE = 32
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
const MAX_ERROR_BYTES = 64 * 1024
const SNAPSHOT_TIMEOUT = "30 seconds"
const METADATA_TIMEOUT = "3 seconds"
export const WORKBENCH_PATCH_PAGE_BYTES = 256 * 1024
export const gitBaseArgs = [
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
]

export const listWorkbenchChanges = Effect.fn("WorkbenchChanges.list")(function* (input: {
  path?: string
  cursor?: string
  revision?: string
  limit?: number
  metadata?: boolean
}) {
  const instance = yield* InstanceState.context
  const prefix = normalizeRelative(input.path ?? "")
  const cursor = decodeWorkbenchCursor(input.cursor)
  const requestedRevision = input.revision ?? cursor?.revision
  const cached = requestedRevision ? findWorkbenchSnapshot(instance.directory, requestedRevision) : undefined
  const created = cached || requestedRevision ? undefined : yield* createSharedWorkbenchSnapshot(instance.directory).pipe(
    Effect.map((snapshot) => ({ ok: true as const, snapshot })),
    Effect.timeoutOrElse({
      duration: SNAPSHOT_TIMEOUT,
      orElse: () => Effect.succeed({ ok: false as const, message: "Reading project changes timed out. Retry when the workspace is less busy." }),
    }),
    Effect.catch((cause) => Effect.succeed({
      ok: false as const,
      message: cause instanceof Error ? cause.message : "Unable to read project changes.",
    })),
  )
  const snapshot = cached ?? (created?.ok ? created.snapshot : undefined)
  if (!snapshot || cursor && cursor.revision !== snapshot.revision) {
    return {
      ok: false,
      stale: Boolean(requestedRevision),
      mode: "git" as const,
      revision: requestedRevision ?? "",
      path: prefix,
      items: [],
      summary: emptySummary(),
      message: created && !created.ok ? created.message : "The change snapshot is stale. Refresh to continue.",
    }
  }
  if (cursor?.path !== undefined && cursor.path !== prefix) {
    return {
      ok: false,
      stale: true,
      mode: snapshot.mode,
      revision: snapshot.revision,
      path: prefix,
      items: [],
      summary: workbenchChangeSummary(snapshot),
      message: "The change page cursor does not match this path.",
    }
  }
  const repository = input.metadata && !requestedRevision && snapshot.mode === "git"
    ? yield* loadWorkbenchRepositoryMetadata(snapshot.directory)
    : snapshot.repository
  if (input.metadata) Object.assign(snapshot.repository, repository)

  const filtered = prefix
    ? snapshot.files.filter((file) => file.path === prefix || file.path.startsWith(`${prefix}/`))
    : snapshot.files
  const index = cursor?.index ?? 0
  const limit = input.limit ?? DEFAULT_PAGE_SIZE
  const items = filtered.slice(index, index + limit)
  return {
    ok: true,
    stale: false,
    mode: snapshot.mode,
    revision: snapshot.revision,
    path: prefix,
    items,
    summary: workbenchChangeSummary(snapshot),
    ...(index + items.length < filtered.length
      ? { next: encodeWorkbenchCursor({ revision: snapshot.revision, path: prefix, index: index + items.length }) }
      : {}),
    ...repository,
    ...(snapshot.message ? { message: snapshot.message } : {}),
  }
})

export const loadWorkbenchChangeMetrics = Effect.fn("WorkbenchChanges.metrics")(function* (input: {
  revision: string
  path?: string
  cursor?: string
  limit?: number
}) {
  const instance = yield* InstanceState.context
  const snapshot = findWorkbenchSnapshot(instance.directory, input.revision)
  const cursor = decodeWorkbenchCursor(input.cursor)
  if (!snapshot || cursor && cursor.revision !== input.revision) return staleMetrics(input.revision)
  const index = cursor?.index ?? 0
  const batch = input.path === undefined
    ? snapshot.files.slice(index, index + Math.min(input.limit ?? METRIC_PAGE_SIZE, METRIC_PAGE_SIZE))
    : snapshot.files.filter((file) => file.path === input.path)
  const unresolved = batch.filter((file) => file.binary === undefined && (file.additions === undefined || file.deletions === undefined))
  const measured = snapshot.mode === "git"
    ? yield* measureGitFiles(snapshot, unresolved)
    : yield* measureTextFiles(snapshot, unresolved)
  if (!measured.ok) {
    return {
      ok: false,
      stale: measured.stale,
      revision: snapshot.revision,
      items: [],
      summary: workbenchChangeSummary(snapshot),
      message: measured.message,
    }
  }

  measured.items.forEach((metric) => {
    const file = snapshot.files.find((item) => item.path === metric.path)
    if (!file) return
    file.additions = metric.additions
    file.deletions = metric.deletions
    file.binary = metric.binary
  })
  const items = batch.flatMap((file) => file.binary === undefined || file.additions === undefined || file.deletions === undefined
    ? []
    : [{ path: file.path, additions: file.additions, deletions: file.deletions, binary: file.binary }])
  return {
    ok: true,
    stale: false,
    revision: snapshot.revision,
    items,
    summary: workbenchChangeSummary(snapshot),
    ...(input.path === undefined && index + batch.length < snapshot.files.length
      ? { next: encodeWorkbenchCursor({ revision: snapshot.revision, index: index + batch.length }) }
      : {}),
  }
})

export const workbenchMode = Effect.fn("WorkbenchChanges.mode")(function* (cwd: string) {
  const result = yield* runWorkbenchGit(cwd, ["rev-parse", "--is-inside-work-tree"], 4096)
  if (result.exitCode === 0) return result.stdout.toString("utf8").trim() === "true"
    ? { mode: "git" as const }
    : { mode: "directory" as const }
  if (result.exitCode === 128 || result.exitCode === -1) return { mode: "directory" as const }
  return { mode: "error" as const, message: result.stderr.toString("utf8").trim() || "Unable to determine repository state." }
})

export const runWorkbenchGit = Effect.fn("WorkbenchChanges.git")(function* (
  cwd: string,
  args: string[],
  maxOutputBytes?: number,
  timeout: Duration.Input = "30 seconds",
) {
  const appProcess = yield* AppProcess.Service
  return yield* appProcess.run(
    ChildProcess.make("git", [...gitBaseArgs, "--literal-pathspecs", ...args], {
      cwd,
      extendEnv: true,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    }),
    {
      ...(maxOutputBytes === undefined ? {} : { maxOutputBytes }),
      maxErrorBytes: MAX_ERROR_BYTES,
      timeout,
    },
  ).pipe(Effect.catch((cause) => Effect.succeed({
    command: "git",
    exitCode: -1,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(cause.message),
    stdoutTruncated: false,
    stderrTruncated: false,
  })))
})

export const createWorkbenchSnapshot = Effect.fnUntraced(function* () {
  const instance = yield* InstanceState.context
  const result = yield* workbenchMode(instance.directory)
  if (result.mode === "error") return yield* Effect.fail(new Error(result.message))
  const snapshot = result.mode === "git"
    ? yield* createGitSnapshot(instance.directory)
    : yield* createDirectorySnapshot(instance.directory)
  return rememberWorkbenchSnapshot(snapshot)
})

const createSharedWorkbenchSnapshot = Effect.fnUntraced(function* (directory: string) {
  const previousRevision = latestWorkbenchSnapshot(directory)?.revision
  const lock = acquireWorkbenchSnapshotLock(directory)
  return yield* lock.semaphore.withPermits(1)(Effect.gen(function* () {
    const concurrent = latestWorkbenchSnapshot(directory)
    if (concurrent && concurrent.revision !== previousRevision) return concurrent
    return yield* createWorkbenchSnapshot()
  })).pipe(Effect.ensuring(Effect.sync(lock.release)))
})

const createGitSnapshot = Effect.fn("WorkbenchChanges.gitSnapshot")(function* (directory: string) {
  const [status, baselineResult] = yield* Effect.all([
    runWorkbenchGit(directory, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--no-renames",
      "--",
      ".",
    ]),
    runWorkbenchGit(directory, ["rev-parse", "--verify", "HEAD^{tree}"], 4096),
  ], { concurrency: 2 })
  if (status.exitCode !== 0 || status.stdoutTruncated) {
    return yield* Effect.fail(new Error(status.stderr.toString("utf8").trim() || "Unable to read Git changes."))
  }
  const files = yield* validateOpenableFiles(directory, status.stdout.toString("utf8").split("\0").flatMap(changeFromStatus))
  return {
    directory,
    revision: crypto.randomUUID(),
    createdAt: Date.now(),
    mode: "git",
    baseline: gitOutput(baselineResult) ?? EMPTY_TREE,
    files: files.toSorted((left, right) => left.path.localeCompare(right.path)),
    repository: {},
    patches: new Map(),
  } satisfies WorkbenchChangeSnapshot
})

const createDirectorySnapshot = Effect.fnUntraced(function* (directory: string) {
  const files = yield* File.Service
  const paths = (yield* files.search({ query: "", type: "file", limit: Number.MAX_SAFE_INTEGER }))
    .map(normalizeRelative)
    .filter(Boolean)
    .toSorted()
  return {
    directory,
    revision: crypto.randomUUID(),
    createdAt: Date.now(),
    mode: "directory",
    files: yield* validateOpenableFiles(directory, paths.map((file): WorkbenchChangeFile => ({
      type: "file",
      name: file.split("/").at(-1) ?? file,
      path: file,
      status: "added",
      staged: false,
      unstaged: false,
      untracked: true,
      openable: true,
    }))),
    repository: {},
    message: "No Git repository found. Project files are shown as additions until Git is initialized.",
    patches: new Map(),
  } satisfies WorkbenchChangeSnapshot
})

const validateOpenableFiles = Effect.fn("WorkbenchChanges.validate")(function* (directory: string, files: WorkbenchChangeFile[]) {
  const fs = yield* AppFileSystem.Service
  return (yield* Effect.all(files.map((file) => Effect.gen(function* () {
    if (file.status === "deleted") return { ...file, openable: false }
    const target = path.resolve(directory, file.path)
    if (!AppFileSystem.contains(directory, target) || !(yield* fs.isFile(target))) return
    const real = yield* fs.realPath(target).pipe(Effect.catch(() => Effect.succeed("")))
    if (!real || !AppFileSystem.contains(directory, real)) return
    return { ...file, openable: true }
  })), { concurrency: 16 })).filter((file): file is WorkbenchChangeFile => file !== undefined)
})

const measureGitFiles = Effect.fnUntraced(function* (snapshot: WorkbenchChangeSnapshot, files: WorkbenchChangeFile[]) {
  const tracked = files.filter((file) => !file.untracked)
  const untracked = files.filter((file) => file.untracked)
  const result = tracked.length === 0
    ? undefined
    : yield* runWorkbenchGit(snapshot.directory, [
        "diff",
        snapshot.baseline ?? EMPTY_TREE,
        "--numstat",
        "-z",
        "--no-renames",
        "--",
        ...tracked.map((file) => file.path),
      ])
  if (result && (result.exitCode !== 0 || result.stdoutTruncated)) {
    return { ok: false as const, stale: false, message: result.stderr.toString("utf8").trim() || "Unable to measure Git changes." }
  }
  const metrics = result ? parseNumstat(result.stdout.toString("utf8")) : []
  if (tracked.some((file) => !metrics.some((metric) => metric.path === file.path))) {
    return { ok: false as const, stale: true, message: "A changed path disappeared. Refreshing is required." }
  }
  const streamed = yield* measureTextFiles(snapshot, untracked)
  if (!streamed.ok) return streamed
  return { ok: true as const, items: [...metrics, ...streamed.items] }
})

const measureTextFiles = Effect.fnUntraced(function* (snapshot: WorkbenchChangeSnapshot, files: WorkbenchChangeFile[]) {
  const fs = yield* AppFileSystem.Service
  const measured = yield* Effect.all(files.map((file) => Effect.gen(function* () {
    const target = path.resolve(snapshot.directory, file.path)
    if (!file.openable || !(yield* fs.isFile(target))) return
    const value = yield* fs.stream(target, { chunkSize: 64 * 1024 }).pipe(
      Stream.runFold(() => ({ lines: 0, bytes: 0, last: -1, binary: false }), (state, chunk) => ({
        lines: state.lines + chunk.reduce((count, byte) => count + Number(byte === 10), 0),
        bytes: state.bytes + chunk.byteLength,
        last: chunk.at(-1) ?? state.last,
        binary: state.binary || chunk.includes(0),
      })),
      Effect.catch(() => Effect.succeed(undefined)),
    )
    if (!value) return
    return {
      path: file.path,
      additions: value.binary ? 0 : value.lines + Number(value.bytes > 0 && value.last !== 10),
      deletions: 0,
      binary: value.binary,
    }
  })), { concurrency: 4 })
  if (measured.some((item) => item === undefined)) {
    return { ok: false as const, stale: true, message: "A changed path disappeared. Refreshing is required." }
  }
  return { ok: true as const, items: measured.filter((item): item is NonNullable<typeof item> => item !== undefined) }
})

export const loadWorkbenchRepositoryMetadata = Effect.fn("WorkbenchChanges.metadata")(function* (cwd: string) {
  const [branchResult, defaultResult, remoteResult, upstreamResult] = yield* Effect.all([
    runWorkbenchGit(cwd, ["branch", "--show-current"], 4096, METADATA_TIMEOUT),
    runWorkbenchGit(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], 4096, METADATA_TIMEOUT),
    runWorkbenchGit(cwd, ["remote", "get-url", "origin"], 16 * 1024, METADATA_TIMEOUT),
    runWorkbenchGit(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], 4096, METADATA_TIMEOUT),
  ], { concurrency: 4 })
  const branch = gitOutput(branchResult)
  const remoteUrl = gitOutput(remoteResult)
  const upstream = gitOutput(upstreamResult)
  const counts = upstream ? yield* runWorkbenchGit(cwd, ["rev-list", "--left-right", "--count", "HEAD...@{u}"], 4096, METADATA_TIMEOUT) : undefined
  const values = counts ? gitOutput(counts)?.split(/\s+/) : undefined
  const defaultBranch = gitOutput(defaultResult)?.replace(/^origin\//, "")
  return {
    ...(branch ? { branch } : {}),
    ...(defaultBranch ? { defaultBranch } : {}),
    ...(upstream ? { upstream } : {}),
    ...(values ? { ahead: Number(values[0]) || 0, behind: Number(values[1]) || 0 } : {}),
    ...(remoteUrl ? { remoteUrl, githubUrl: githubWebUrl(remoteUrl) } : {}),
  } satisfies WorkbenchRepositoryMetadata
})

function changeFromStatus(record: string): WorkbenchChangeFile[] {
  if (record.length < 4) return []
  const code = record.slice(0, 2)
  const file = normalizeRelative(record.slice(3))
  if (!file || file.split("/").includes("..")) return []
  return [{
    type: "file",
    name: file.split("/").at(-1) ?? file,
    path: file,
    status: changeStatus(code),
    staged: code !== "??" && code[0] !== " " && code[0] !== "?",
    unstaged: code === "??" || code[1] !== " " && code[1] !== "?",
    untracked: code === "??",
    openable: code !== " D" && code !== "D ",
  }]
}

function parseNumstat(output: string) {
  return output.split("\0").flatMap((record) => {
    if (!record) return []
    const first = record.indexOf("\t")
    const second = record.indexOf("\t", first + 1)
    if (first < 0 || second < 0) return []
    const additions = record.slice(0, first)
    const deletions = record.slice(first + 1, second)
    return [{
      path: normalizeRelative(record.slice(second + 1)),
      additions: additions === "-" ? 0 : Number(additions) || 0,
      deletions: deletions === "-" ? 0 : Number(deletions) || 0,
      binary: additions === "-" || deletions === "-",
    }]
  })
}

function changeStatus(code: string): WorkbenchChangeFile["status"] {
  if (code === "??" || code.includes("A") && !code.includes("D")) return "added"
  if (code.includes("D") && !code.includes("A")) return "deleted"
  return "modified"
}

function gitOutput(result: { exitCode: number; stdout: Buffer; stdoutTruncated: boolean }) {
  if (result.exitCode !== 0 || result.stdoutTruncated) return
  return result.stdout.toString("utf8").trim() || undefined
}

function githubWebUrl(remoteUrl: string) {
  if (remoteUrl.startsWith("https://github.com/")) return remoteUrl.replace(/\.git$/, "")
  if (remoteUrl.startsWith("http://github.com/")) return remoteUrl.replace(/^http:/, "https:").replace(/\.git$/, "")
  const ssh = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/.exec(remoteUrl)
  if (ssh) return `https://github.com/${ssh[1]}`
  const sshUrl = /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(remoteUrl)
  return sshUrl ? `https://github.com/${sshUrl[1]}` : undefined
}

export function normalizeRelative(value: string) {
  return value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "")
}

function staleMetrics(revision: string) {
  return {
    ok: false,
    stale: true,
    revision,
    items: [],
    summary: emptySummary(),
    message: "The change snapshot is stale. Refresh to continue.",
  }
}

function emptySummary() {
  return { fileCount: 0, additions: 0, deletions: 0, metricsResolved: 0, metricsTotal: 0, metricsComplete: true }
}

export { loadWorkbenchChangePatch } from "./workbench-change-patch"

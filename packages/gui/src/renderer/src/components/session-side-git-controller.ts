import type { FileNode } from "@opencode-ai/sdk/v2/client"
import { createSignal } from "solid-js"
import type { GuiClient } from "../lib/client"
import {
  listWorkbenchFiles,
  readWorkbenchFile,
  workbenchGitBranches,
  workbenchGitDiff,
  workbenchGitStatus,
  type DiffFile,
  type WorkbenchDataResult,
  type WorkbenchGitBranches,
  type WorkbenchGitStatus,
} from "../lib/store"
import { normalizeRoot, sidePanelPathKey } from "./session-side-path"

const STATUS_CHECK_MS = 5_000
const FULL_REFRESH_MS = 30_000
const FALLBACK_REFRESH_MS = 120_000
const MAX_CACHE_ENTRIES = 12
export const SIDE_PANEL_GIT_VISIBLE_RECHECK_MS = 6_000

export type SidePanelGitResult = {
  diff: WorkbenchDataResult<DiffFile[]>
  status?: WorkbenchGitStatus
  branches?: WorkbenchGitBranches
  fallback?: "project-files"
}

type CacheEntry = {
  result: SidePanelGitResult
  loadedAt: number
  statusCheckedAt: number
  statusSignature: string
}

const cache = new Map<string, CacheEntry>()
const requests = new Map<string, Promise<SidePanelGitResult>>()
const statusRequests = new Map<string, Promise<WorkbenchGitStatus | undefined>>()
export const [sidePanelGitCacheVersions, setSidePanelGitCacheVersions] = createSignal<Record<string, number>>({})

export function loadCachedSidePanelGit(input: { key: string; gui?: GuiClient; directory?: string }, force = false) {
  if (!force) {
    const cached = cache.get(input.key)
    if (cached) {
      void refreshSidePanelGitIfStale(input)
      return cached.result
    }
    const pending = requests.get(input.key)
    if (pending) return pending
  }
  requests.delete(input.key)
  const request = loadSidePanelGit(input)
    .then((result) => {
      if (requests.get(input.key) === request) writeCache(input.key, result)
      return result
    })
    .finally(() => {
      if (requests.get(input.key) === request) requests.delete(input.key)
    })
  requests.set(input.key, request)
  return request
}

export async function refreshSidePanelGitIfStale(input: { key: string; gui?: GuiClient; directory?: string }) {
  const gui = input.gui
  if (!gui) return
  const cached = cache.get(input.key)
  if (!cached) {
    await loadCachedSidePanelGit(input)
    return
  }
  const now = Date.now()
  const fullRefreshMs = cached.result.fallback === "project-files" ? FALLBACK_REFRESH_MS : FULL_REFRESH_MS
  if (now - cached.loadedAt >= fullRefreshMs) {
    await loadCachedSidePanelGit(input, true)
    return
  }
  if (cached.result.fallback === "project-files" || now - cached.statusCheckedAt < STATUS_CHECK_MS) return
  const status = await loadStatus({ key: input.key, gui, directory: input.directory })
  const latest = cache.get(input.key)
  if (!latest) return
  latest.statusCheckedAt = Date.now()
  if (statusSignature(status) === latest.statusSignature) return
  await loadCachedSidePanelGit(input, true)
}

export function sidePanelGitCacheKey(gui: GuiClient | undefined, directory: string | undefined) {
  return `${gui?.url ?? "no-gui"}\n${normalizeRoot(directory ?? gui?.directory ?? "")}`
}

export function resourceGitCacheKey(value: string) {
  const index = value.indexOf("\u0000")
  return index >= 0 ? value.slice(index + 1) : value
}

export function sidePanelGitResultForKey<T>(key: string, loaded?: { key: string; result: T }) {
  return loaded?.key === key ? loaded.result : undefined
}

export function normalizeSidePanelDiffs(files: DiffFile[]) {
  return files.flatMap((file) => file.file
    ? [{ file: file.file, patch: file.patch, additions: file.additions, deletions: file.deletions, status: file.status ?? "modified" }]
    : [])
}

export function sidePanelDiffForPath(files: DiffFile[], path: string) {
  const key = sidePanelPathKey(path)
  return files.find((file) => sidePanelPathKey(file.file ?? "") === key)
    ?? files.find((file) => {
      const fileKey = sidePanelPathKey(file.file ?? "")
      return key.endsWith(`/${fileKey}`) || fileKey.endsWith(`/${key}`)
    })
}

async function loadSidePanelGit(input: { gui?: GuiClient; directory?: string }): Promise<SidePanelGitResult> {
  if (!input.gui) return {
    diff: { ok: false, message: "GUI client is not ready.", data: [] as DiffFile[] },
    status: undefined,
    branches: undefined,
  }
  const [diff, status, branches] = await Promise.all([
    workbenchGitDiff(input.gui, input.directory),
    workbenchGitStatus(input.gui, input.directory).catch(() => undefined),
    workbenchGitBranches(input.gui, input.directory).catch(() => undefined),
  ])
  if (diff.ok !== false || !isNonGitMessage(diff.message)) return { diff, status, branches }
  return {
    diff: {
      ok: true,
      message: "No Git repository found. Showing project files as added.",
      data: await projectFilesAsAddedDiffs(input.gui, input.directory),
    },
    status,
    branches,
    fallback: "project-files",
  }
}

function writeCache(key: string, result: SidePanelGitResult) {
  cache.set(key, {
    result,
    loadedAt: Date.now(),
    statusCheckedAt: Date.now(),
    statusSignature: statusSignature(result.status),
  })
  if (cache.size > MAX_CACHE_ENTRIES) {
    Array.from(cache.entries())
      .toSorted((left, right) => left[1].loadedAt - right[1].loadedAt)
      .slice(0, cache.size - MAX_CACHE_ENTRIES)
      .forEach(([entry]) => cache.delete(entry))
  }
  setSidePanelGitCacheVersions((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }))
}

function loadStatus(input: { key: string; gui: GuiClient; directory?: string }) {
  const pending = statusRequests.get(input.key)
  if (pending) return pending
  const request = workbenchGitStatus(input.gui, input.directory)
    .catch(() => undefined)
    .finally(() => {
      if (statusRequests.get(input.key) === request) statusRequests.delete(input.key)
    })
  statusRequests.set(input.key, request)
  return request
}

function statusSignature(status: WorkbenchGitStatus | undefined) {
  if (!status?.ok) return "unavailable"
  return JSON.stringify({
    branch: status.branch ?? "",
    upstream: status.upstream ?? "",
    ahead: status.ahead ?? 0,
    behind: status.behind ?? 0,
    clean: status.clean,
    files: status.files
      .map((file) => `${file.path}\u0000${file.code}\u0000${file.status}\u0000${file.staged ? 1 : 0}\u0000${file.unstaged ? 1 : 0}\u0000${file.untracked ? 1 : 0}`)
      .toSorted(),
  })
}

function isNonGitMessage(message: string | undefined) {
  return message?.toLowerCase().includes("not a git repository") || message?.toLowerCase().includes("not a git repo")
}

async function projectFilesAsAddedDiffs(gui: GuiClient, directory: string | undefined) {
  return (await Promise.all((await listProjectFilePaths(gui, directory)).map(async (path): Promise<DiffFile> => {
    const content = await readWorkbenchFile(gui, path, directory)
    if (content?.type !== "text") return { file: path, additions: 0, deletions: 0, status: "added" }
    const lines = content.content.split(/\r?\n/)
    return {
      file: path,
      patch: addedFilePatch(path, lines),
      additions: content.content.length === 0 ? 0 : lines.length,
      deletions: 0,
      status: "added",
    }
  }))).toSorted((left, right) => (left.file ?? "").localeCompare(right.file ?? ""))
}

async function listProjectFilePaths(gui: GuiClient, directory: string | undefined, path = ""): Promise<string[]> {
  return (await Promise.all((await listWorkbenchFiles(gui, path, directory)).map((entry) => projectFilePathsForEntry(gui, directory, entry)))).flat()
}

function projectFilePathsForEntry(gui: GuiClient, directory: string | undefined, entry: FileNode) {
  if (entry.type === "file") return Promise.resolve(entry.path ? [entry.path] : [])
  if (entry.type === "directory" && entry.path) return listProjectFilePaths(gui, directory, entry.path)
  return Promise.resolve([])
}

function addedFilePatch(path: string, lines: string[]) {
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n")
}

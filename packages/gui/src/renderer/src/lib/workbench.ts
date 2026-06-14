import type { FileContent, FileNode, OpencodeXProject } from "@opencode-ai/sdk/v2/client"
import type { DiffFile, WorkbenchGitFileStatus } from "./store"

export type WorkbenchTreeRow = {
  node: FileNode
  depth: number
  expanded: boolean
  loaded: boolean
}

export type WorkbenchFileBuffer<TContent = unknown> = {
  path: string
  content: string
  original: string
  fileContent?: TContent
}

export type WorkbenchBrowserTabState = {
  id: string
  url: string
  title?: string
  canGoBack?: boolean
  canGoForward?: boolean
  loading?: boolean
}

export type WorkbenchBrowserTab = {
  id: string
  url: string
  title?: string
  state?: WorkbenchBrowserTabState
}

export type WorkbenchDiffFile = {
  file: string
  patch?: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
}

export type WorkbenchPatchRow = {
  kind: "meta" | "hunk" | "context" | "addition" | "deletion"
  text: string
  oldLine?: number
  newLine?: number
}

type WorkbenchLineMatch = {
  original: number
  current: number
}

export type WorkbenchArtifact = {
  id: string
  kind: "screenshot" | "note" | "link"
  title: string
  url?: string
  text?: string
  created: number
}

export type WorkbenchTab = "files" | "git" | "browser" | "artifacts"

export type WorkbenchPersistedState = {
  tab: WorkbenchTab
  explorerCollapsed: boolean
  explorerWidth: number
  assistantOpen: boolean
  assistantWidth: number
  assistantSessions: Record<string, string>
  browserTabs: WorkbenchBrowserTab[]
  activeBrowserID: string
  artifacts: WorkbenchArtifact[]
}

export type WorkbenchProjectScope = {
  id: string
  label: string
  kind: "workspace" | "project"
  projectID?: string
  directories: string[]
}

export const WORKBENCH_STATE_STORAGE_KEY = "opencodex.gui.workbench"
export const WORKBENCH_EXPLORER_WIDTH = { min: 220, max: 520, default: 300 }
export const WORKBENCH_ASSISTANT_WIDTH = { min: 280, max: 560, default: 340 }

export function workbenchParentPath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "")
  const index = normalized.lastIndexOf("/")
  if (index <= 0) return ""
  return normalized.slice(0, index)
}

export function workbenchAncestorPaths(value: string) {
  const path = workbenchPathKey(value).replace(/\/+$/, "")
  if (!path) return []
  const parts = path.split("/").slice(0, -1)
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"))
}

export function workbenchNewFileDraft(input: { currentDraft?: string; folder?: string }) {
  if (input.currentDraft?.trim()) return input.currentDraft
  const folder = workbenchPathKey(input.folder).replace(/\/+$/, "")
  return folder ? `${folder}/` : ""
}

export function workbenchClampPaneWidth(value: number | undefined, bounds: { min: number; max: number; default: number }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return bounds.default
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(value)))
}

export function workbenchProjectScopes(projects: readonly OpencodeXProject[], fallbackDirectory: string): WorkbenchProjectScope[] {
  return [
    {
      id: "workspace",
      label: "No Project",
      kind: "workspace",
      directories: fallbackDirectory ? [fallbackDirectory] : [],
    },
    ...projects.map((project) => ({
      id: project.id,
      label: project.name ?? project.project.name ?? project.id,
      kind: "project" as const,
      projectID: project.id,
      directories: (project.folders ?? []).map((folder) => folder.path).filter(Boolean),
    })),
  ]
}

export function workbenchScopeDirectory(scope: WorkbenchProjectScope | undefined, fallbackDirectory: string) {
  return scope?.directories[0] ?? fallbackDirectory
}

export function workbenchLanguageID(file: string) {
  const normalized = workbenchPathKey(file).toLowerCase()
  const name = normalized.split("/").at(-1) ?? normalized
  const extension = name.split(".").at(-1) ?? ""
  if (["dockerfile", "containerfile"].includes(name) || name.endsWith(".dockerfile")) return "dockerfile"
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(extension)) return "javascript"
  if (["css", "scss", "less"].includes(extension)) return "css"
  if (["html", "htm", "xml", "svg"].includes(extension)) return "html"
  if (["json", "jsonc"].includes(extension)) return "json"
  if (["md", "mdx", "markdown"].includes(extension)) return "markdown"
  if (["py", "pyw"].includes(extension)) return "python"
  if (["sh", "bash", "zsh", "fish"].includes(extension)) return "shell"
  if (["ps1", "psm1", "psd1"].includes(extension)) return "powershell"
  if (["rs"].includes(extension)) return "rust"
  if (["yml", "yaml"].includes(extension)) return "yaml"
  if (["toml"].includes(extension)) return "toml"
  if (["sql", "pgsql", "mysql"].includes(extension)) return "sql"
  if (["go"].includes(extension)) return "go"
  if (["rb", "rake", "gemspec"].includes(extension) || name === "gemfile") return "ruby"
  if (["lua"].includes(extension)) return "lua"
  if (["c", "h"].includes(extension)) return "c"
  if (["cc", "cpp", "cxx", "hpp", "hh", "hxx"].includes(extension)) return "cpp"
  if (["java"].includes(extension)) return "java"
  if (["cs"].includes(extension)) return "csharp"
  if (["kt", "kts"].includes(extension)) return "kotlin"
  if (["scala", "sc"].includes(extension)) return "scala"
  if (["dart"].includes(extension)) return "dart"
  if (["diff", "patch"].includes(extension)) return "diff"
  if (["ini", "conf", "properties", "env"].includes(extension) || name.startsWith(".env")) return "properties"
  return "plain"
}

export function isWorkbenchImageContent(content: FileContent | undefined) {
  return content?.type === "binary" && content.mimeType?.startsWith("image/") && content.encoding === "base64"
}

export function workbenchDirtyState(input: { current: string; original: string }) {
  return input.current !== input.original
}

export function workbenchBufferDirty(buffer: Pick<WorkbenchFileBuffer, "content" | "original"> | undefined) {
  return buffer ? workbenchDirtyState({ current: buffer.content, original: buffer.original }) : false
}

export function workbenchDirtyBufferPaths(buffers: readonly Pick<WorkbenchFileBuffer, "path" | "content" | "original">[]) {
  return buffers.filter((buffer) => workbenchBufferDirty(buffer)).map((buffer) => buffer.path)
}

export function workbenchDirtyPathSet(buffers: readonly Pick<WorkbenchFileBuffer, "path" | "content" | "original">[]) {
  return new Set(workbenchDirtyBufferPaths(buffers).map(workbenchPathKey))
}

export function workbenchUnsavedChangesMessage(paths: readonly string[], action: string) {
  if (paths.length === 0) return ""
  const visible = paths.slice(0, 4)
  return [
    `You have unsaved changes in ${paths.length} file${paths.length === 1 ? "" : "s"}.`,
    "",
    ...visible,
    ...(paths.length > visible.length ? [`...and ${paths.length - visible.length} more`] : []),
    "",
    action,
  ].join("\n")
}

export function upsertWorkbenchBuffer<TContent>(
  buffers: WorkbenchFileBuffer<TContent>[],
  next: WorkbenchFileBuffer<TContent>,
) {
  return buffers.some((buffer) => buffer.path === next.path)
    ? buffers.map((buffer) => buffer.path === next.path ? next : buffer)
    : [...buffers, next]
}

export function updateWorkbenchBuffer<TContent>(
  buffers: WorkbenchFileBuffer<TContent>[],
  path: string,
  update: (buffer: WorkbenchFileBuffer<TContent>) => WorkbenchFileBuffer<TContent>,
) {
  return buffers.map((buffer) => buffer.path === path ? update(buffer) : buffer)
}

export function closeWorkbenchBuffer<TContent>(
  buffers: WorkbenchFileBuffer<TContent>[],
  activePath: string,
  path: string,
) {
  const index = buffers.findIndex((buffer) => buffer.path === path)
  const nextBuffers = buffers.filter((buffer) => buffer.path !== path)
  return {
    buffers: nextBuffers,
    activePath: activePath === path ? nextBuffers[Math.min(index, nextBuffers.length - 1)]?.path ?? "" : activePath,
  }
}

export function renameWorkbenchBuffer<TContent>(
  buffers: WorkbenchFileBuffer<TContent>[],
  from: string,
  to: string,
) {
  return buffers.map((buffer) => buffer.path === from ? { ...buffer, path: to } : buffer)
}

export function addWorkbenchBrowserTab(tabs: WorkbenchBrowserTab[], tab: WorkbenchBrowserTab) {
  return tabs.some((item) => item.id === tab.id) ? tabs : [...tabs, tab]
}

export function activeWorkbenchBrowserTab(tabs: WorkbenchBrowserTab[], activeID: string) {
  return tabs.find((tab) => tab.id === activeID) ?? tabs[0]
}

export function updateWorkbenchBrowserTabURL(tabs: WorkbenchBrowserTab[], id: string, url: string) {
  return tabs.map((tab) => tab.id === id ? { ...tab, url } : tab)
}

export function updateWorkbenchBrowserTabState(tabs: WorkbenchBrowserTab[], state: WorkbenchBrowserTabState) {
  return tabs.map((tab) => tab.id === state.id ? {
    ...tab,
    url: state.url || tab.url,
    title: state.title || tab.title,
    state,
  } : tab)
}

export function closeWorkbenchBrowserTab(tabs: WorkbenchBrowserTab[], activeID: string, id: string) {
  const index = tabs.findIndex((tab) => tab.id === id)
  const nextTabs = tabs.filter((tab) => tab.id !== id)
  return {
    tabs: nextTabs,
    activeID: activeID === id ? nextTabs[Math.min(index, nextTabs.length - 1)]?.id ?? "" : activeID,
  }
}

export function workbenchPathKey(value: string | undefined) {
  return value?.replaceAll("\\", "/").replace(/^\.\/+/, "").replaceAll("/./", "/") ?? ""
}

export function normalizeWorkbenchDiffs(files: readonly DiffFile[]) {
  return files.flatMap((file): WorkbenchDiffFile[] => {
    const path = workbenchPathKey(file.file)
    if (!path) return []
    return [{
      file: path,
      patch: file.patch,
      additions: file.additions,
      deletions: file.deletions,
      status: file.status ?? "modified",
    }]
  })
}

export function workbenchGitChangeRows(statusFiles: readonly WorkbenchGitFileStatus[], diffFiles: readonly WorkbenchDiffFile[]) {
  const statusPaths = new Set(statusFiles.map((file) => workbenchPathKey(file.path)))
  return [
    ...statusFiles.map((file) => ({
      ...file,
      path: workbenchPathKey(file.path),
    })),
    ...diffFiles.flatMap((file): WorkbenchGitFileStatus[] => {
      const path = workbenchPathKey(file.file)
      if (!path || statusPaths.has(path)) return []
      return [{
        path,
        code: file.status === "added" ? "A " : file.status === "deleted" ? "D " : " M",
        status: file.status,
        staged: false,
        unstaged: true,
        untracked: file.status === "added" && file.patch?.includes("/dev/null") === true,
      }]
    }),
  ]
}

export function workbenchFilteredGitChangeRows(files: readonly WorkbenchGitFileStatus[], query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return [...files]
  if (normalized === "staged") return files.filter((file) => file.staged)
  if (normalized === "unstaged" || normalized === "changes") return files.filter((file) => file.unstaged || file.untracked || !file.staged)
  if (normalized === "new" || normalized === "untracked") return files.filter((file) => file.untracked || file.status === "added")
  return files.filter((file) => [
    file.path,
    file.status,
    file.code,
    file.staged ? "staged" : "changes",
    file.untracked ? "new" : "",
  ].some((value) => value.toLowerCase().includes(normalized)))
}

export function workbenchGitChangeGroups(files: readonly WorkbenchGitFileStatus[]) {
  return {
    staged: files.filter((file) => file.staged),
    unstaged: files.filter((file) => file.unstaged || file.untracked || !file.staged),
  }
}

export function workbenchGitFileStats(_file: Pick<WorkbenchGitFileStatus, "path">, diff: WorkbenchDiffFile | undefined) {
  return {
    additions: diff?.additions ?? 0,
    deletions: diff?.deletions ?? 0,
    total: (diff?.additions ?? 0) + (diff?.deletions ?? 0),
  }
}

export function workbenchGitSummary(files: readonly WorkbenchGitFileStatus[], diffs: readonly WorkbenchDiffFile[]) {
  const diffByPath = new Map(diffs.map((diff) => [workbenchPathKey(diff.file), diff]))
  const stats = files.map((file) => workbenchGitFileStats(file, diffByPath.get(workbenchPathKey(file.path))))
  return {
    changed: files.length,
    staged: files.filter((file) => file.staged).length,
    unstaged: files.filter((file) => file.unstaged || file.untracked || !file.staged).length,
    additions: stats.reduce((total, stat) => total + stat.additions, 0),
    deletions: stats.reduce((total, stat) => total + stat.deletions, 0),
  }
}

export function workbenchDiffForPath(files: readonly WorkbenchDiffFile[], path: string | undefined) {
  const key = workbenchPathKey(path)
  if (!key) return
  return files.find((file) => workbenchPathKey(file.file) === key)
    ?? files.find((file) => workbenchPathKey(file.file).endsWith(`/${key}`))
}

export function workbenchDiffCopyText(diff: WorkbenchDiffFile | undefined) {
  return diff?.patch?.trim() ? diff.patch : ""
}

export function workbenchPatchRows(patch: string): WorkbenchPatchRow[] {
  const rows: WorkbenchPatchRow[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  for (const line of patch.replace(/\r\n?/g, "\n").split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      inHunk = true
      rows.push({ kind: "hunk", text: line })
      continue
    }
    if (!inHunk) {
      rows.push({ kind: "meta", text: line })
      continue
    }
    if (line.startsWith("\\ No newline")) {
      rows.push({ kind: "meta", text: line })
      continue
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "addition", text: line.slice(1), newLine })
      newLine++
      continue
    }
    if (line.startsWith("-")) {
      rows.push({ kind: "deletion", text: line.slice(1), oldLine })
      oldLine++
      continue
    }
    const text = line.startsWith(" ") ? line.slice(1) : line
    rows.push({ kind: "context", text, oldLine, newLine })
    oldLine++
    newLine++
  }
  return rows.filter((row) => row.kind !== "meta" || row.text.trim())
}

export function workbenchUnsavedBufferDiff(buffer: Pick<WorkbenchFileBuffer, "path" | "content" | "original"> | undefined) {
  if (!buffer || !workbenchBufferDirty(buffer)) return
  const rows = workbenchLineDiffRows(buffer.original, buffer.content)
  return {
    file: workbenchPathKey(buffer.path),
    status: "modified" as const,
    additions: rows.filter((line) => line.startsWith("+")).length,
    deletions: rows.filter((line) => line.startsWith("-")).length,
    patch: [
      `--- a/${workbenchPathKey(buffer.path)}`,
      `+++ b/${workbenchPathKey(buffer.path)}`,
      "@@ unsaved changes @@",
      ...rows,
    ].join("\n"),
  }
}

export function workbenchOpenFileOptions(input: {
  root: readonly FileNode[]
  children: Record<string, readonly FileNode[]>
  matches?: readonly FileNode[]
  query: string
  limit?: number
}) {
  const query = workbenchPathKey(input.query).trim().toLowerCase()
  if (!query) return []
  const seen = new Set<string>()
  const files = [
    ...Object.values(input.children).flat(),
    ...input.root,
    ...(input.matches ?? []),
  ].flatMap((node) => {
    const key = workbenchPathKey(node.path)
    if (node.type !== "file" || !key || seen.has(key)) return []
    seen.add(key)
    return [{ ...node, path: key }]
  })
  const score = (node: FileNode) => {
    const path = workbenchPathKey(node.path).toLowerCase()
    const name = node.name.toLowerCase()
    if (path === query || name === query) return 0
    if (name.startsWith(query)) return 1
    if (name.includes(query)) return 2
    if (path.startsWith(query)) return 3
    if (path.includes(query)) return 4
    return 99
  }
  return files
    .map((node) => ({ node, score: score(node) }))
    .filter((item) => item.score < 99)
    .sort((left, right) => left.score - right.score || left.node.path.localeCompare(right.node.path))
    .map((item) => item.node)
    .slice(0, input.limit ?? 8)
}

export function workbenchFileAssistantPrompt(input: {
  question: string
  path?: string
  content?: string
  selection?: string
  dirtyDiff?: Pick<WorkbenchDiffFile, "additions" | "deletions" | "patch">
}) {
  const question = input.question.trim() || "Review this file and suggest the next best change."
  const path = input.path?.trim()
  if (!path) return question
  const content = input.content ?? ""
  const selection = input.selection?.trim()
  const diff = input.dirtyDiff?.patch?.trim()
  return [
    question,
    "",
    `Current file: ${path}`,
    ...(selection ? ["", "Selected text:", "```", selection.length > 12_000 ? `${selection.slice(0, 12_000)}\n\n[Selection truncated]` : selection, "```"] : []),
    ...(diff ? ["", `Unsaved diff (+${input.dirtyDiff?.additions ?? 0} -${input.dirtyDiff?.deletions ?? 0}):`, "```diff", diff.length > 12_000 ? `${diff.slice(0, 12_000)}\n\n[Diff truncated]` : diff, "```"] : []),
    ...(content ? ["", "Current file content:", "```", content.length > 20_000 ? `${content.slice(0, 20_000)}\n\n[Content truncated]` : content, "```"] : []),
  ].join("\n")
}

export function addWorkbenchArtifact(
  artifacts: readonly WorkbenchArtifact[],
  artifact: Omit<WorkbenchArtifact, "id" | "created"> & { id?: string; created?: number },
  limit = 50,
) {
  const created = artifact.created ?? Date.now()
  const next = {
    ...artifact,
    id: artifact.id ?? `artifact-${created}`,
    created,
  }
  return [next, ...artifacts.filter((item) => item.id !== next.id)].slice(0, limit)
}

export function removeWorkbenchArtifact(artifacts: readonly WorkbenchArtifact[], id: string) {
  return artifacts.filter((item) => item.id !== id)
}

export function workbenchArtifactOpenURL(artifact: Pick<WorkbenchArtifact, "kind" | "url">) {
  if (!artifact.url) return
  if (artifact.kind === "link") return artifact.url
  return artifact.url.startsWith("http") ? artifact.url : undefined
}

export function workbenchBrowserPageArtifact(input: { url?: string; title?: string }) {
  const inputURL = input.url?.trim()
  if (!inputURL) return
  const url = workbenchNormalizeBrowserURL(inputURL)
  const title = input.title?.trim() || workbenchBrowserURLLabel(url)
  return {
    kind: "link" as const,
    title,
    url,
    text: `Browser page: ${title}\n${url}`,
  }
}

export function parseWorkbenchState(value: string | null | undefined): Partial<WorkbenchPersistedState> {
  if (!value) return {}
  try {
    return normalizeWorkbenchState(JSON.parse(value))
  } catch {
    return {}
  }
}

export function readWorkbenchState(storage: Storage | undefined = globalStorage()) {
  return parseWorkbenchState(storage?.getItem(WORKBENCH_STATE_STORAGE_KEY))
}

export function writeWorkbenchState(state: WorkbenchPersistedState, storage: Storage | undefined = globalStorage()) {
  if (!storage) return
  storage.setItem(WORKBENCH_STATE_STORAGE_KEY, JSON.stringify(normalizeWorkbenchState(state)))
}

export function workbenchBrowserTabLabel(tab: WorkbenchBrowserTab | undefined) {
  if (!tab) return "New tab"
  const title = tab.state?.title || tab.title
  if (title) return title
  try {
    const url = new URL(tab.state?.url || tab.url)
    return url.hostname || url.toString()
  } catch {
    return tab.url || "New tab"
  }
}

export function workbenchNormalizeBrowserURL(value: string) {
  const input = value.trim()
  if (!input) return "about:blank"
  if (/^(https?|file|about):/i.test(input)) return input
  if (/^localhost(?::\d+)?(?:\/.*)?$/i.test(input)) return `http://${input}`
  if (/^(?:127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/.*)?$/i.test(input)) return `http://${input}`
  if (/^\[::1\](?::\d+)?(?:\/.*)?$/i.test(input)) return `http://${input}`
  if (/^[^\s/]+\.[^\s/]+(?:\/.*)?$/i.test(input)) return `https://${input}`
  if (/^[^\s]+:\d+(?:\/.*)?$/i.test(input)) return `http://${input}`
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`
}

export function flattenWorkbenchFileTree(input: {
  root: FileNode[]
  children: Record<string, FileNode[]>
  expanded: ReadonlySet<string>
  filter?: string
}) {
  const query = input.filter?.trim().toLowerCase() ?? ""
  const visit = (items: FileNode[], depth: number): WorkbenchTreeRow[] =>
    sortWorkbenchFiles(items).flatMap((node) => {
      const childRows = node.type === "directory" ? visit(input.children[node.path] ?? [], depth + 1) : []
      const matches = !query || node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)
      if (query && !matches && childRows.length === 0) return []
      const expanded = node.type === "directory" && (input.expanded.has(node.path) || (!!query && childRows.length > 0))
      const row = {
        node,
        depth,
        expanded,
        loaded: node.type !== "directory" || input.children[node.path] !== undefined,
      }
      if (!expanded) return [row]
      return [row, ...childRows]
    })
  return visit(input.root, 0)
}

export function workbenchLineStates(input: { current: string; original: string }) {
  const changed = workbenchChangedLineNumbers(input)
  const current = splitWorkbenchLines(input.current)
  return current.map((text, index) => ({
    number: index + 1,
    text,
    modified: changed.has(index + 1),
  }))
}

export function workbenchChangedLineNumbers(input: { current: string; original: string }) {
  if (input.current === input.original) return new Set<number>()
  const current = splitWorkbenchLines(input.current)
  const original = splitWorkbenchLines(input.original)
  const matches = new Set(workbenchLineMatches(original, current).map((match) => match.current))
  const changed = new Set(current.flatMap((_, index) => matches.has(index) ? [] : [index + 1]))
  if (changed.size > 0 || current.length === 0) return changed
  const anchor = current.findIndex((line, index) => line !== original[index])
  return new Set([Math.min(Math.max(anchor + 1, 1), current.length)])
}

export function highlightWorkbenchCode(input: { text: string; path: string }) {
  return splitWorkbenchLines(input.text).map((line) => highlightWorkbenchLine(line, input.path)).join("\n")
}

export function workbenchPromptTarget(input: {
  sessionID?: string
  projectID?: string
  projectDirectory?: string
  fallbackDirectory?: string
}) {
  if (input.sessionID) return { name: "session" as const, sessionID: input.sessionID }
  return {
    name: "new-session" as const,
    projectID: input.projectID,
    directory: input.projectDirectory ?? input.fallbackDirectory,
  }
}

export function workbenchGithubLinks(input: {
  githubUrl?: string
  branch?: string
  defaultBranch?: string
}) {
  const repository = normalizedGithubUrl(input.githubUrl)
  if (!repository) return
  const branch = input.branch?.trim()
  const base = input.defaultBranch?.trim() || "main"
  const compare = branch && branch !== base
    ? `${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?quick_pull=1`
    : `${repository}/compare`
  return {
    repository,
    pulls: `${repository}/pulls`,
    issues: `${repository}/issues`,
    actions: `${repository}/actions`,
    compare,
    newIssue: `${repository}/issues/new/choose`,
  }
}

export function workbenchPullNumber(value: string) {
  const match = /^#?(\d+)$/.exec(value.trim())
  if (!match) return
  const number = Number(match[1])
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

export function workbenchGithubPullLink(input: { githubUrl?: string; number?: number }) {
  const repository = normalizedGithubUrl(input.githubUrl)
  if (!repository || !input.number) return
  return `${repository}/pull/${input.number}`
}

export function workbenchDiffPrompt(input: {
  file?: string
  status?: string
  additions?: number
  deletions?: number
  patch?: string
}) {
  const file = input.file?.trim()
  const summary = [
    input.status ? `status: ${input.status}` : "",
    typeof input.additions === "number" ? `+${input.additions}` : "",
    typeof input.deletions === "number" ? `-${input.deletions}` : "",
  ].filter(Boolean).join(", ")
  const header = file
    ? `Review the Git diff for ${file}${summary ? ` (${summary})` : ""}.`
    : "Review the selected Git diff."
  const patch = input.patch?.trim()
  if (!patch) return `${header} Call out risks, missing tests, and whether I should edit, stage, or discard it.`
  const body = patch.length > 12_000 ? `${patch.slice(0, 12_000)}\n\n[Diff truncated]` : patch
  return [
    header,
    "Call out risks, missing tests, and whether I should edit, stage, or discard it.",
    "",
    "```diff",
    body,
    "```",
  ].join("\n")
}

function sortWorkbenchFiles(items: FileNode[]) {
  return [...items].sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1
    return left.name.localeCompare(right.name)
  })
}

function normalizeWorkbenchState(input: unknown): Partial<WorkbenchPersistedState> {
  if (typeof input !== "object" || input === null) return {}
  const value = input as Partial<WorkbenchPersistedState>
  const browserTabs = normalizeWorkbenchBrowserTabs(value.browserTabs)
  const activeBrowserID = typeof value.activeBrowserID === "string" && browserTabs.some((tab) => tab.id === value.activeBrowserID)
    ? value.activeBrowserID
    : browserTabs[0]?.id
  return {
    ...(isWorkbenchTab(value.tab) ? { tab: value.tab } : {}),
    ...(typeof value.explorerCollapsed === "boolean" ? { explorerCollapsed: value.explorerCollapsed } : {}),
    explorerWidth: workbenchClampPaneWidth(value.explorerWidth, WORKBENCH_EXPLORER_WIDTH),
    ...(typeof value.assistantOpen === "boolean" ? { assistantOpen: value.assistantOpen } : {}),
    assistantWidth: workbenchClampPaneWidth(value.assistantWidth, WORKBENCH_ASSISTANT_WIDTH),
    assistantSessions: normalizeStringRecord(value.assistantSessions),
    ...(browserTabs.length > 0 ? { browserTabs } : {}),
    ...(activeBrowserID ? { activeBrowserID } : {}),
    artifacts: normalizeWorkbenchArtifacts(value.artifacts),
  }
}

function normalizeStringRecord(input: unknown) {
  if (typeof input !== "object" || input === null) return {}
  return Object.fromEntries(Object.entries(input).flatMap(([key, value]) => {
    if (!key || typeof value !== "string" || !value.trim()) return []
    return [[key, value]]
  }))
}

function normalizeWorkbenchBrowserTabs(input: unknown) {
  if (!Array.isArray(input)) return [] as WorkbenchBrowserTab[]
  return input.flatMap((item): WorkbenchBrowserTab[] => {
    if (typeof item !== "object" || item === null) return []
    const tab = item as Partial<WorkbenchBrowserTab>
    if (typeof tab.id !== "string" || !tab.id.trim()) return []
    if (typeof tab.url !== "string" || !tab.url.trim()) return []
    return [{
      id: tab.id,
      url: workbenchNormalizeBrowserURL(tab.url),
      ...(typeof tab.title === "string" && tab.title.trim() ? { title: tab.title.slice(0, 160) } : {}),
    }]
  }).slice(0, 8)
}

function normalizeWorkbenchArtifacts(input: unknown) {
  if (!Array.isArray(input)) return [] as WorkbenchArtifact[]
  return input.flatMap((item): WorkbenchArtifact[] => {
    if (typeof item !== "object" || item === null) return []
    const artifact = item as Partial<WorkbenchArtifact>
    if (typeof artifact.id !== "string" || !artifact.id.trim()) return []
    if (artifact.kind !== "note" && artifact.kind !== "screenshot" && artifact.kind !== "link") return []
    if (typeof artifact.title !== "string" || !artifact.title.trim()) return []
    const text = typeof artifact.text === "string" ? artifact.text.slice(0, 50_000) : undefined
    const url = typeof artifact.url === "string" && artifact.url.length <= 200_000 ? artifact.url : undefined
    if (artifact.kind === "note" && !text) return []
    if (artifact.kind === "screenshot" && !url) return []
    if (artifact.kind === "link" && !url) return []
    return [{
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title.slice(0, 180),
      created: typeof artifact.created === "number" && Number.isFinite(artifact.created) ? artifact.created : Date.now(),
      ...(text ? { text } : {}),
      ...(url ? { url } : {}),
    }]
  }).sort((left, right) => right.created - left.created).slice(0, 50)
}

function workbenchBrowserURLLabel(value: string) {
  try {
    const url = new URL(workbenchNormalizeBrowserURL(value))
    return url.hostname || url.toString()
  } catch {
    return "Browser page"
  }
}

function isWorkbenchTab(value: unknown): value is WorkbenchTab {
  return value === "files" || value === "git" || value === "browser" || value === "artifacts"
}

function globalStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function splitWorkbenchLines(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  return lines.length ? lines : [""]
}

function workbenchLineDiffRows(originalText: string, currentText: string) {
  const original = splitWorkbenchLines(originalText)
  const current = splitWorkbenchLines(currentText)
  const matches = workbenchLineMatches(original, current)
  const rows: string[] = []
  let originalIndex = 0
  let currentIndex = 0
  for (const match of matches) {
    while (originalIndex < match.original) {
      rows.push(`-${original[originalIndex] ?? ""}`)
      originalIndex++
    }
    while (currentIndex < match.current) {
      rows.push(`+${current[currentIndex] ?? ""}`)
      currentIndex++
    }
    rows.push(` ${current[match.current] ?? ""}`)
    originalIndex = match.original + 1
    currentIndex = match.current + 1
  }
  while (originalIndex < original.length) {
    rows.push(`-${original[originalIndex] ?? ""}`)
    originalIndex++
  }
  while (currentIndex < current.length) {
    rows.push(`+${current[currentIndex] ?? ""}`)
    currentIndex++
  }
  return rows
}

function workbenchLineMatches(original: readonly string[], current: readonly string[]) {
  const prefix: WorkbenchLineMatch[] = []
  let prefixIndex = 0
  while (prefixIndex < original.length && prefixIndex < current.length && original[prefixIndex] === current[prefixIndex]) {
    prefix.push({ original: prefixIndex, current: prefixIndex })
    prefixIndex++
  }

  const suffix: WorkbenchLineMatch[] = []
  let originalEnd = original.length - 1
  let currentEnd = current.length - 1
  while (originalEnd >= prefixIndex && currentEnd >= prefixIndex && original[originalEnd] === current[currentEnd]) {
    suffix.push({ original: originalEnd, current: currentEnd })
    originalEnd--
    currentEnd--
  }

  const originalMiddle = original.slice(prefixIndex, originalEnd + 1)
  const currentMiddle = current.slice(prefixIndex, currentEnd + 1)
  const middle = originalMiddle.length * currentMiddle.length > 300_000
    ? []
    : workbenchMiddleLineMatches(originalMiddle, currentMiddle).map((match) => ({
        original: match.original + prefixIndex,
        current: match.current + prefixIndex,
      }))
  return [...prefix, ...middle, ...suffix.reverse()]
}

function workbenchMiddleLineMatches(original: readonly string[], current: readonly string[]) {
  const width = current.length + 1
  const scores = new Uint32Array((original.length + 1) * width)
  for (let originalIndex = 1; originalIndex <= original.length; originalIndex++) {
    for (let currentIndex = 1; currentIndex <= current.length; currentIndex++) {
      const index = originalIndex * width + currentIndex
      scores[index] = original[originalIndex - 1] === current[currentIndex - 1]
        ? scores[(originalIndex - 1) * width + currentIndex - 1] + 1
        : Math.max(scores[(originalIndex - 1) * width + currentIndex], scores[originalIndex * width + currentIndex - 1])
    }
  }

  const matches: WorkbenchLineMatch[] = []
  let originalIndex = original.length
  let currentIndex = current.length
  while (originalIndex > 0 && currentIndex > 0) {
    if (original[originalIndex - 1] === current[currentIndex - 1]) {
      matches.push({ original: originalIndex - 1, current: currentIndex - 1 })
      originalIndex--
      currentIndex--
      continue
    }
    if (scores[(originalIndex - 1) * width + currentIndex] >= scores[originalIndex * width + currentIndex - 1]) {
      originalIndex--
      continue
    }
    currentIndex--
  }
  return matches.reverse()
}

function highlightWorkbenchLine(line: string, file: string) {
  const commentStart = lineCommentStart(line, file)
  if (commentStart >= 0) {
    return `${highlightWorkbenchTokens(line.slice(0, commentStart))}<span class="syntax-comment">${escapeHtml(line.slice(commentStart))}</span>`
  }
  return highlightWorkbenchTokens(line)
}

function highlightWorkbenchTokens(line: string) {
  const tokens = line.match(/(["'`])(?:\\.|(?!\1).)*\1|\b[A-Za-z_$][\w$]*\b|\b\d+(?:\.\d+)?\b|[{}[\]().,:;<>+\-*/%=!&|?]+|\s+|./g) ?? []
  return tokens.map((token, index) => {
    if (/^\s+$/.test(token)) return token
    if (/^(["'`])/.test(token)) return `<span class="syntax-string">${escapeHtml(token)}</span>`
    if (/^\d/.test(token)) return `<span class="syntax-constant">${escapeHtml(token)}</span>`
    if (/^[{}[\]().,:;<>+\-*/%=!&|?]+$/.test(token)) return `<span class="syntax-punctuation">${escapeHtml(token)}</span>`
    if (WORKBENCH_KEYWORDS.has(token)) return `<span class="syntax-keyword">${escapeHtml(token)}</span>`
    if (WORKBENCH_PRIMITIVES.has(token)) return `<span class="syntax-primitive">${escapeHtml(token)}</span>`
    if (/^[A-Z]/.test(token)) return `<span class="syntax-type">${escapeHtml(token)}</span>`
    if ((tokens[index + 1] ?? "").startsWith("(")) return `<span class="syntax-property">${escapeHtml(token)}</span>`
    return escapeHtml(token)
  }).join("")
}

function lineCommentStart(line: string, file: string) {
  const trimmed = file.toLowerCase()
  const hash = line.indexOf("#")
  const slash = line.indexOf("//")
  if ([".py", ".sh", ".bash", ".zsh", ".ps1", ".yml", ".yaml", ".toml"].some((extension) => trimmed.endsWith(extension))) return hash
  if (slash >= 0) return slash
  return hash === 0 ? hash : -1
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function normalizedGithubUrl(value: string | undefined) {
  if (!value) return
  const url = value.replace(/\/+$/, "")
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== "github.com") return
    const path = parsed.pathname.replace(/\.git$/, "").replace(/^\/+|\/+$/g, "")
    if (path.split("/").length !== 2) return
    return `https://github.com/${path}`
  } catch {
    return
  }
}

const WORKBENCH_KEYWORDS = new Set([
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "def",
  "default",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "interface",
  "let",
  "match",
  "new",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "struct",
  "switch",
  "type",
  "var",
  "while",
])

const WORKBENCH_PRIMITIVES = new Set(["false", "null", "None", "nil", "true", "undefined"])

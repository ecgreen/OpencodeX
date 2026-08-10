import type { FileContent, FileNode, OpencodeXProject } from "@opencode-ai/sdk/v2/client"
import { highlightWorkbenchCode, workbenchChangedLineNumbers, workbenchLineDiffRows, workbenchLineStates } from "./workbench-lines"
import { workbenchNormalizeBrowserURL } from "./workbench-browser"
export {
  normalizeWorkbenchDiffs,
  workbenchDiffForPath,
  workbenchFilteredGitChangeRows,
  workbenchGitChangeGroups,
  workbenchGitChangeRows,
  workbenchGitFileStats,
  workbenchGitSummary,
  workbenchPatchRows,
} from "./workbench-git"
export {
  activeWorkbenchBrowserTab,
  addWorkbenchArtifact,
  addWorkbenchBrowserTab,
  closeWorkbenchBrowserTab,
  removeWorkbenchArtifact,
  updateWorkbenchBrowserTabState,
  updateWorkbenchBrowserTabURL,
  workbenchArtifactOpenURL,
  workbenchBrowserPageArtifact,
  workbenchBrowserTabLabel,
  workbenchNormalizeBrowserURL,
} from "./workbench-browser"
export { workbenchGithubLinks, workbenchGithubPullLink, workbenchPullNumber } from "./workbench-github"
export { workbenchDiffPrompt, workbenchPromptTarget } from "./workbench-prompts"
export { parseWorkbenchState, readWorkbenchState, writeWorkbenchState, workbenchClampPaneWidth, WORKBENCH_ASSISTANT_WIDTH, WORKBENCH_EXPLORER_WIDTH, WORKBENCH_STATE_STORAGE_KEY } from "./workbench-state"

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

export function workbenchPathKey(value: string | undefined) {
  return value?.replaceAll("\\", "/").replace(/^\.\/+/, "").replaceAll("/./", "/") ?? ""
}

export function workbenchDiffCopyText(diff: WorkbenchDiffFile | undefined) {
  return diff?.patch?.trim() ? diff.patch : ""
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

export function flattenWorkbenchFileTree(input: {
  root: FileNode[]
  children: Record<string, FileNode[]>
  expanded: ReadonlySet<string>
  /** Folders the user explicitly collapsed; wins over filter auto-expansion. */
  collapsed?: ReadonlySet<string>
  filter?: string
  /** Project-wide search hits, revealed in place even under unloaded folders. */
  matches?: readonly FileNode[]
}) {
  const query = input.filter?.trim().toLowerCase() ?? ""
  const virtual = query ? virtualMatchNodes(input.matches ?? []) : { root: [], children: {}, files: new Set<string>() }
  const mergeChildren = (path: string) => {
    const loaded = input.children[path]
    const extra = virtual.children[path] ?? []
    if (!loaded) return extra.length > 0 ? extra : undefined
    const seen = new Set(loaded.map((node) => node.path))
    return [...loaded, ...extra.filter((node) => !seen.has(node.path))]
  }
  const visit = (items: FileNode[], depth: number): WorkbenchTreeRow[] =>
    sortWorkbenchFiles(items).flatMap((node) => {
      const children = node.type === "directory" ? mergeChildren(node.path) : undefined
      const childRows = node.type === "directory" ? visit(children ?? [], depth + 1) : []
      const matches = !query || node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query) || virtual.files.has(node.path)
      if (query && !matches && childRows.length === 0) return []
      const expanded = node.type === "directory"
        && !input.collapsed?.has(node.path)
        && (input.expanded.has(node.path) || (!!query && childRows.length > 0))
      const row = {
        node,
        depth,
        expanded,
        loaded: node.type !== "directory" || children !== undefined,
      }
      if (!expanded) return [row]
      return [row, ...childRows]
    })
  const rootSeen = new Set(input.root.map((node) => node.path))
  return visit([...input.root, ...virtual.root.filter((node) => !rootSeen.has(node.path))], 0)
}

/** Ancestor chains for search matches, so hits render as ordinary tree nodes. */
function virtualMatchNodes(matches: readonly FileNode[]) {
  const root: FileNode[] = []
  const children: Record<string, FileNode[]> = {}
  const files = new Set<string>()
  const dirs = new Set<string>()
  const add = (parent: string, node: FileNode) => {
    const bucket = parent ? (children[parent] ??= []) : root
    if (!bucket.some((existing) => existing.path === node.path)) bucket.push(node)
  }
  for (const match of matches) {
    const path = workbenchPathKey(match.path)
    if (!path || match.type === "directory") continue
    files.add(path)
    const parts = path.split("/").filter(Boolean)
    let parent = ""
    parts.slice(0, -1).forEach((name) => {
      const directoryPath = parent ? `${parent}/${name}` : name
      if (!dirs.has(directoryPath)) {
        dirs.add(directoryPath)
        add(parent, { name, path: directoryPath, absolute: "", type: "directory", ignored: false })
      }
      parent = directoryPath
    })
    add(parent, { ...match, name: parts.at(-1) ?? path, path })
  }
  return { root, children, files }
}

export { highlightWorkbenchCode, workbenchChangedLineNumbers, workbenchLineStates } from "./workbench-lines"

function sortWorkbenchFiles(items: FileNode[]) {
  return [...items].sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1
    return left.name.localeCompare(right.name)
  })
}

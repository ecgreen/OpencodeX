import type { FileContent, FileNode, OpencodeXProject, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import type { BrowserState } from "../../../preload"
import type { GuiClient } from "../lib/client"
import {
  createSession,
  createWorkbenchFile,
  deleteWorkbenchFile,
  findFiles,
  loadSession,
  listWorkbenchFiles,
  readWorkbenchFile,
  renameWorkbenchFile,
  runSessionCommand,
  runShellCommand,
  sendPrompt,
  workbenchDiagnostics,
  workbenchGitBranches,
  workbenchGitDiff,
  workbenchGitHistory,
  workbenchGitOperation,
  workbenchGitStashCreate,
  workbenchGitStashes,
  workbenchGitStashOperation,
  workbenchGitStatus,
  writeWorkbenchFile,
  type DiffFile,
  type GuiSnapshot,
  type SessionData,
  type WorkbenchDataResult,
  type WorkbenchDiagnostic,
  type WorkbenchDiagnosticsResult,
  type WorkbenchGitBranches,
  type WorkbenchGitHistoryCommit,
  type WorkbenchGitStash,
  type WorkbenchGitStatus,
  type WorkbenchOperationResult,
} from "../lib/store"
import { compactPath } from "../lib/format"
import { modelValue } from "../lib/model-selection"
import type { GuiPromptInfo } from "../lib/prompt-state"
import { runSessionPromptAction } from "../lib/session-prompt"
import type { SessionSlashCommand } from "../lib/session-slash-commands"
import { EMPTY_VIEW_PANE_RUNTIME_STATE, type ViewPaneRuntimeState } from "../lib/view-pane-state"
import {
  addWorkbenchArtifact,
  closeWorkbenchBuffer,
  activeWorkbenchBrowserTab,
  addWorkbenchBrowserTab,
  closeWorkbenchBrowserTab,
  flattenWorkbenchFileTree,
  isWorkbenchImageContent,
  normalizeWorkbenchDiffs,
  readWorkbenchState,
  renameWorkbenchBuffer,
  writeWorkbenchState,
  updateWorkbenchBuffer,
  updateWorkbenchBrowserTabState,
  updateWorkbenchBrowserTabURL,
  upsertWorkbenchBuffer,
  workbenchAncestorPaths,
  workbenchArtifactOpenURL,
  workbenchBufferDirty,
  workbenchBrowserPageArtifact,
  workbenchBrowserTabLabel,
  workbenchClampPaneWidth,
  workbenchDirtyBufferPaths,
  workbenchDirtyPathSet,
  workbenchDiffPrompt,
  workbenchDiffForPath,
  workbenchFileAssistantPrompt,
  workbenchOpenFileOptions,
  workbenchFilteredGitChangeRows,
  workbenchGitFileStats,
  workbenchGitChangeGroups,
  workbenchGitChangeRows,
  workbenchNormalizeBrowserURL,
  workbenchPatchRows,
  type WorkbenchDiffFile,
  workbenchNewFileDraft,
  workbenchPathKey,
  removeWorkbenchArtifact,
  workbenchUnsavedBufferDiff,
  workbenchUnsavedChangesMessage,
  type WorkbenchArtifact,
  type WorkbenchBrowserTab,
  type WorkbenchFileBuffer,
  type WorkbenchTab,
  workbenchParentPath,
  workbenchProjectScopes,
  workbenchScopeDirectory,
  WORKBENCH_ASSISTANT_WIDTH,
  WORKBENCH_EXPLORER_WIDTH,
} from "../lib/workbench"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { CodeEditor } from "./code-editor"
import { Icon } from "./icon"
import { SessionPage } from "./session-page"

const EMPTY_SESSION_DATA: SessionData = {
  messages: [],
  todos: [],
  diffs: [],
}

export function WorkbenchPage(props: {
  gui?: GuiClient
  snapshot?: GuiSnapshot
  projects?: OpencodeXProject[]
  recentModels?: string[]
  selectedAgent?: string
  setSelectedAgent?: (value: string) => void
  selectedModel?: string
  setSelectedModel?: (value: string) => void
  selectedVariant?: string
  setSelectedVariant?: (value: string) => void
  rememberModel?: (value: string) => void
  refresh?: () => Promise<void>
  replyPermission?: (request: GuiSnapshot["permissions"][number], reply: "once" | "always" | "reject") => void
  replyQuestion?: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  rejectQuestion?: (request: QuestionRequest) => void
  abortSession?: (sessionID: string) => void
  renameSession?: (session: Session) => void
  moveSession?: (session: Session) => void
  deleteSession?: (session: Session) => void
  slashCommands?: (session: Session | undefined, data: SessionData, restorePrompt: (value: string) => void) => SessionSlashCommand[]
  concealCodeBlocks?: boolean
  showTimestamps?: boolean
  showThinking?: boolean
  showToolDetails?: boolean
  showScrollbar?: boolean
  showGenericToolOutput?: boolean
  toggleCodeConceal?: () => void
  toggleTimestamps?: () => void
  toggleThinking?: () => void
  toggleToolDetails?: () => void
  toggleScrollbar?: () => void
  toggleGenericToolOutput?: () => void
  sendToComposer?: (text: string) => void
  openDiff?: () => void
  openExternal?: (url: string) => void
}) {
  const persistedWorkbench = readWorkbenchState()
  const fallbackBrowserID = newBrowserID()
  const initialBrowserTabs = persistedWorkbench.browserTabs?.length
    ? persistedWorkbench.browserTabs
    : [{ id: fallbackBrowserID, url: "http://localhost:5173", title: "Localhost" }]
  const [tab, setTab] = createSignal<WorkbenchTab>(persistedWorkbench.tab ?? "files")
  const [notice, setNotice] = createSignal("")
  const [filesByPath, setFilesByPath] = createSignal<Record<string, FileNode[]>>({})
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set())
  const [selectedProjectID, setSelectedProjectID] = createSignal("")
  const [filePath, setFilePath] = createSignal("")
  const [explorerCollapsed, setExplorerCollapsed] = createSignal(persistedWorkbench.explorerCollapsed ?? false)
  const [explorerWidth, setExplorerWidth] = createSignal(workbenchClampPaneWidth(persistedWorkbench.explorerWidth, WORKBENCH_EXPLORER_WIDTH))
  const [assistantOpen, setAssistantOpen] = createSignal(persistedWorkbench.assistantOpen ?? false)
  const [assistantWidth, setAssistantWidth] = createSignal(workbenchClampPaneWidth(persistedWorkbench.assistantWidth, WORKBENCH_ASSISTANT_WIDTH))
  const [explorerFilter, setExplorerFilter] = createSignal("")
  const [explorerMatches, setExplorerMatches] = createSignal<FileNode[]>([])
  const [explorerSearchState, setExplorerSearchState] = createSignal<"idle" | "loading" | "error">("idle")
  const [newFilePath, setNewFilePath] = createSignal("")
  const [newItemKind, setNewItemKind] = createSignal<"file" | "folder">("file")
  const [openFileQuery, setOpenFileQuery] = createSignal("")
  const [openFileMatches, setOpenFileMatches] = createSignal<FileNode[]>([])
  const [openFileSearchState, setOpenFileSearchState] = createSignal<"idle" | "loading" | "error">("idle")
  const [assistantSessions, setAssistantSessions] = createSignal<Record<string, string>>(persistedWorkbench.assistantSessions ?? {})
  const [assistantSessionCache, setAssistantSessionCache] = createSignal<Record<string, Session>>({})
  const [assistantSessionData, setAssistantSessionData] = createSignal<Record<string, SessionData>>({})
  const [assistantComposerState, setAssistantComposerState] = createSignal<Record<string, ViewPaneRuntimeState>>({})
  const [assistantLoading, setAssistantLoading] = createSignal(false)
  const [activePath, setActivePath] = createSignal("")
  const [buffers, setBuffers] = createSignal<WorkbenchFileBuffer<FileContent>[]>([])
  const [editorSelection, setEditorSelection] = createSignal("")
  const [diagnostics, setDiagnostics] = createSignal<WorkbenchDiagnostic[]>([])
  const [diagnosticsLoading, setDiagnosticsLoading] = createSignal(false)
  const [diagnosticsMessage, setDiagnosticsMessage] = createSignal("")
  const [diagnosticsCommand, setDiagnosticsCommand] = createSignal("")
  const [busy, setBusy] = createSignal("")
  const [gitStatus, setGitStatus] = createSignal<WorkbenchGitStatus>()
  const [branches, setBranches] = createSignal<WorkbenchGitBranches>()
  const [gitDiffs, setGitDiffs] = createSignal<WorkbenchDiffFile[]>([])
  const [gitStashes, setGitStashes] = createSignal<WorkbenchGitStash[]>([])
  const [gitHistory, setGitHistory] = createSignal<WorkbenchGitHistoryCommit[]>([])
  const [gitLoading, setGitLoading] = createSignal(false)
  const [gitDiffLoading, setGitDiffLoading] = createSignal(false)
  const [gitMessage, setGitMessage] = createSignal("")
  const [gitDiffMessage, setGitDiffMessage] = createSignal("")
  const [gitFilter, setGitFilter] = createSignal("")
  const [gitView, setGitView] = createSignal<"changes" | "history">("changes")
  const [selectedGitPath, setSelectedGitPath] = createSignal("")
  const [selectedHistoryHash, setSelectedHistoryHash] = createSignal("")
  const [branchName, setBranchName] = createSignal("")
  const [commitMessage, setCommitMessage] = createSignal("")
  const [commitBody, setCommitBody] = createSignal("")
  const [stashMessage, setStashMessage] = createSignal("")
  const [browserTabs, setBrowserTabs] = createSignal<WorkbenchBrowserTab[]>(initialBrowserTabs)
  const [activeBrowserID, setActiveBrowserID] = createSignal(persistedWorkbench.activeBrowserID ?? initialBrowserTabs[0]?.id ?? fallbackBrowserID)
  const [artifacts, setArtifacts] = createSignal<WorkbenchArtifact[]>(persistedWorkbench.artifacts ?? [])
  let browserHost: HTMLDivElement | undefined
  let newFileInput: HTMLInputElement | undefined
  let resizeObserver: ResizeObserver | undefined
  const browserCreatedIDs = new Set<string>()
  let explorerSearchToken = 0
  let openFileSearchToken = 0
  let diagnosticsToken = 0

  const activeGui = createMemo(() => props.gui)
  const activeBrowserTab = createMemo(() => activeWorkbenchBrowserTab(browserTabs(), activeBrowserID()))
  const browserID = createMemo(() => activeBrowserTab()?.id ?? activeBrowserID())
  const browserURL = createMemo(() => activeBrowserTab()?.url ?? "")
  const browserState = createMemo(() => activeBrowserTab()?.state)
  const activeBuffer = createMemo(() => buffers().find((buffer) => buffer.path === activePath()))
  const fileContent = createMemo(() => activeBuffer()?.fileContent)
  const dirty = createMemo(() => workbenchBufferDirty(activeBuffer()))
  const openPath = createMemo(() => activePath())
  const projectOptions = createMemo(() => workbenchProjectScopes(props.projects ?? [], activeGui()?.directory ?? ""))
  const selectedProject = createMemo(() => projectOptions().find((project) => project.id === selectedProjectID()) ?? projectOptions()[0])
  const selectedDirectory = createMemo(() => workbenchScopeDirectory(selectedProject(), activeGui()?.directory ?? ""))
  const assistantScopeKey = createMemo(() => {
    const project = selectedProject()
    if (project?.kind === "project") return `project:${project.projectID}`
    return `workspace:${selectedDirectory()}`
  })
  const assistantSessionID = createMemo(() => assistantSessions()[assistantScopeKey()] ?? "")
  const assistantSession = createMemo(() => {
    const sessionID = assistantSessionID()
    if (!sessionID) return
    return props.snapshot?.sessions.find((session) => session.id === sessionID) ?? assistantSessionCache()[sessionID]
  })
  const assistantData = createMemo(() => {
    const sessionID = assistantSessionID()
    if (!sessionID) return EMPTY_SESSION_DATA
    return assistantSessionData()[sessionID] ?? EMPTY_SESSION_DATA
  })
  const assistantPermissions = createMemo(() => {
    const sessionID = assistantSessionID()
    if (!sessionID) return []
    return props.snapshot?.permissions.filter((request) => request.sessionID === sessionID) ?? []
  })
  const assistantQuestions = createMemo(() => {
    const sessionID = assistantSessionID()
    if (!sessionID) return []
    return props.snapshot?.questions.filter((request) => request.sessionID === sessionID) ?? []
  })
  const assistantComposer = createMemo(() => assistantComposerState()[assistantScopeKey()] ?? EMPTY_VIEW_PANE_RUNTIME_STATE)
  const allGitFiles = createMemo(() => workbenchGitChangeRows(gitStatus()?.files ?? [], gitDiffs()))
  const selectedGitFiles = createMemo(() => workbenchFilteredGitChangeRows(allGitFiles(), gitFilter()))
  const gitStatusByPath = createMemo(() => new Map(allGitFiles().map((file) => [workbenchPathKey(file.path), file])))
  const dirtyPaths = createMemo(() => workbenchDirtyPathSet(buffers()))
  const fileTreeRows = createMemo(() => flattenWorkbenchFileTree({
    root: filesByPath()[""] ?? [],
    children: filesByPath(),
    expanded: expandedFolders(),
    filter: explorerFilter(),
  }))
  const openFileOptions = createMemo(() => workbenchOpenFileOptions({
    root: filesByPath()[""] ?? [],
    children: filesByPath(),
    matches: openFileMatches(),
    query: openFileQuery(),
    limit: 8,
  }))
  const activeDiagnostics = createMemo(() => diagnostics().filter((item) => diagnosticMatchesPath(item, openPath())))
  const selectedGitFile = createMemo(() => selectedGitFiles().find((file) => file.path === selectedGitPath()) ?? selectedGitFiles()[0])
  const selectedGitDiff = createMemo(() => workbenchDiffForPath(gitDiffs(), selectedGitFile()?.path))
  const selectedHistoryCommit = createMemo(() => gitHistory().find((commit) => commit.hash === selectedHistoryHash()) ?? gitHistory()[0])
  const gitChangeGroups = createMemo(() => workbenchGitChangeGroups(allGitFiles()))
  const visibleGitChangeGroups = createMemo(() => workbenchGitChangeGroups(selectedGitFiles()))
  const stagedGitFiles = createMemo(() => gitChangeGroups().staged)
  const unstagedGitFiles = createMemo(() => gitChangeGroups().unstaged)
  const visibleStagedGitFiles = createMemo(() => visibleGitChangeGroups().staged)
  const visibleUnstagedGitFiles = createMemo(() => visibleGitChangeGroups().unstaged)
  const visibleGitAllStaged = createMemo(() => selectedGitFiles().length > 0 && visibleUnstagedGitFiles().length === 0)
  const visibleGitSomeStaged = createMemo(() => visibleStagedGitFiles().length > 0 && visibleUnstagedGitFiles().length > 0)
  onMount(() => {
    void refreshGit()
    const syncOnFocus = () => {
      if (tab() === "files") void syncLoadedFileFolders()
      if (tab() === "git") void refreshGit()
    }
    window.addEventListener("focus", syncOnFocus)
    onCleanup(() => window.removeEventListener("focus", syncOnFocus))
  })

  createEffect(() => {
    const options = projectOptions()
    if (options.some((option) => option.id === selectedProjectID())) return
    setSelectedProjectID(options[0]?.id ?? "")
  })

  createEffect(() => {
    const directory = selectedDirectory()
    if (!directory) return
    setFilesByPath({})
    setExpandedFolders(new Set<string>())
    setFilePath("")
    setNewFilePath("")
    setOpenFileQuery("")
    setOpenFileMatches([])
    setOpenFileSearchState("idle")
    setActivePath("")
    setBuffers([])
    setEditorSelection("")
    setDiagnostics([])
    setDiagnosticsMessage("")
    setDiagnosticsCommand("")
    setDiagnosticsLoading(false)
    setCommitMessage("")
    setCommitBody("")
    setStashMessage("")
    setGitLoading(false)
    setGitDiffLoading(false)
    setGitMessage("")
    setGitDiffMessage("")
    setGitFilter("")
    setGitHistory([])
    setGitView("changes")
    setSelectedHistoryHash("")
    void refreshFiles("")
    void refreshGit()
  })

  createEffect(() => {
    const selected = selectedGitPath()
    const files = selectedGitFiles()
    if (selected && files.some((file) => file.path === selected)) return
    setSelectedGitPath(files[0]?.path ?? "")
  })

  createEffect(() => {
    const selected = selectedHistoryHash()
    const commits = gitHistory()
    if (selected && commits.some((commit) => commit.hash === selected)) return
    setSelectedHistoryHash(commits[0]?.hash ?? "")
  })

  createEffect(() => {
    const current = gitStatus()?.branch ?? branches()?.current ?? ""
    if (!current || branchName()) return
    setBranchName(current)
  })

  createEffect(() => {
    if (!assistantOpen() || tab() !== "files") return
    void ensureAssistantSession()
  })

  createEffect(() => {
    const gui = activeGui()
    const query = explorerFilter().trim()
    const directory = selectedDirectory()
    const token = ++explorerSearchToken
    if (!gui || !directory || query.length < 2) {
      setExplorerMatches([])
      setExplorerSearchState("idle")
      return
    }
    setExplorerSearchState("loading")
    findFiles(gui, { query, directory, limit: 40 })
      .then((matches) => {
        if (token !== explorerSearchToken) return
        setExplorerMatches(matches.filter((file) => file.path))
        setExplorerSearchState("idle")
      })
      .catch(() => {
        if (token !== explorerSearchToken) return
        setExplorerMatches([])
        setExplorerSearchState("error")
      })
  })

  createEffect(() => {
    const gui = activeGui()
    const query = openFileQuery().trim()
    const directory = selectedDirectory()
    const token = ++openFileSearchToken
    if (!gui || !directory || query.length < 2) {
      setOpenFileMatches([])
      setOpenFileSearchState("idle")
      return
    }
    setOpenFileSearchState("loading")
    findFiles(gui, { query, directory, limit: 80 })
      .then((matches) => {
        if (token !== openFileSearchToken) return
        setOpenFileMatches(matches.filter((file) => file.type === "file" && file.path))
        setOpenFileSearchState("idle")
      })
      .catch(() => {
        if (token !== openFileSearchToken) return
        setOpenFileMatches([])
        setOpenFileSearchState("error")
      })
  })

  createEffect(() => {
    const currentTab = tab()
    const directory = selectedDirectory()
    if (currentTab !== "files" || !directory) return
    queueMicrotask(() => void refreshDiagnostics())
  })

  createEffect(() => {
    if (tab() !== "browser") {
      hideBrowserTabs()
      return
    }
    void ensureBrowser()
    updateBrowserBounds()
  })

  createEffect(() => {
    const currentTab = tab()
    const directory = selectedDirectory()
    const gui = activeGui()
    if (!gui || !directory || (currentTab !== "files" && currentTab !== "git")) return
    const interval = window.setInterval(() => {
      if (tab() === "files") void syncLoadedFileFolders()
      if (tab() === "git") void refreshGit()
    }, 4500)
    onCleanup(() => window.clearInterval(interval))
  })

  createEffect(() => {
    writeWorkbenchState({
      tab: tab(),
      explorerCollapsed: explorerCollapsed(),
      explorerWidth: explorerWidth(),
      assistantOpen: assistantOpen(),
      assistantWidth: assistantWidth(),
      assistantSessions: assistantSessions(),
      browserTabs: browserTabs(),
      activeBrowserID: activeBrowserID(),
      artifacts: artifacts(),
    })
  })

  onCleanup(() => {
    resizeObserver?.disconnect()
    browserTabs().forEach((item) => void window.opencodex?.browser?.destroy(item.id))
  })

  async function refreshFiles(path: string) {
    const gui = activeGui()
    if (!gui || !selectedDirectory()) {
      setNotice("Choose a project before refreshing files.")
      return
    }
    setBusy("files")
    setNotice("")
    try {
      const files = await listWorkbenchFiles(gui, path, selectedDirectory())
      setFilesByPath((current) => ({ ...current, [path]: files }))
      setFilePath(path)
    } catch (err) {
      setNotice(errorText(err, "Failed to load files."))
    } finally {
      setBusy("")
    }
  }

  async function syncLoadedFileFolders() {
    const gui = activeGui()
    const directory = selectedDirectory()
    if (!gui || !directory) return
    const loaded = Object.keys(filesByPath())
    const paths = loaded.length > 0 ? loaded : [""]
    try {
      const entries = await Promise.all(paths.map((path) =>
        listWorkbenchFiles(gui, path, directory).then((files) => [path, files] as const),
      ))
      setFilesByPath((current) => entries.reduce((next, [path, files]) => ({ ...next, [path]: files }), current))
      void refreshGit()
    } catch {
      // Quiet sync keeps the editor usable when files are temporarily unavailable.
    }
  }

  async function openFile(path: string) {
    const gui = activeGui()
    if (!gui || !selectedDirectory()) return
    await revealFileInExplorer(path)
    if (buffers().some((buffer) => buffer.path === path)) {
      setActivePath(path)
      return
    }
    setBusy("open-file")
    setNotice("")
    try {
      const content = await readWorkbenchFile(gui, path, selectedDirectory())
      const text = content?.type === "text" ? content.content : ""
      setBuffers((current) => upsertWorkbenchBuffer(current, {
        path,
        content: text,
        original: text,
        fileContent: content,
      }))
      setActivePath(path)
      setEditorSelection("")
    } catch (err) {
      setNotice(errorText(err, "Failed to open file."))
    } finally {
      setBusy("")
    }
  }

  async function revealFileInExplorer(path: string) {
    const parents = workbenchAncestorPaths(path)
    const folder = workbenchParentPath(path)
    setExpandedFolders((current) => new Set([...current, ...parents]))
    setFilePath(folder)
    await parents
      .filter((parent) => filesByPath()[parent] === undefined)
      .reduce((promise, parent) => promise.then(() => refreshFiles(parent)), Promise.resolve())
  }

  function selectProject(projectID: string, select?: HTMLSelectElement) {
    if (projectID === selectedProjectID()) return
    const dirtyPaths = workbenchDirtyBufferPaths(buffers())
    if (dirtyPaths.length > 0 && !confirm(workbenchUnsavedChangesMessage(dirtyPaths, "Switch projects and discard these unsaved editor changes?"))) {
      if (select) select.value = selectedProjectID()
      return
    }
    setSelectedProjectID(projectID)
  }

  function closeEditorBuffer(buffer: WorkbenchFileBuffer<FileContent>) {
    if (workbenchBufferDirty(buffer) && !confirm(workbenchUnsavedChangesMessage([buffer.path], "Close this editor tab and discard its unsaved changes?"))) return
    setBuffers((current) => {
      const next = closeWorkbenchBuffer(current, activePath(), buffer.path)
      setActivePath(next.activePath)
      return next.buffers
    })
  }

  async function saveFile() {
    const gui = activeGui()
    const buffer = activeBuffer()
    if (!gui || !buffer) return
    setBusy("save-file")
    setNotice("")
    try {
      const result = await writeWorkbenchFile(gui, {
        path: buffer.path,
        content: buffer.content,
        previousContent: buffer.original,
      }, selectedDirectory())
      if (!result.ok) {
        if (result.content !== undefined) {
          setBuffers((current) => updateWorkbenchBuffer(current, buffer.path, (item) => ({
            ...item,
            content: result.content ?? item.content,
            original: result.content ?? item.original,
          })))
        }
        setNotice(result.message ?? "File was not saved.")
        return
      }
      setBuffers((current) => updateWorkbenchBuffer(current, buffer.path, (item) => ({ ...item, original: item.content })))
      setNotice(result.message ?? "Saved.")
      void refreshGit()
      void refreshDiagnostics()
    } catch (err) {
      setNotice(errorText(err, "Failed to save file."))
    } finally {
      setBusy("")
    }
  }

  async function createExplorerItem() {
    const gui = activeGui()
    if (!gui || !selectedDirectory()) return
    const path = newFilePath().trim()
    if (!path) return
    const directory = newItemKind() === "folder"
    const result = await runOperation(() => createWorkbenchFile(gui, directory ? { path, directory: true } : { path, content: "" }, selectedDirectory()))
    if (result?.ok) {
      setNewFilePath("")
      if (directory) {
        setExpandedFolders((current) => new Set([...current, path]))
        setFilePath(path)
        void refreshFiles(workbenchParentPath(path))
        void refreshFiles(path)
        void refreshGit()
        return
      }
      void refreshFiles(workbenchParentPath(path))
      void openFile(path)
    }
  }

  async function renameFile() {
    const gui = activeGui()
    const from = activePath()
    if (!gui || !from) return
    const to = prompt("Rename to", from)
    if (!to || to === from) return
    const result = await runOperation(() => renameWorkbenchFile(gui, { from, to }, selectedDirectory()))
    if (result?.ok) {
      const nextParent = workbenchParentPath(to)
      setBuffers((current) => renameWorkbenchBuffer(current, from, to))
      setActivePath(to)
      void refreshFiles(nextParent)
    }
  }

  async function deleteFile() {
    const gui = activeGui()
    const path = activePath()
    if (!gui || !path) return
    if (!confirm(`Delete ${path}?`)) return
    const parent = workbenchParentPath(path)
    const result = await runOperation(() => deleteWorkbenchFile(gui, path, selectedDirectory()))
    if (result?.ok) {
      setBuffers((current) => {
        const next = closeWorkbenchBuffer(current, activePath(), path)
        setActivePath(next.activePath)
        return next.buffers
      })
      setEditorSelection("")
      void refreshFiles(parent)
      void refreshGit()
    }
  }

  async function refreshDiagnostics() {
    const gui = activeGui()
    const directory = selectedDirectory()
    const token = ++diagnosticsToken
    if (!gui || !directory || diagnosticsLoading()) return
    setDiagnosticsLoading(true)
    try {
      const result = await workbenchDiagnostics(gui, directory).catch((err): WorkbenchDiagnosticsResult => ({
        ok: false,
        message: errorText(err, "Unable to run project checks."),
        diagnostics: [],
      }))
      if (token !== diagnosticsToken) return
      setDiagnostics(result.diagnostics ?? [])
      setDiagnosticsMessage(result.message ?? (result.ok ? "Project checks passed." : "Project checks found issues."))
      setDiagnosticsCommand(result.command ?? "")
    } finally {
      if (token === diagnosticsToken) setDiagnosticsLoading(false)
    }
  }

  async function refreshGit() {
    const gui = activeGui()
    if (!gui) return
    setGitLoading(true)
    setGitDiffLoading(true)
    setGitMessage("")
    try {
      const [status, branchList, diffResult, stashResult, historyResult] = await Promise.all([
        workbenchGitStatus(gui, selectedDirectory()).catch((err): WorkbenchGitStatus => ({ ok: false, clean: true, files: [], message: errorText(err, "Unable to load Git status.") })),
        workbenchGitBranches(gui, selectedDirectory()).catch((err): WorkbenchGitBranches => ({ ok: false, branches: [], message: errorText(err, "Unable to load branches.") })),
        workbenchGitDiff(gui, selectedDirectory())
          .catch((err): WorkbenchDataResult<DiffFile[]> => ({ ok: false, data: [], message: errorText(err, "Unable to load Git diffs.") })),
        workbenchGitStashes(gui, selectedDirectory()).catch((): WorkbenchDataResult<WorkbenchGitStash[]> => ({ ok: false, data: [] })),
        workbenchGitHistory(gui, selectedDirectory()).catch((err): WorkbenchDataResult<WorkbenchGitHistoryCommit[]> => ({ ok: false, data: [], message: errorText(err, "Unable to load Git history.") })),
      ])
      const nextDiffs = normalizeWorkbenchDiffs(diffResult.data ?? [])
      setGitStatus(status)
      setBranches(branchList)
      setGitDiffs((current) => workbenchDiffsEqual(current, nextDiffs) ? current : nextDiffs)
      setGitStashes(Array.isArray(stashResult.data) ? stashResult.data : [])
      setGitHistory(Array.isArray(historyResult.data) ? historyResult.data : [])
      setGitDiffMessage(diffResult.ok ? "" : diffResult.message ?? "Unable to load Git diffs.")
      setGitMessage([
        status.ok ? "" : status.message,
        branchList.ok ? "" : branchList.message,
        stashResult.ok ? "" : stashResult.message ?? "Unable to load stashes.",
        historyResult.ok ? "" : historyResult.message ?? "Unable to load Git history.",
      ].filter(Boolean).join(" "))
    } catch (err) {
      setNotice(errorText(err, "Failed to refresh Git status."))
    } finally {
      setGitLoading(false)
      setGitDiffLoading(false)
    }
  }

  async function runGit(action: "stage" | "unstage" | "discard", path: string) {
    const gui = activeGui()
    if (!gui) return
    if (action === "discard" && !confirm(`Discard changes in ${path}?`)) return
    await runOperation(() => workbenchGitOperation(gui, action, { paths: [path] }, selectedDirectory()))
    void refreshGit()
  }

  async function runGitForPaths(action: "stage" | "unstage", paths: string[]) {
    const gui = activeGui()
    if (!gui || paths.length === 0) return
    await runOperation(() => workbenchGitOperation(gui, action, { paths }, selectedDirectory()))
    void refreshGit()
  }

  function toggleVisibleGitSelection() {
    const action = visibleGitAllStaged() ? "unstage" : "stage"
    const paths = (action === "stage" ? visibleUnstagedGitFiles() : visibleStagedGitFiles()).map((file) => file.path)
    void runGitForPaths(action, paths)
  }

  async function checkoutBranch(nextBranch = branchName().trim()) {
    const gui = activeGui()
    if (!gui || !nextBranch.trim()) return
    await runOperation(() => workbenchGitOperation(gui, "checkout", { branch: nextBranch.trim() }, selectedDirectory()))
    void refreshGit()
  }

  async function createBranch() {
    const gui = activeGui()
    if (!gui || !branchName().trim()) return
    await runOperation(() => workbenchGitOperation(gui, "create-branch", { branch: branchName().trim() }, selectedDirectory()))
    setBranchName("")
    void refreshGit()
  }

  async function commit() {
    const gui = activeGui()
    if (!gui || !commitMessage().trim()) return
    const body = commitBody().trim()
    const result = await runOperation(() => workbenchGitOperation(gui, "commit", {
      message: commitMessage().trim(),
      ...(body ? { body } : {}),
    }, selectedDirectory()))
    if (result?.ok) {
      setCommitMessage("")
      setCommitBody("")
    }
    void refreshGit()
  }

  async function createStash() {
    const gui = activeGui()
    if (!gui || selectedGitFiles().length === 0) return
    const message = stashMessage().trim()
    const result = await runOperation(() => workbenchGitStashCreate(gui, {
      ...(message ? { message } : {}),
    }, selectedDirectory()))
    if (result?.ok) setStashMessage("")
    void refreshGit()
  }

  async function runStash(action: "apply" | "pop" | "drop", ref: string) {
    const gui = activeGui()
    if (!gui) return
    if (action === "drop" && !confirm(`Drop ${ref}?`)) return
    await runOperation(() => workbenchGitStashOperation(gui, action, { ref }, selectedDirectory()))
    void refreshGit()
  }

  async function runRemoteGit(action: "fetch" | "pull" | "push" | "publish") {
    const gui = activeGui()
    if (!gui) return
    await runOperation(() => workbenchGitOperation(gui, action, undefined, selectedDirectory()))
    void refreshGit()
  }

  function promptAgent(text: string) {
    props.sendToComposer?.(text)
    setNotice("Sent context to the composer.")
  }

  function gitChangeFileButton(file: WorkbenchGitStatus["files"][number]) {
    const stats = workbenchGitFileStats(file, workbenchDiffForPath(gitDiffs(), file.path))
    return (
      <button
        type="button"
        class="workbench-change-file"
        classList={{ selected: selectedGitFile()?.path === file.path, staged: file.staged }}
        onClick={() => setSelectedGitPath(file.path)}
      >
        <input
          type="checkbox"
          checked={file.staged}
          aria-label={file.staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
          onClick={(event) => event.stopPropagation()}
          onChange={() => void runGit(file.staged ? "unstage" : "stage", file.path)}
        />
        <span class={`workbench-file-status ${file.status}`}>{gitStatusSymbol(file)}</span>
        <span>{file.path}</span>
        <small>{file.staged ? "staged" : file.untracked ? "new" : file.status}</small>
        <Show when={stats.total > 0}>
          <span class="workbench-change-stats" title={`${stats.additions} additions, ${stats.deletions} deletions`}>
            <span class="added">+{stats.additions}</span>
            <span class="deleted">-{stats.deletions}</span>
          </span>
        </Show>
      </button>
    )
  }

  function promptFileContext(kind: "file" | "selection") {
    if (!openPath()) return
    if (kind === "file") {
      promptAgent(`Use ${openPath()} as context. Review the file and suggest the next change.`)
      return
    }
    const selection = editorSelection()
    if (!selection.trim()) {
      setNotice("Select text in the editor before sending a selection.")
      return
    }
    promptAgent([
      `Use this selection from ${openPath()} as context:`,
      "",
      "```",
      selection,
      "```",
    ].join("\n"))
  }

  function saveFileArtifact(kind: "file" | "selection") {
    const path = openPath()
    if (!path) return
    const selection = editorSelection()
    const buffer = activeBuffer()
    const text = kind === "selection" ? selection : buffer?.content
    if (!text?.trim()) {
      setNotice(kind === "selection" ? "Select text in the editor before saving a selection artifact." : "Open a text file before saving an artifact.")
      return
    }
    setArtifacts((items) => addWorkbenchArtifact(items, {
      kind: "note",
      title: kind === "selection" ? `Selection - ${path}` : `File - ${path}`,
      text: [
        kind === "selection" ? `Selection from ${path}` : `File context from ${path}`,
        "",
        "```",
        text.length > 20_000 ? `${text.slice(0, 20_000)}\n\n[Content truncated]` : text,
        "```",
      ].join("\n"),
    }))
    setNotice("Saved artifact.")
  }

  function promptUnsavedDiff() {
    const diff = workbenchUnsavedBufferDiff(activeBuffer())
    if (!diff) {
      setNotice("Edit the file before asking about unsaved changes.")
      return
    }
    promptAgent(workbenchDiffPrompt({
      file: diff.file,
      status: "unsaved",
      additions: diff.additions,
      deletions: diff.deletions,
      patch: diff.patch,
    }))
  }

  function saveUnsavedDiffArtifact() {
    const diff = workbenchUnsavedBufferDiff(activeBuffer())
    if (!diff) {
      setNotice("Edit the file before saving an unsaved diff artifact.")
      return
    }
    setArtifacts((items) => addWorkbenchArtifact(items, {
      kind: "note",
      title: `Unsaved diff - ${diff.file}`,
      text: workbenchDiffPrompt({
        file: diff.file,
        status: "unsaved",
        additions: diff.additions,
        deletions: diff.deletions,
        patch: diff.patch,
      }),
    }))
    setNotice("Saved unsaved diff artifact.")
  }

  function promptArtifact(artifact: WorkbenchArtifact) {
    const body = artifact.text ?? (artifact.url?.startsWith("http") ? artifact.url : "[Screenshot artifact is previewed in the Workbench.]")
    promptAgent([
      `Use this Workbench artifact as context: ${artifact.title}`,
      "",
      body,
    ].join("\n").trim())
  }

  async function toggleFolder(file: FileNode) {
    setFilePath(file.path)
    if (expandedFolders().has(file.path)) {
      setExpandedFolders((current) => new Set([...current].filter((path) => path !== file.path)))
      return
    }
    setExpandedFolders((current) => new Set([...current, file.path]))
    if (filesByPath()[file.path] === undefined) await refreshFiles(file.path)
  }

  function collapseExplorer() {
    explorerSearchToken++
    setExplorerFilter("")
    setExplorerMatches([])
    setExplorerSearchState("idle")
    setExpandedFolders(new Set<string>())
  }

  function startNewFile() {
    setNewItemKind("file")
    setNewFilePath((current) => workbenchNewFileDraft({ currentDraft: current, folder: filePath() }) || "untitled.txt")
    queueMicrotask(() => {
      newFileInput?.focus()
      const end = newFileInput?.value.length ?? 0
      newFileInput?.setSelectionRange(end, end)
    })
  }

  function startNewFolder() {
    setNewItemKind("folder")
    setNewFilePath((current) => workbenchNewFileDraft({ currentDraft: current, folder: filePath() }) || "new-folder")
    queueMicrotask(() => {
      newFileInput?.focus()
      const end = newFileInput?.value.length ?? 0
      newFileInput?.setSelectionRange(end, end)
    })
  }

  async function openDirectFile() {
    const path = workbenchPathKey(openFileQuery().trim())
    const option = openFileOptions().find((file) => workbenchPathKey(file.path) === path) ?? openFileOptions()[0]
    const target = option?.path ?? path
    if (!target) return
    await openFile(target)
    setOpenFileQuery("")
  }

  function updateAssistantComposer(update: (state: ViewPaneRuntimeState) => ViewPaneRuntimeState) {
    const key = assistantScopeKey()
    setAssistantComposerState((current) => ({
      ...current,
      [key]: update(current[key] ?? EMPTY_VIEW_PANE_RUNTIME_STATE),
    }))
  }

  function restoreAssistantPrompt(value: string) {
    updateAssistantComposer((state) => ({
      ...state,
      draft: { ...state.draft, input: value },
    }))
  }

  async function ensureAssistantSession() {
    const gui = activeGui()
    const scope = selectedProject()
    const directory = selectedDirectory()
    if (!gui || !scope || !directory || assistantLoading()) return
    const existing = assistantSession()
    if (existing) {
      await loadAssistantSession(existing)
      return
    }
    setAssistantLoading(true)
    try {
      const created = await createSession(gui, {
        projectID: scope.kind === "project" ? scope.projectID : undefined,
        directory,
        title: `Workbench - ${scope.label}`,
      })
      const session = created.data
      if (!session) return
      setAssistantSessions((current) => ({ ...current, [assistantScopeKey()]: session.id }))
      setAssistantSessionCache((current) => ({ ...current, [session.id]: session }))
      await loadAssistantSession(session)
      await props.refresh?.()
    } catch (err) {
      setNotice(errorText(err, "Failed to open the Workbench assistant."))
    } finally {
      setAssistantLoading(false)
    }
  }

  async function loadAssistantSession(session: Session, cursor?: string) {
    const gui = activeGui()
    if (!gui) return
    setAssistantLoading(true)
    try {
      const data = await loadSession(gui, session.id, session.directory, cursor ? { messageBefore: cursor } : {})
      setAssistantSessionData((current) => ({
        ...current,
        [session.id]: cursor
          ? {
              ...data,
              messages: [...data.messages, ...(current[session.id]?.messages ?? [])],
              todos: current[session.id]?.todos ?? data.todos,
              diffs: current[session.id]?.diffs ?? data.diffs,
            }
          : data,
      }))
    } catch (err) {
      setNotice(errorText(err, "Failed to load the Workbench assistant session."))
    } finally {
      setAssistantLoading(false)
    }
  }

  async function submitAssistantPrompt(event: SubmitEvent, prompt: GuiPromptInfo) {
    const gui = activeGui()
    const session = assistantSession()
    if (!gui || !session) return
    const buffer = activeBuffer()
    const promptWithContext = buffer ? {
      ...prompt,
      input: workbenchFileAssistantPrompt({
        question: prompt.input,
        path: buffer.path,
        content: buffer.content,
        selection: editorSelection(),
        dirtyDiff: workbenchUnsavedBufferDiff(buffer),
      }),
    } : prompt
    setAssistantLoading(true)
    try {
      await runSessionPromptAction({
        gui,
        route: { name: "session" },
        session,
        text: promptWithContext,
        permissionCount: assistantPermissions().length,
        questionCount: assistantQuestions().length,
        agent: props.selectedAgent ?? "",
        model: props.selectedModel ?? "",
        variant: props.selectedVariant ?? "",
        setPrompt: restoreAssistantPrompt,
        setLoadingSessionID: () => {},
        sendPrompt: (sessionID, text, options) => sendPrompt(gui, sessionID, text, options).then(() => undefined),
        runCommand: (sessionID, command, argumentsText, options) => runSessionCommand(gui, sessionID, {
          command,
          arguments: argumentsText,
          ...options,
        }).then(() => undefined),
        runShell: (sessionID, command, options) => runShellCommand(gui, sessionID, { command, ...options }).then(() => undefined),
        serverCommands: props.snapshot?.commands ?? [],
        rememberModel: props.rememberModel ?? (() => {}),
        syncSession: async () => {
          await loadAssistantSession(session)
        },
        refresh: props.refresh ?? (async () => {}),
        openCreatedSession: () => {},
        prepareTarget: async () => ({ target: session }),
      })
    } finally {
      setAssistantLoading(false)
    }
  }

  function startPaneResize(kind: "explorer" | "assistant", event: PointerEvent & { currentTarget: HTMLElement }) {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const startX = event.clientX
    const startWidth = kind === "explorer" ? explorerWidth() : assistantWidth()
    const onMove = (moveEvent: PointerEvent) => {
      const delta = kind === "explorer" ? moveEvent.clientX - startX : startX - moveEvent.clientX
      if (kind === "explorer") {
        setExplorerWidth(workbenchClampPaneWidth(startWidth + delta, WORKBENCH_EXPLORER_WIDTH))
        return
      }
      setAssistantWidth(workbenchClampPaneWidth(startWidth + delta, WORKBENCH_ASSISTANT_WIDTH))
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  async function ensureBrowser() {
    const browser = window.opencodex?.browser
    const current = activeBrowserTab()
    if (!browser || !current) return
    const state = await browser.create({ id: current.id, url: browserCreatedIDs.has(current.id) ? undefined : current.url })
    browserCreatedIDs.add(current.id)
    if (state) setBrowserTabs((tabs) => updateWorkbenchBrowserTabState(tabs, state))
  }

  function updateBrowserBounds() {
    if (!browserHost || !window.opencodex?.browser) return
    const rect = browserHost.getBoundingClientRect()
    void window.opencodex.browser.bounds({
      id: browserID(),
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }).then((state) => {
      if (state) setBrowserTabs((tabs) => updateWorkbenchBrowserTabState(tabs, state))
    })
    hideBrowserTabs(browserID())
    if (resizeObserver) return
    resizeObserver = new ResizeObserver(updateBrowserBounds)
    resizeObserver.observe(browserHost)
  }

  function hideBrowserTabs(exceptID = "") {
    browserTabs().filter((item) => item.id !== exceptID).forEach((item) => {
      void window.opencodex?.browser?.bounds({ id: item.id, x: 0, y: 0, width: 1, height: 1 })
    })
  }

  async function navigateBrowser() {
    const browser = window.opencodex?.browser
    if (!browser) return
    const url = workbenchNormalizeBrowserURL(browserURL())
    setBrowserTabs((tabs) => updateWorkbenchBrowserTabURL(tabs, browserID(), url))
    const state = await browser.navigate({ id: browserID(), url })
    browserCreatedIDs.add(browserID())
    if (state) setBrowserTabs((tabs) => updateWorkbenchBrowserTabState(tabs, state))
  }

  async function browserAction(action: "back" | "forward" | "reload" | "stop") {
    const state = await window.opencodex?.browser?.action({ id: browserID(), action })
    if (state) setBrowserTabs((tabs) => updateWorkbenchBrowserTabState(tabs, state))
  }

  async function captureScreenshot() {
    const url = await window.opencodex?.browser?.screenshot(browserID())
    if (!url) return
    setArtifacts((items) => addWorkbenchArtifact(items, {
      kind: "screenshot",
      title: browserState()?.title || browserState()?.url || "Browser screenshot",
      url,
    }))
    setNotice("Captured browser screenshot.")
  }

  function saveBrowserPageArtifact() {
    const artifact = workbenchBrowserPageArtifact({
      url: browserState()?.url || browserURL(),
      title: browserState()?.title || workbenchBrowserTabLabel(activeBrowserTab()),
    })
    if (!artifact) {
      setNotice("Open a browser page before saving it as an artifact.")
      return
    }
    setArtifacts((items) => addWorkbenchArtifact(items, artifact))
    setNotice("Saved browser page artifact.")
  }

  function setActiveBrowserURL(url: string) {
    setBrowserTabs((tabs) => updateWorkbenchBrowserTabURL(tabs, browserID(), url))
  }

  function createBrowserTab(url = "http://localhost:5173", title = "New tab") {
    const id = newBrowserID()
    setBrowserTabs((tabs) => addWorkbenchBrowserTab(tabs, { id, url: workbenchNormalizeBrowserURL(url), title }))
    setActiveBrowserID(id)
  }

  function openWorkbenchBrowserURL(url: string | undefined, title = "New tab") {
    if (!url) return
    createBrowserTab(url, title)
    setTab("browser")
  }

  function closeBrowserTab(id: string) {
    const next = closeWorkbenchBrowserTab(browserTabs(), activeBrowserID(), id)
    const fallback = next.tabs.length === 0 ? { id: newBrowserID(), url: "http://localhost:5173", title: "New tab" } : undefined
    setBrowserTabs(fallback ? [fallback] : next.tabs)
    setActiveBrowserID(fallback?.id ?? next.activeID)
    browserCreatedIDs.delete(id)
    void window.opencodex?.browser?.destroy(id)
  }

  async function runOperation(operation: () => Promise<WorkbenchOperationResult>) {
    setBusy("operation")
    setNotice("")
    try {
      const result = await operation()
      setNotice(result.message ?? (result.ok ? "Done." : "Operation failed."))
      return result
    } catch (err) {
      setNotice(errorText(err, "Operation failed."))
    } finally {
      setBusy("")
    }
  }

  return (
    <section class="page workbench-page">
      <nav class="workbench-tabs" aria-label="Workbench tabs">
        <For each={[
          { id: "files", label: "Files", icon: "folder" },
          { id: "git", label: "Git", icon: "branch" },
          { id: "browser", label: "Browser", icon: "browser" },
          { id: "artifacts", label: "Artifacts", icon: "panel" },
        ] as const}>
          {(item) => (
            <button type="button" classList={{ active: tab() === item.id }} onClick={() => setTab(item.id)}>
              <Icon name={item.icon} /> {item.label}
            </button>
          )}
        </For>
      </nav>

      <Show when={notice()}>
        <div class="notice">{notice()}</div>
      </Show>

      <Switch>
        <Match when={tab() === "files"}>
          <div
            class="workbench-files"
            classList={{ "explorer-collapsed": explorerCollapsed(), "assistant-open": assistantOpen() }}
            style={`--workbench-sidebar-width:${explorerWidth()}px;--workbench-assistant-width:${assistantWidth()}px;`}
          >
            <Show when={explorerCollapsed()}>
              <button
                type="button"
                class="workbench-sidebar-restore"
                aria-label="Show file explorer"
                title="Show file explorer"
                onClick={() => setExplorerCollapsed(false)}
              >
                <Icon name="folder" />
                <span>Files</span>
              </button>
            </Show>
            <Show when={!explorerCollapsed()}>
              <aside class="workbench-sidebar">
                <header class="workbench-explorer-header">
                  <div>
                    <span>Workspace</span>
                  </div>
                  <div class="workbench-icon-actions">
                    <button type="button" disabled={!activeGui() || !selectedDirectory()} aria-label="New file" title="New file" onClick={startNewFile}><Icon name="file" /></button>
                    <button type="button" disabled={!activeGui() || !selectedDirectory()} aria-label="New folder" title="New folder" onClick={startNewFolder}><Icon name="folder" /></button>
                    <button type="button" aria-label="Hide explorer" title="Hide explorer" onClick={() => setExplorerCollapsed(true)}><Icon name="panel" /></button>
                  </div>
                </header>
                <div class="workbench-project-picker">
                  <label for="workbench-project">Project</label>
                  <select id="workbench-project" value={selectedProjectID()} onChange={(event) => selectProject(event.currentTarget.value, event.currentTarget)}>
                    <For each={projectOptions()}>
                      {(project) => <option value={project.id}>{project.label}</option>}
                    </For>
                  </select>
                </div>
                <div class="workbench-open-file">
                  <Icon name="file" />
                  <input
                    list="workbench-open-file-options"
                    value={openFileQuery()}
                    placeholder="Open file by name"
                    onInput={(event) => setOpenFileQuery(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return
                      event.preventDefault()
                      void openDirectFile()
                    }}
                  />
                  <datalist id="workbench-open-file-options">
                    <For each={openFileOptions()}>{(file) => <option value={file.path}>{file.name} - {file.path}</option>}</For>
                  </datalist>
                  <Show when={openFileSearchState() === "loading"}>
                    <span class="workbench-input-status">...</span>
                  </Show>
                  <button type="button" aria-label="Open file" disabled={!openFileQuery().trim()} onClick={() => void openDirectFile()}><Icon name="chevronRight" /></button>
                </div>
                <div class="workbench-filter">
                  <Icon name="search" />
                  <input
                    value={explorerFilter()}
                    placeholder="Filter tree"
                    onInput={(event) => setExplorerFilter(event.currentTarget.value)}
                  />
                  <Show when={explorerFilter()}>
                    <button type="button" aria-label="Clear file filter" onClick={() => setExplorerFilter("")}><Icon name="x" /></button>
                  </Show>
                </div>
                <Show when={newFilePath()}>
                  <div class="workbench-new-file">
                    <input
                      ref={(element) => { newFileInput = element }}
                      value={newFilePath()}
                      placeholder={newItemKind() === "folder" ? filePath() ? `${filePath()}/new-folder` : "new-folder" : filePath() ? `${filePath()}/new-file.ts` : "new-file.ts"}
                      onInput={(event) => setNewFilePath(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return
                        event.preventDefault()
                        void createExplorerItem()
                      }}
                    />
                    <button type="button" disabled={!activeGui() || !selectedDirectory() || !newFilePath().trim()} onClick={() => void createExplorerItem()}><Icon name="plus" /> {newItemKind() === "folder" ? "Folder" : "File"}</button>
                    <button type="button" aria-label="Cancel create" onClick={() => setNewFilePath("")}><Icon name="x" /></button>
                  </div>
                </Show>
              <Show when={explorerFilter().trim().length >= 2}>
                <div class="workbench-search-results">
                  <header>
                    <span>Project matches</span>
                    <small>{explorerSearchState() === "loading" ? "Searching..." : explorerSearchState() === "error" ? "Search failed" : `${explorerMatches().length} found`}</small>
                  </header>
                  <For each={explorerMatches()} fallback={<div class="empty">{explorerSearchState() === "loading" ? "Searching project..." : "No project matches."}</div>}>
                    {(match) => (
                      <button
                        type="button"
                        class="workbench-search-row"
                        classList={{ selected: openPath() === match.path, directory: match.type === "directory" }}
                        onClick={() => match.type === "directory" ? void toggleFolder(match) : void openFile(match.path)}
                      >
                        <Icon name={match.type === "directory" ? "folder" : "file"} />
                        <span>{match.path}</span>
                        <Show when={match.type === "file" && dirtyPaths().has(workbenchPathKey(match.path))}>
                          <span class="workbench-dirty-status" title="Unsaved editor changes" />
                        </Show>
                        <Show when={gitStatusByPath().get(workbenchPathKey(match.path))}>
                          {(file) => <span class={`workbench-tree-status ${file().status}`} title={file().staged ? "Staged" : file().untracked ? "New file" : "Modified"}>{gitStatusSymbol(file())}</span>}
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <div class="workbench-tree" role="tree">
                <For each={fileTreeRows()} fallback={<div class="empty">{busy() === "files" ? "Loading files..." : "No files found."}</div>}>
                  {(row) => (
                  <button
                    type="button"
                    class="workbench-file-row"
                    classList={{
                      selected: openPath() === row.node.path,
                      directory: row.node.type === "directory",
                    }}
                    style={{ "--depth": String(row.depth) }}
                    role="treeitem"
                    aria-expanded={row.node.type === "directory" ? row.expanded : undefined}
                    onClick={() => row.node.type === "directory" ? void toggleFolder(row.node) : void openFile(row.node.path)}
                  >
                    <Show when={row.node.type === "directory"} fallback={<span class="workbench-tree-spacer" />}>
                      <span class="workbench-disclosure"><Icon name={row.expanded ? "chevronDown" : "chevronRight"} /></span>
                    </Show>
                    <Icon name={row.node.type === "directory" ? row.expanded ? "folder-open" : "folder" : "file"} />
                    <span>{row.node.name}</span>
                    <Show when={row.node.type === "file" && dirtyPaths().has(workbenchPathKey(row.node.path))}>
                      <span class="workbench-dirty-status" title="Unsaved editor changes" />
                    </Show>
                    <Show when={gitStatusByPath().get(workbenchPathKey(row.node.path))}>
                      {(file) => <span class={`workbench-tree-status ${file().status}`} title={file().staged ? "Staged" : file().untracked ? "New file" : "Modified"}>{gitStatusSymbol(file())}</span>}
                    </Show>
                    <Show when={row.node.type === "directory" && row.expanded && !row.loaded}>
                      <span class="workbench-loading">...</span>
                    </Show>
                  </button>
                  )}
                </For>
              </div>
              </aside>
            </Show>
            <Show when={!explorerCollapsed()}>
              <div
                class="workbench-resize-handle explorer"
                role="separator"
                aria-label="Resize file explorer"
                onPointerDown={(event) => startPaneResize("explorer", event)}
              >
                <Icon name="grip" />
              </div>
            </Show>
            <section class="workbench-editor">
              <Show when={buffers().length}>
                <div class="workbench-editor-tabs" role="tablist" aria-label="Open files">
                  <For each={buffers()}>
                    {(buffer) => (
                      <div
                        class="workbench-editor-tab"
                        classList={{
                          active: activePath() === buffer.path,
                          modified: workbenchBufferDirty(buffer),
                        }}
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activePath() === buffer.path}
                          onClick={() => {
                            setActivePath(buffer.path)
                            void revealFileInExplorer(buffer.path)
                          }}
                        >
                          <Icon name={isWorkbenchImageContent(buffer.fileContent) ? "panel" : "file"} />
                          <span>{compactPath(buffer.path)}</span>
                          <Show when={gitStatusByPath().get(workbenchPathKey(buffer.path))}>
                            {(file) => <span class={`workbench-tab-status ${file().status}`} title={file().staged ? "Staged" : file().untracked ? "New file" : "Modified"}>{gitStatusSymbol(file())}</span>}
                          </Show>
                          <Show when={workbenchBufferDirty(buffer)}><span class="workbench-tab-dot" /></Show>
                        </button>
                        <button
                          type="button"
                          class="workbench-tab-close"
                          aria-label={`Close ${buffer.path}`}
                          onClick={() => closeEditorBuffer(buffer)}
                        >
                          <Icon name="x" />
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <header>
                <div>
                  <strong>{openPath() ? compactPath(openPath()) : "No file open"}</strong>
                  <Show when={dirty()}><span>modified</span></Show>
                </div>
                <div class="row-actions">
                  <button type="button" aria-label="Revert file" title="Revert file" disabled={!activeBuffer() || !dirty()} onClick={() => setBuffers((current) => updateWorkbenchBuffer(current, activePath(), (buffer) => ({ ...buffer, content: buffer.original })))}><Icon name="undo" /></button>
                  <button type="button" aria-label="Save file" title="Save file" disabled={!openPath() || !dirty()} onClick={() => void saveFile()}><Icon name="save" /></button>
                  <button type="button" aria-label="Open assistant" title="Open assistant" disabled={!openPath()} onClick={() => setAssistantOpen(true)}><Icon name="session" /></button>
                  <details class="workbench-menu">
                    <summary aria-label="More file actions"><Icon name="more" /></summary>
                    <div class="workbench-menu-popover">
                      <button type="button" disabled={!openPath()} onClick={() => promptFileContext("file")}><Icon name="send" /> Send file</button>
                      <button type="button" disabled={!openPath()} onClick={() => promptFileContext("selection")}><Icon name="send" /> Send selection</button>
                      <button type="button" disabled={!openPath() || !dirty()} onClick={promptUnsavedDiff}><Icon name="send" /> Ask about edits</button>
                      <button type="button" disabled={!openPath()} onClick={() => saveFileArtifact("file")}><Icon name="panel" /> Save file artifact</button>
                      <button type="button" disabled={!openPath()} onClick={() => saveFileArtifact("selection")}><Icon name="panel" /> Save selection</button>
                      <button type="button" disabled={!openPath() || !dirty()} onClick={saveUnsavedDiffArtifact}><Icon name="panel" /> Save edit artifact</button>
                      <button type="button" disabled={!openPath()} onClick={() => void renameFile()}><Icon name="pencil" /> Rename</button>
                      <button type="button" class="danger" disabled={!openPath()} onClick={() => void deleteFile()}><Icon name="trash" /> Delete</button>
                    </div>
                  </details>
                </div>
              </header>
              <WorkbenchDiagnosticsBar
                loading={diagnosticsLoading()}
                message={diagnosticsMessage()}
                command={diagnosticsCommand()}
                diagnostics={activeDiagnostics().length > 0 ? activeDiagnostics() : diagnostics()}
                total={diagnostics().length}
                onOpen={(path) => void openFile(path)}
              />
                  <Switch>
                <Match when={isWorkbenchImageContent(fileContent())}>
                  <div class="workbench-image-preview">
                    <img src={`data:${fileContent()?.mimeType ?? "image/png"};base64,${fileContent()?.content ?? ""}`} alt={openPath()} />
                  </div>
                </Match>
                <Match when={fileContent()?.type === "binary"}>
                  <div class="workbench-placeholder">
                    <Icon name="file" />
                    <strong>Binary file</strong>
                    <span>Binary preview is intentionally read-only in this Workbench slice.</span>
                  </div>
                </Match>
                <Match when={activeBuffer()?.fileContent?.type === "text" ? activeBuffer() : undefined}>
                  {(buffer) => (
                    <CodeEditor
                      path={buffer().path}
                      value={buffer().content}
                      original={buffer().original}
                      onChange={(value) => setBuffers((current) => updateWorkbenchBuffer(current, buffer().path, (item) => ({ ...item, content: value })))}
                      onSave={() => void saveFile()}
                      onSelectionChange={setEditorSelection}
                      diagnostics={activeDiagnostics()}
                    />
                  )}
                </Match>
                <Match when={true}>
                  <div class="workbench-placeholder">
                    <Icon name="folder-open" />
                    <strong>Choose a file</strong>
                    <span>Open a text file to edit it, or create a new one in the current folder.</span>
                  </div>
                </Match>
              </Switch>
            </section>
            <Show when={assistantOpen()}>
              <div
                class="workbench-resize-handle assistant"
                role="separator"
                aria-label="Resize assistant panel"
                onPointerDown={(event) => startPaneResize("assistant", event)}
              >
                <Icon name="grip" />
              </div>
              <aside class="workbench-assistant-panel session-shell">
                <header>
                  <div>
                    <strong>OpenCodeX</strong>
                    <span>{openPath() ? compactPath(openPath()) : selectedProject()?.label ?? "Workspace"}</span>
                  </div>
                  <button type="button" aria-label="Close assistant" title="Close assistant" onClick={() => setAssistantOpen(false)}><Icon name="x" /></button>
                </header>
                <Show
                  when={assistantSession()}
                  fallback={<div class="workbench-placeholder"><Icon name="session" /><strong>{assistantLoading() ? "Opening assistant..." : "Assistant unavailable"}</strong><span>{assistantLoading() ? "Creating a project-scoped OpenCodeX session." : "Open a project or workspace to start an assistant session."}</span></div>}
                >
                  {(session) => (
                    <SessionPage
                      session={session()}
                      data={assistantData()}
                      loading={assistantLoading()}
                      prompt=""
                      setPrompt={restoreAssistantPrompt}
                      providers={props.snapshot?.providers ?? []}
                      mcp={props.snapshot?.mcp ?? {}}
                      mcpResources={props.snapshot?.mcpResources ?? {}}
                      lsp={props.snapshot?.lsp ?? []}
                      config={props.snapshot?.config}
                      agents={props.snapshot?.agents ?? []}
                      findFiles={(input) => activeGui() ? findFiles(activeGui()!, input) : Promise.resolve([])}
                      selectedAgent={props.selectedAgent ?? session().agent ?? ""}
                      setSelectedAgent={props.setSelectedAgent ?? (() => {})}
                      selectedModel={props.selectedModel ?? assistantSessionModel(session())}
                      recentModels={props.recentModels ?? []}
                      setSelectedModel={props.setSelectedModel ?? (() => {})}
                      selectedVariant={props.selectedVariant ?? ""}
                      setSelectedVariant={props.setSelectedVariant ?? (() => {})}
                      submit={(event, prompt) => void submitAssistantPrompt(event, prompt)}
                      permissions={assistantPermissions()}
                      questions={assistantQuestions()}
                      replyPermission={(request, reply) => props.replyPermission?.(request, reply)}
                      replyQuestion={(request, answers) => props.replyQuestion?.(request, answers)}
                      rejectQuestion={(request) => props.rejectQuestion?.(request)}
                      abortSession={props.abortSession ?? (() => {})}
                      renameSession={props.renameSession ?? (() => {})}
                      moveSession={props.moveSession ?? (() => {})}
                      deleteSession={props.deleteSession ?? (() => {})}
                      slashCommands={props.slashCommands?.(session(), assistantData(), restoreAssistantPrompt) ?? []}
                      concealCodeBlocks={props.concealCodeBlocks ?? false}
                      showTimestamps={props.showTimestamps ?? false}
                      showThinking={props.showThinking ?? true}
                      showToolDetails={props.showToolDetails ?? true}
                      showScrollbar={props.showScrollbar ?? true}
                      showGenericToolOutput={props.showGenericToolOutput ?? true}
                      toggleCodeConceal={props.toggleCodeConceal ?? (() => {})}
                      toggleTimestamps={props.toggleTimestamps ?? (() => {})}
                      toggleThinking={props.toggleThinking ?? (() => {})}
                      toggleToolDetails={props.toggleToolDetails ?? (() => {})}
                      toggleScrollbar={props.toggleScrollbar ?? (() => {})}
                      toggleGenericToolOutput={props.toggleGenericToolOutput ?? (() => {})}
                      status={props.snapshot?.sessionStatus[session().id]?.type}
                      composerState={assistantComposer()}
                      updateComposerState={updateAssistantComposer}
                      loadOlderMessages={(cursor) => loadAssistantSession(session(), cursor)}
                    />
                  )}
                </Show>
              </aside>
            </Show>
          </div>
        </Match>

        <Match when={tab() === "git"}>
          <div class="workbench-git-desktop">
            <header class="workbench-repository-bar">
              <div>
                <span>Current Branch</span>
                <strong>{gitStatus()?.branch ?? branches()?.current ?? "No branch"}</strong>
              </div>
              <div>
                <span>Remote</span>
                <strong>{gitStatus()?.remoteUrl ? compactPath(gitStatus()?.remoteUrl) : "No origin remote"}</strong>
              </div>
              <div>
                <span>Tracking</span>
                <strong title={gitStatus()?.upstream}>{gitTrackingLabel(gitStatus())}</strong>
              </div>
              <div class="workbench-repository-actions">
                <select value={branchName()} onChange={(event) => {
                  setBranchName(event.currentTarget.value)
                  if (event.currentTarget.value && event.currentTarget.value !== (gitStatus()?.branch ?? branches()?.current)) void checkoutBranch(event.currentTarget.value)
                }}>
                  <For each={branches()?.branches ?? []}>{(branch) => <option value={branch}>{branch}</option>}</For>
                </select>
                <button type="button" disabled={!activeGui()} onClick={() => void runRemoteGit("fetch")}><Icon name="activity" /> Fetch</button>
                <button type="button" disabled={!activeGui() || !gitStatus()?.upstream} onClick={() => void runRemoteGit("pull")}><Icon name="chevronDown" /> Pull</button>
                <Show
                  when={gitStatus()?.remoteUrl && gitStatus()?.branch && !gitStatus()?.upstream}
                  fallback={<button type="button" disabled={!activeGui() || !gitStatus()?.upstream} onClick={() => void runRemoteGit("push")}><Icon name="send" /> Push</button>}
                >
                  <button type="button" class="primary" disabled={!activeGui()} onClick={() => void runRemoteGit("publish")}><Icon name="send" /> Publish branch</button>
                </Show>
                <details class="workbench-menu">
                  <summary aria-label="More Git actions" title="More Git actions"><Icon name="more" /></summary>
                  <div class="workbench-menu-popover">
                    <label class="workbench-menu-field">
                      <span>New branch</span>
                      <input value={branchName()} onInput={(event) => setBranchName(event.currentTarget.value)} placeholder="branch name" />
                    </label>
                    <button type="button" disabled={!branchName().trim()} onClick={() => void createBranch()}><Icon name="plus" /> Create branch</button>
                  </div>
                </details>
              </div>
            </header>
            <div class="workbench-git-main">
              <aside class="workbench-changes-panel">
                <div class="workbench-segmented" role="tablist" aria-label="Git views">
                  <button type="button" classList={{ active: gitView() === "changes" }} role="tab" aria-selected={gitView() === "changes"} onClick={() => setGitView("changes")}>Changes <span>{allGitFiles().length}</span></button>
                  <button type="button" classList={{ active: gitView() === "history" }} role="tab" aria-selected={gitView() === "history"} onClick={() => setGitView("history")}>History</button>
                </div>
                <div class="workbench-git-message-slot">
                  <Show when={gitMessage()}><div class="notice error">{gitMessage()}</div></Show>
                </div>
                <Switch>
                  <Match when={gitView() === "changes"}>
                    <div class="workbench-change-stack">
                      <div class="workbench-change-controls">
                      <div class="workbench-git-filter">
                        <Icon name="search" />
                        <input
                          value={gitFilter()}
                          onInput={(event) => setGitFilter(event.currentTarget.value)}
                          placeholder="Filter changed files"
                        />
                        <button type="button" disabled={!gitFilter()} onClick={() => setGitFilter("")}><Icon name="x" /></button>
                      </div>
                      </div>
                      <div class="workbench-change-list" role="listbox" aria-label="Changed files">
                        <Show
                          when={selectedGitFiles().length > 0}
                          fallback={<div class="workbench-empty-state">{gitLoading() ? "Refreshing local changes..." : allGitFiles().length > 0 ? "No changed files match this filter." : gitStatus()?.message ?? "No local changes."}</div>}
                        >
                          <label class="workbench-change-select-all">
                            <input
                              type="checkbox"
                              checked={visibleGitAllStaged()}
                              ref={(element) => createEffect(() => {
                                element.indeterminate = visibleGitSomeStaged()
                              })}
                              onChange={toggleVisibleGitSelection}
                            />
                            <span>{selectedGitFiles().length} file{selectedGitFiles().length === 1 ? "" : "s"} changed</span>
                          </label>
                          <Show when={visibleStagedGitFiles().length > 0}>
                            <section class="workbench-change-group">
                              <header>
                                <span>Staged</span>
                                <small>{visibleStagedGitFiles().length}</small>
                              </header>
                              <For each={visibleStagedGitFiles()}>{(file) => gitChangeFileButton(file)}</For>
                            </section>
                          </Show>
                          <Show when={visibleUnstagedGitFiles().length > 0}>
                            <section class="workbench-change-group">
                              <header>
                                <span>Changes</span>
                                <small>{visibleUnstagedGitFiles().length}</small>
                              </header>
                              <For each={visibleUnstagedGitFiles()}>{(file) => gitChangeFileButton(file)}</For>
                            </section>
                          </Show>
                        </Show>
                      </div>
                    </div>
                    <section class="workbench-commit-box">
                      <input value={commitMessage()} onInput={(event) => setCommitMessage(event.currentTarget.value)} placeholder="Summary" />
                      <textarea value={commitBody()} onInput={(event) => setCommitBody(event.currentTarget.value)} placeholder="Description" />
                      <button type="button" class="primary" disabled={!commitMessage().trim() || stagedGitFiles().length === 0} onClick={() => void commit()}><Icon name="check" /> Commit to {gitStatus()?.branch ?? "branch"}</button>
                    </section>
                  </Match>
                  <Match when={gitView() === "history"}>
                    <div class="workbench-history-list" role="listbox" aria-label="Git history">
                      <For each={gitHistory()} fallback={<div class="workbench-empty-state">{gitLoading() ? "Refreshing history..." : "No commits found."}</div>}>
                        {(commit) => (
                          <button
                            type="button"
                            class="workbench-history-row"
                            classList={{ selected: selectedHistoryCommit()?.hash === commit.hash }}
                            onClick={() => setSelectedHistoryHash(commit.hash)}
                          >
                            <strong>{commit.subject || commit.shortHash}</strong>
                            <span>{commit.author} - {formatHistoryDate(commit.date)}</span>
                            <small>{commit.shortHash} - {commit.files.length} file{commit.files.length === 1 ? "" : "s"}</small>
                          </button>
                        )}
                      </For>
                    </div>
                  </Match>
                </Switch>
                <details class="workbench-secondary-section">
                  <summary><Icon name="panel" /> Stashes <span>{gitStashes().length}</span></summary>
                  <section class="workbench-stash-box">
                    <header>
                    <div>
                      <strong>Stashed changes</strong>
                      <span>{gitStashes().length} stash{gitStashes().length === 1 ? "" : "es"}</span>
                    </div>
                    </header>
                    <div class="workbench-stash-create">
                      <input value={stashMessage()} onInput={(event) => setStashMessage(event.currentTarget.value)} placeholder="Stash message" />
                      <button type="button" disabled={selectedGitFiles().length === 0} onClick={() => void createStash()}><Icon name="panel" /> Stash changes</button>
                    </div>
                    <div class="workbench-stash-list">
                      <For each={gitStashes()} fallback={<div class="empty">No stashes.</div>}>
                        {(stash) => (
                          <article class="workbench-stash-row">
                            <div>
                              <strong>{stash.message || stash.ref}</strong>
                              <span>{stash.ref}{stash.age ? ` - ${stash.age}` : ""}</span>
                            </div>
                            <div class="row-actions">
                              <button type="button" onClick={() => void runStash("apply", stash.ref)}><Icon name="check" /> Apply</button>
                              <button type="button" onClick={() => void runStash("pop", stash.ref)}><Icon name="send" /> Pop</button>
                              <button type="button" class="danger" onClick={() => void runStash("drop", stash.ref)}><Icon name="trash" /> Drop</button>
                            </div>
                          </article>
                        )}
                      </For>
                    </div>
                  </section>
                </details>
              </aside>
              <section class="workbench-diff-panel">
                <header>
                  <div>
                    <strong>{gitView() === "history" ? selectedHistoryCommit()?.subject ?? "No commit selected" : selectedGitFile()?.path ?? "No file selected"}</strong>
                    <span>{gitView() === "history" ? selectedHistoryCommit() ? `${selectedHistoryCommit()?.shortHash} - ${selectedHistoryCommit()?.files.length ?? 0} changed file${selectedHistoryCommit()?.files.length === 1 ? "" : "s"}` : "Select a commit to inspect." : gitDiffMessage() || (selectedGitDiff() ? `+${selectedGitDiff()?.additions ?? 0} -${selectedGitDiff()?.deletions ?? 0}${gitDiffLoading() ? " - refreshing" : ""}` : selectedGitFile() ? "No text patch returned for this file." : "Select a changed file to review its diff.")}</span>
                  </div>
                </header>
                <Show
                  when={gitView() === "changes"}
                  fallback={<WorkbenchHistoryPreview commit={selectedHistoryCommit()} />}
                >
                  <WorkbenchDiffPreview diff={selectedGitDiff()} loading={gitDiffLoading()} message={gitDiffMessage()} />
                </Show>
              </section>
            </div>
          </div>
        </Match>

        <Match when={tab() === "browser"}>
          <div class="workbench-browser">
            <div class="workbench-browser-tabs" role="tablist" aria-label="Browser tabs">
              <For each={browserTabs()}>
                {(item) => (
                  <div
                    role="tab"
                    tabIndex={0}
                    aria-selected={activeBrowserID() === item.id}
                    class="workbench-browser-tab"
                    classList={{ active: activeBrowserID() === item.id }}
                    onClick={() => setActiveBrowserID(item.id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return
                      event.preventDefault()
                      setActiveBrowserID(item.id)
                    }}
                  >
                    <span>{workbenchBrowserTabLabel(item)}</span>
                    <button
                      type="button"
                      aria-label={`Close ${workbenchBrowserTabLabel(item)}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        closeBrowserTab(item.id)
                      }}
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                )}
              </For>
              <button type="button" class="workbench-browser-new-tab" aria-label="New browser tab" onClick={() => createBrowserTab()}><Icon name="plus" /></button>
            </div>
            <div class="workbench-browser-bar">
              <button type="button" disabled={!browserState()?.canGoBack} onClick={() => void browserAction("back")}><Icon name="chevronLeft" /> Back</button>
              <button type="button" disabled={!browserState()?.canGoForward} onClick={() => void browserAction("forward")}><Icon name="chevronRight" /> Forward</button>
              <Show
                when={browserState()?.loading}
                fallback={<button type="button" onClick={() => void browserAction("reload")}><Icon name="activity" /> Reload</button>}
              >
                <button type="button" onClick={() => void browserAction("stop")}><Icon name="stop" /> Stop</button>
              </Show>
              <input
                value={browserURL()}
                onInput={(event) => setActiveBrowserURL(event.currentTarget.value)}
                onKeyDown={(event) => event.key === "Enter" && void navigateBrowser()}
                placeholder="Search or enter address"
              />
              <button type="button" class="primary" onClick={() => void navigateBrowser()}><Icon name="send" /> Go</button>
              <button type="button" onClick={() => void captureScreenshot()}><Icon name="panel" /> Screenshot</button>
              <button type="button" onClick={saveBrowserPageArtifact}><Icon name="pin" /> Save page</button>
              <button type="button" onClick={() => promptAgent(`Look at the embedded browser page ${browserState()?.url || browserURL()}. Tell me what to test next and what UI issues to watch for.`)}><Icon name="send" /> Ask agent</button>
              <button type="button" onClick={() => void window.opencodex?.browser?.devtools(browserID())}><Icon name="settings" /> DevTools</button>
            </div>
            <div class="workbench-browser-host" ref={(element) => { browserHost = element }} />
          </div>
        </Match>

        <Match when={tab() === "artifacts"}>
          <section class="workbench-artifacts">
            <header class="workbench-artifacts-header">
              <div>
                <strong>{artifacts().length} artifact{artifacts().length === 1 ? "" : "s"}</strong>
                <span>Saved browser captures, file notes, and diff context.</span>
              </div>
              <div class="row-actions">
                <button type="button" onClick={() => setTab("browser")}><Icon name="browser" /> Browser</button>
                <button type="button" disabled={artifacts().length === 0} onClick={() => setArtifacts([])}><Icon name="trash" /> Clear all</button>
              </div>
            </header>
            <For
              each={artifacts()}
              fallback={(
                <div class="workbench-empty-state">
                  <strong>No artifacts yet</strong>
                  <span>Capture a browser screenshot or ask an agent to save something useful from the Workbench.</span>
                  <button type="button" onClick={() => setTab("browser")}><Icon name="panel" /> Open browser</button>
                </div>
              )}
            >
              {(artifact) => (
                <article class="workbench-artifact">
                  <header>
                    <div>
                      <strong>{artifact.title}</strong>
                      <span>{artifact.kind} - {new Date(artifact.created).toLocaleString()}</span>
                    </div>
                    <div class="row-actions">
                      <button type="button" onClick={() => promptArtifact(artifact)}><Icon name="send" /> Send</button>
                      <Show when={workbenchArtifactOpenURL(artifact)}>
                        {(url) => <button type="button" onClick={() => openWorkbenchBrowserURL(url(), artifact.title)}><Icon name="browser" /> Open</button>}
                      </Show>
                      <button type="button" class="danger" onClick={() => setArtifacts((items) => removeWorkbenchArtifact(items, artifact.id))}><Icon name="trash" /> Delete</button>
                    </div>
                  </header>
                  <Show when={artifact.kind === "screenshot" ? artifact.url : undefined}>
                    {(url) => <img src={url()} alt={artifact.title} />}
                  </Show>
                  <Show when={artifact.kind === "link" && artifact.url ? artifact.url : undefined}>
                    {(url) => <div class="workbench-artifact-link"><Icon name="browser" /><span>{url()}</span></div>}
                  </Show>
                  <Show when={artifact.text}><pre>{artifact.text}</pre></Show>
                </article>
              )}
            </For>
          </section>
        </Match>
      </Switch>
    </section>
  )
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

function newBrowserID() {
  return `workbench-${Math.random().toString(36).slice(2)}`
}

function gitStatusSymbol(file: WorkbenchGitStatus["files"][number]) {
  if (file.status === "added") return "A"
  if (file.status === "deleted") return "D"
  return "M"
}

function gitTrackingLabel(status: WorkbenchGitStatus | undefined) {
  if (!status?.upstream) return "No upstream"
  const parts = [
    status.ahead ? `${status.ahead} ahead` : "",
    status.behind ? `${status.behind} behind` : "",
  ].filter(Boolean)
  return parts.length ? parts.join(", ") : "Up to date"
}

function WorkbenchDiffPreview(props: { diff?: WorkbenchDiffFile; loading?: boolean; message?: string }) {
  return (
    <div class="workbench-diff-body" classList={{ "workbench-diff-refreshing": !!props.loading }}>
      <Show when={props.loading}>
        <div class="workbench-refresh-badge">Refreshing diff</div>
      </Show>
      <Show when={!props.message} fallback={<div class="workbench-empty-state">{props.message}</div>}>
        <Show when={props.diff} fallback={<div class="workbench-empty-state">{props.loading ? "Loading diff..." : "No text patch is available for the selected file."}</div>}>
      {(diff) => (
        <div class="workbench-diff-preview">
          <Show when={diff().patch} fallback={<div class="workbench-empty-state">This file has no text patch preview.</div>}>
            {(patch) => (
              <WorkbenchUnifiedPatch patch={patch()} />
            )}
          </Show>
        </div>
      )}
        </Show>
      </Show>
    </div>
  )
}

function WorkbenchUnifiedPatch(props: { patch: string }) {
  const rows = createMemo(() => workbenchPatchRows(props.patch))
  return (
    <div class="workbench-unified-patch" role="table" aria-label="Git diff">
      <For each={rows()}>
        {(row) => (
          <div class={`workbench-patch-row ${row.kind}`} role="row">
            <span class="line-number old">{row.oldLine ?? ""}</span>
            <span class="line-number new">{row.newLine ?? ""}</span>
            <span class="line-prefix">{patchRowPrefix(row.kind)}</span>
            <code>{row.text || " "}</code>
          </div>
        )}
      </For>
    </div>
  )
}

function patchRowPrefix(kind: "meta" | "hunk" | "context" | "addition" | "deletion") {
  if (kind === "addition") return "+"
  if (kind === "deletion") return "-"
  return ""
}

function WorkbenchHistoryPreview(props: { commit?: WorkbenchGitHistoryCommit }) {
  return (
    <Show when={props.commit} fallback={<div class="workbench-empty-state">Select a commit to inspect its changed files.</div>}>
      {(commit) => (
        <div class="workbench-history-preview">
          <header>
            <strong>{commit().subject}</strong>
            <span>{commit().shortHash} - {commit().author} - {formatHistoryDate(commit().date)}</span>
          </header>
          <Show when={commit().body}>
            {(body) => <pre>{body()}</pre>}
          </Show>
          <div class="workbench-history-files">
            <For each={commit().files} fallback={<div class="workbench-empty-state">No file list returned for this commit.</div>}>
              {(file) => (
                <div class="workbench-history-file">
                  <span class={`workbench-file-status ${historyStatusClass(file.status)}`}>{file.status.slice(0, 1)}</span>
                  <span>{file.path}</span>
                  <Show when={file.previousPath}>
                    {(previousPath) => <small>from {previousPath()}</small>}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      )}
    </Show>
  )
}

function WorkbenchDiagnosticsBar(props: {
  loading: boolean
  message: string
  command: string
  diagnostics: WorkbenchDiagnostic[]
  total: number
  onOpen: (path: string) => void
}) {
  const visible = createMemo(() => props.diagnostics.slice(0, 4))
  return (
    <Show when={props.loading || props.total > 0 || props.message}>
      <div class="workbench-diagnostics-bar" classList={{ loading: props.loading, clean: !props.loading && props.total === 0 }}>
        <div class="workbench-diagnostics-summary">
          <Icon name={props.total > 0 ? "warning" : "check"} />
          <span>{props.loading ? "Running project checks..." : props.total > 0 ? `${props.total} project issue${props.total === 1 ? "" : "s"}` : props.message}</span>
          <Show when={props.command}>
            <small>{props.command}</small>
          </Show>
        </div>
        <For each={visible()}>
          {(item) => (
            <button
              type="button"
              class={`workbench-diagnostic-row ${item.severity}`}
              disabled={!item.path}
              onClick={() => item.path ? props.onOpen(item.path) : undefined}
            >
              <span>{item.severity}</span>
              <strong>{item.path ? `${item.path}${item.line ? `:${item.line}${item.column ? `:${item.column}` : ""}` : ""}` : "Project"}</strong>
              <em>{item.message}</em>
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}

function assistantSessionModel(session: Session) {
  if (!session.model) return ""
  return modelValue(session.model.providerID, session.model.id)
}

function workbenchDiffsEqual(left: WorkbenchDiffFile[], right: WorkbenchDiffFile[]) {
  if (left.length !== right.length) return false
  return left.every((item, index) => {
    const other = right[index]
    return other &&
      item.file === other.file &&
      item.patch === other.patch &&
      item.additions === other.additions &&
      item.deletions === other.deletions &&
      item.status === other.status
  })
}

function diagnosticMatchesPath(diagnostic: WorkbenchDiagnostic, path: string) {
  const left = workbenchPathKey(diagnostic.path)
  const right = workbenchPathKey(path)
  if (!left || !right) return false
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
}

function historyStatusClass(status: string) {
  if (status.startsWith("A")) return "added"
  if (status.startsWith("D")) return "deleted"
  return "modified"
}

function formatHistoryDate(value: string) {
  if (!value) return "unknown date"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

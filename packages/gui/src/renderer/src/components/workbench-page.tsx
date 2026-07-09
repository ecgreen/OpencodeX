import type { FileContent, FileNode } from "@opencode-ai/sdk/v2/client"
import {
  createWorkbenchFile,
  deleteWorkbenchFile,
  findFiles,
  listWorkbenchFiles,
  readWorkbenchFile,
  renameWorkbenchFile,
  workbenchDiagnostics,
  writeWorkbenchFile,
  type GuiSnapshot,
  type WorkbenchDiagnostic,
  type WorkbenchDiagnosticsResult,
  type WorkbenchOperationResult,
} from "../lib/store"
import {
  addWorkbenchArtifact,
  closeWorkbenchBuffer,
  flattenWorkbenchFileTree,
  readWorkbenchState,
  renameWorkbenchBuffer,
  writeWorkbenchState,
  updateWorkbenchBuffer,
  upsertWorkbenchBuffer,
  workbenchAncestorPaths,
  workbenchBufferDirty,
  workbenchClampPaneWidth,
  workbenchDirtyBufferPaths,
  workbenchDirtyPathSet,
  workbenchDiffPrompt,
  workbenchOpenFileOptions,
  workbenchNewFileDraft,
  workbenchPathKey,
  removeWorkbenchArtifact,
  workbenchUnsavedBufferDiff,
  workbenchUnsavedChangesMessage,
  type WorkbenchArtifact,
  type WorkbenchFileBuffer,
  type WorkbenchTab,
  workbenchParentPath,
  workbenchProjectScopes,
  workbenchScopeDirectory,
  WORKBENCH_ASSISTANT_WIDTH,
  WORKBENCH_EXPLORER_WIDTH,
} from "../lib/workbench"
import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createWorkbenchAssistantController } from "./workbench-assistant-controller"
import { createWorkbenchBrowserController } from "./workbench-browser-controller"
import { createWorkbenchGitController } from "./workbench-git-controller"
import { WorkbenchArtifactsPanel } from "./workbench-artifacts-panel"
import { WorkbenchBrowserPanel } from "./workbench-browser-panel"
import { WorkbenchFilesTab } from "./workbench-files-tab"
import { WorkbenchGitPanel } from "./workbench-git-panel"
import { WorkbenchTabs } from "./workbench-tabs"
import { assistantSessionModel, diagnosticMatchesPath, errorText, gitStatusSymbol, newBrowserID } from "./workbench-page-helpers"
import type { WorkbenchPageProps } from "./workbench-page-types"

export function WorkbenchPage(props: WorkbenchPageProps) {
  const persistedWorkbench = readWorkbenchState()
  const fallbackBrowserID = newBrowserID()
  const initialBrowserTabs = persistedWorkbench.browserTabs?.length
    ? persistedWorkbench.browserTabs
    : [{ id: fallbackBrowserID, url: "http://localhost:5173", title: "Localhost" }]
  const [tab, setTab] = createSignal<WorkbenchTab>(persistedWorkbench.tab ?? "files")
  const [notice, setNotice] = createSignal("")
  const [filesByPath, setFilesByPath] = createSignal<Record<string, FileNode[]>>({})
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set())
  const [selectedProjectID, setSelectedProjectID] = createSignal(props.projectID ?? "")
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
  const [openFileModalOpen, setOpenFileModalOpen] = createSignal(false)
  const [activePath, setActivePath] = createSignal("")
  const [buffers, setBuffers] = createSignal<WorkbenchFileBuffer<FileContent>[]>([])
  const [editorSelection, setEditorSelection] = createSignal("")
  const [diagnostics, setDiagnostics] = createSignal<WorkbenchDiagnostic[]>([])
  const [diagnosticsLoading, setDiagnosticsLoading] = createSignal(false)
  const [diagnosticsMessage, setDiagnosticsMessage] = createSignal("")
  const [diagnosticsCommand, setDiagnosticsCommand] = createSignal("")
  const [busy, setBusy] = createSignal("")
  const [artifacts, setArtifacts] = createSignal<WorkbenchArtifact[]>(persistedWorkbench.artifacts ?? [])
  let newFileInput: HTMLInputElement | undefined
  let explorerSearchToken = 0
  let openFileSearchToken = 0
  let diagnosticsToken = 0
  const browser = createWorkbenchBrowserController({
    initialTabs: initialBrowserTabs,
    initialActiveID: persistedWorkbench.activeBrowserID ?? initialBrowserTabs[0]?.id ?? fallbackBrowserID,
    setArtifacts,
    setNotice,
    setTab,
  })

  const activeGui = createMemo(() => props.gui)
  const activeBuffer = createMemo(() => buffers().find((buffer) => buffer.path === activePath()))
  const fileContent = createMemo(() => activeBuffer()?.fileContent)
  const dirty = createMemo(() => workbenchBufferDirty(activeBuffer()))
  const openPath = createMemo(() => activePath())
  const projectOptions = createMemo(() => workbenchProjectScopes(props.projects ?? [], activeGui()?.directory ?? ""))
  const selectedProject = createMemo(() => projectOptions().find((project) => project.id === selectedProjectID()) ?? projectOptions()[0])
  const selectedDirectory = createMemo(() => workbenchScopeDirectory(selectedProject(), activeGui()?.directory ?? ""))
  const git = createWorkbenchGitController({
    activeGui,
    selectedDirectory,
    confirm: confirmWorkbench,
    runOperation,
    setNotice,
  })
  const gitStatus = git.status
  const branches = git.branches
  const gitDiffs = git.diffs
  const gitStashes = git.stashes
  const gitHistory = git.history
  const gitLoading = git.loading
  const gitDiffLoading = git.diffLoading
  const gitMessage = git.message
  const gitDiffMessage = git.diffMessage
  const gitFilter = git.filter
  const setGitFilter = git.setFilter
  const gitView = git.view
  const setGitView = git.setView
  const selectedGitFile = git.selectedFile
  const selectedGitDiff = git.selectedDiff
  const selectedHistoryCommit = git.selectedHistoryCommit
  const stagedGitFiles = git.stagedFiles
  const visibleStagedGitFiles = git.visibleStagedFiles
  const visibleUnstagedGitFiles = git.visibleUnstagedFiles
  const visibleGitAllStaged = git.visibleAllStaged
  const visibleGitSomeStaged = git.visibleSomeStaged
  const selectedGitFiles = git.selectedFiles
  const allGitFiles = git.allFiles
  const gitStatusByPath = git.statusByPath
  const branchName = git.branchName
  const setBranchName = git.setBranchName
  const commitMessage = git.commitMessage
  const setCommitMessage = git.setCommitMessage
  const commitBody = git.commitBody
  const setCommitBody = git.setCommitBody
  const stashMessage = git.stashMessage
  const setStashMessage = git.setStashMessage
  const assistant = createWorkbenchAssistantController({
    props,
    activeGui,
    selectedProject,
    selectedDirectory,
    activeBuffer,
    editorSelection,
    initialSessions: persistedWorkbench.assistantSessions ?? {},
    setNotice,
  })
  const assistantSession = assistant.session
  const assistantData = assistant.data
  const assistantLoading = assistant.loading
  const assistantPermissions = assistant.permissions
  const assistantQuestions = assistant.questions
  const assistantComposer = assistant.composer
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
    limit: openFileModalOpen() ? 24 : 8,
  }))
  const activeDiagnostics = createMemo(() => diagnostics().filter((item) => diagnosticMatchesPath(item, openPath())))
  onMount(() => {
    void git.refresh()
    const syncOnFocus = () => {
      if (tab() === "files") void syncLoadedFileFolders()
      if (tab() === "git") void git.refresh()
    }
    window.addEventListener("focus", syncOnFocus)
    onCleanup(() => window.removeEventListener("focus", syncOnFocus))
  })

  createEffect(() => {
    const options = projectOptions()
    if (props.projectID && options.some((option) => option.id === props.projectID)) {
      setSelectedProjectID(props.projectID)
      return
    }
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
    setOpenFileModalOpen(false)
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
    git.reset()
    void refreshFiles("")
    void git.refresh()
  })

  createEffect(() => {
    if (!assistantOpen() || tab() !== "files") return
    void assistant.ensureSession()
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
      browser.hideTabs()
      return
    }
    void browser.ensure()
    browser.updateBounds()
  })

  createEffect(() => {
    const currentTab = tab()
    const directory = selectedDirectory()
    const gui = activeGui()
    if (!gui || !directory || (currentTab !== "files" && currentTab !== "git")) return
    const interval = window.setInterval(() => {
      if (tab() === "files") void syncLoadedFileFolders()
      if (tab() === "git") void git.refresh()
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
      assistantSessions: assistant.sessions(),
      browserTabs: browser.tabs(),
      activeBrowserID: browser.activeID(),
      artifacts: artifacts(),
    })
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
      void git.refresh()
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

  async function selectProject(projectID: string, select?: HTMLSelectElement) {
    if (projectID === selectedProjectID()) return
    const dirtyPaths = workbenchDirtyBufferPaths(buffers())
    if (dirtyPaths.length > 0 && !(await confirmWorkbench({
      title: "Switch Project",
      message: workbenchUnsavedChangesMessage(dirtyPaths, "Switch projects and discard these unsaved editor changes?"),
      confirm: "Switch",
    }))) {
      if (select) select.value = selectedProjectID()
      return
    }
    setSelectedProjectID(projectID)
  }

  async function closeEditorBuffer(buffer: WorkbenchFileBuffer<FileContent>) {
    if (workbenchBufferDirty(buffer) && !(await confirmWorkbench({
      title: "Close Unsaved File",
      message: workbenchUnsavedChangesMessage([buffer.path], "Close this editor tab and discard its unsaved changes?"),
      confirm: "Close",
    }))) return
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
      void git.refresh()
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
        void git.refresh()
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
    const to = (await askWorkbenchText({ title: "Rename File", message: "Enter the new workspace path.", value: from }))?.trim()
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
    if (!(await confirmWorkbench({
      title: "Delete File",
      message: `Delete ${path}?\n\nThis removes the file from the selected workspace.`,
      confirm: "Delete",
    }))) return
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
      void git.refresh()
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

  function askWorkbenchText(input: { title: string; message?: string; value?: string; multiline?: boolean }) {
    return props.askText?.(input) ?? Promise.resolve(undefined)
  }

  function confirmWorkbench(input: { title: string; message: string; confirm?: string }) {
    return props.confirm?.(input) ?? Promise.resolve(false)
  }

  function promptAgent(text: string) {
    props.sendToComposer?.(text)
    setNotice("Sent context to the composer.")
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

  function promptDiagnosticFix(item: WorkbenchDiagnostic) {
    const location = item.path ? `${item.path}${item.line ? `:${item.line}${item.column ? `:${item.column}` : ""}` : ""}` : "Project"
    promptAgent([
      `Fix this ${item.severity} reported by Workbench diagnostics.`,
      "",
      `Location: ${location}`,
      `Message: ${item.message}`,
      diagnosticsCommand() ? `Command: ${diagnosticsCommand()}` : "",
      "",
      "Suggest the smallest safe patch and explain why it fixes the issue.",
    ].filter(Boolean).join("\n"))
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

  async function openDirectFile(pathInput?: string) {
    const path = workbenchPathKey((pathInput ?? openFileQuery()).trim())
    const option = openFileOptions().find((file) => workbenchPathKey(file.path) === path) ?? openFileOptions()[0]
    const target = option?.path ?? path
    if (!target) return
    await openFile(target)
    setOpenFileQuery("")
    setOpenFileModalOpen(false)
  }

  function openFilePalette() {
    setOpenFileModalOpen(true)
    queueMicrotask(() => document.querySelector<HTMLInputElement>(".workbench-open-file-modal input")?.focus())
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
      <WorkbenchTabs tab={tab} setTab={setTab} />

      <Show when={notice()}>
        <div class="notice">{notice()}</div>
      </Show>

      <Switch>
        <Match when={tab() === "files"}>
          <WorkbenchFilesTab
            explorerCollapsed={explorerCollapsed}
            assistantOpen={assistantOpen}
            explorerWidth={explorerWidth}
            assistantWidth={assistantWidth}
            startPaneResize={startPaneResize}
            explorer={{
              collapsed: explorerCollapsed,
              setCollapsed: setExplorerCollapsed,
              canUseWorkspace: () => !!activeGui() && !!selectedDirectory(),
              selectedDirectory,
              startNewFile,
              startNewFolder,
              projectOptions,
              selectedProjectID,
              selectProject: (value, element) => void selectProject(value, element),
              filter: explorerFilter,
              setFilter: setExplorerFilter,
              openFilePalette,
              newFilePath,
              newItemKind,
              setNewFilePath,
              filePath,
              setNewFileInput: (element) => { newFileInput = element },
              createExplorerItem: () => void createExplorerItem(),
              searchState: explorerSearchState,
              matches: explorerMatches,
              openPath,
              dirtyPaths,
              gitStatusByPath,
              toggleFolder: (node) => void toggleFolder(node),
              openFile: (path) => void openFile(path),
              rows: fileTreeRows,
              busy,
              gitStatusSymbol,
            }}
            editor={{
              buffers,
              activePath,
              openPath,
              dirty,
              activeBuffer,
              fileContent,
              activeDiagnostics,
              diagnostics,
              diagnosticsLoading,
              diagnosticsMessage,
              diagnosticsCommand,
              gitStatusByPath,
              setActivePath,
              revealFile: (path) => void revealFileInExplorer(path),
              closeBuffer: (buffer) => void closeEditorBuffer(buffer),
              revertFile: () => setBuffers((current) => updateWorkbenchBuffer(current, activePath(), (buffer) => ({ ...buffer, content: buffer.original }))),
              saveFile: () => void saveFile(),
              sendContext: promptFileContext,
              askAboutEdits: promptUnsavedDiff,
              saveArtifact: saveFileArtifact,
              saveEditsArtifact: saveUnsavedDiffArtifact,
              renameFile: () => void renameFile(),
              deleteFile: () => void deleteFile(),
              assistantOpen,
              setAssistantOpen,
              openDiagnostic: (path) => void openFile(path),
              fixDiagnostic: promptDiagnosticFix,
              changeBuffer: (path, value) => setBuffers((current) => updateWorkbenchBuffer(current, path, (item) => ({ ...item, content: value }))),
              saveActiveFile: () => void saveFile(),
              setEditorSelection,
              gitStatusSymbol,
            }}
            assistant={{
              session: assistantSession(),
              data: assistantData(),
              loading: assistantLoading(),
              contextPath: openPath(),
              contextLabel: selectedProject()?.label ?? "Workspace",
              close: () => setAssistantOpen(false),
              sessionPage: {
                prompt: "",
                setPrompt: assistant.restorePrompt,
                providers: props.snapshot?.providers ?? [],
                mcp: props.snapshot?.mcp ?? {},
                mcpResources: props.snapshot?.mcpResources ?? {},
                lsp: props.snapshot?.lsp ?? [],
                config: props.snapshot?.config,
                agents: props.snapshot?.agents ?? [],
                findFiles: (input) => activeGui() ? findFiles(activeGui()!, input) : Promise.resolve([]),
                selectedAgent: props.selectedAgent ?? assistantSession()?.agent ?? "",
                setSelectedAgent: props.setSelectedAgent ?? (() => {}),
                selectedModel: props.selectedModel ?? (assistantSession() ? assistantSessionModel(assistantSession()!) : ""),
                recentModels: props.recentModels ?? [],
                setSelectedModel: props.setSelectedModel ?? (() => {}),
                selectedVariant: props.selectedVariant ?? "",
                setSelectedVariant: props.setSelectedVariant ?? (() => {}),
                submit: (event, prompt) => void assistant.submit(event, prompt),
                permissions: assistantPermissions(),
                questions: assistantQuestions(),
                replyPermission: (request, reply) => props.replyPermission?.(request, reply),
                replyQuestion: (request, answers) => props.replyQuestion?.(request, answers),
                rejectQuestion: (request) => props.rejectQuestion?.(request),
                renameSession: props.renameSession ?? (() => {}),
                moveSession: props.moveSession ?? (() => {}),
                deleteSession: props.deleteSession ?? (() => {}),
                slashCommands: assistantSession() ? props.slashCommands?.(assistantSession()!, assistantData(), assistant.restorePrompt) ?? [] : [],
                showTimestamps: props.showTimestamps ?? false,
                showThinking: props.showThinking ?? true,
                showToolDetails: props.showToolDetails ?? true,
                showScrollbar: props.showScrollbar ?? true,
                showGenericToolOutput: props.showGenericToolOutput ?? true,
                toggleTimestamps: props.toggleTimestamps ?? (() => {}),
                toggleThinking: props.toggleThinking ?? (() => {}),
                toggleToolDetails: props.toggleToolDetails ?? (() => {}),
                toggleScrollbar: props.toggleScrollbar ?? (() => {}),
                toggleGenericToolOutput: props.toggleGenericToolOutput ?? (() => {}),
                status: assistantSession() ? props.snapshot?.sessionStatus[assistantSession()!.id]?.type : undefined,
                composerState: assistantComposer(),
                updateComposerState: assistant.updateComposer,
                loadOlderMessages: (cursor) => assistantSession() ? assistant.load(assistantSession()!, cursor) : Promise.resolve(),
              },
            }}
            openFileModalOpen={openFileModalOpen}
            openFileModal={{
              projectLabel: selectedProject()?.label ?? "Workspace",
              query: openFileQuery(),
              searchState: openFileSearchState(),
              options: openFileOptions(),
              close: () => setOpenFileModalOpen(false),
              setQuery: setOpenFileQuery,
              openFile: (path) => void openDirectFile(path),
            }}
          />
        </Match>

        <Match when={tab() === "git"}>
          <WorkbenchGitPanel
            active={!!activeGui()}
            status={gitStatus}
            branches={branches}
            branchName={branchName}
            setBranchName={setBranchName}
            checkoutBranch={(branch) => void git.checkoutBranch(branch)}
            runRemoteGit={(action) => void git.runRemote(action)}
            createBranch={() => void git.createBranch()}
            view={gitView}
            setView={setGitView}
            filter={gitFilter}
            setFilter={setGitFilter}
            allFileCount={() => allGitFiles().length}
            message={gitMessage}
            selectedFiles={selectedGitFiles}
            loading={gitLoading}
            allVisibleStaged={visibleGitAllStaged}
            someVisibleStaged={visibleGitSomeStaged}
            toggleVisibleSelection={git.toggleVisibleSelection}
            stagedFiles={visibleStagedGitFiles}
            unstagedFiles={visibleUnstagedGitFiles}
            diffs={gitDiffs}
            selectFile={git.setSelectedPath}
            runGit={(action, path) => void git.runGit(action, path)}
            commitMessage={commitMessage}
            setCommitMessage={setCommitMessage}
            commitBody={commitBody}
            setCommitBody={setCommitBody}
            stagedCount={() => stagedGitFiles().length}
            commit={() => void git.commit()}
            history={gitHistory}
            selectedCommit={selectedHistoryCommit}
            selectCommit={git.setSelectedHistoryHash}
            stashes={gitStashes}
            stashMessage={stashMessage}
            setStashMessage={setStashMessage}
            createStash={() => void git.createStash()}
            runStash={(action, ref) => void git.runStash(action, ref)}
            selectedFile={selectedGitFile}
            diffMessage={gitDiffMessage}
            selectedDiff={selectedGitDiff}
            diffLoading={gitDiffLoading}
          />
        </Match>

        <Match when={tab() === "browser"}>
          <WorkbenchBrowserPanel
            tabs={browser.tabs()}
            activeID={browser.activeID()}
            state={browser.state()}
            url={browser.url()}
            setActiveID={browser.setActiveID}
            closeTab={browser.closeTab}
            createTab={() => browser.createTab()}
            setURL={browser.setURL}
            navigate={() => void browser.navigate()}
            action={(action) => void browser.action(action)}
            captureScreenshot={() => void browser.captureScreenshot()}
            savePage={browser.savePageArtifact}
            askAgent={() => promptAgent(`Look at the embedded browser page ${browser.state()?.url || browser.url()}. Tell me what to test next and what UI issues to watch for.`)}
            openDevtools={() => void window.opencodex?.browser?.devtools(browser.id())}
            setHost={browser.setHost}
          />
        </Match>

        <Match when={tab() === "artifacts"}>
          <WorkbenchArtifactsPanel
            artifacts={artifacts()}
            setTab={setTab}
            promptArtifact={promptArtifact}
            openURL={browser.openURL}
            clear={() => setArtifacts([])}
            deleteArtifact={(id) => setArtifacts((items) => removeWorkbenchArtifact(items, id))}
          />
        </Match>
      </Switch>
    </section>
  )
}

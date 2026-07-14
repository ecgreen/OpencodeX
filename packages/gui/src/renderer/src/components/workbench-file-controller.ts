import type { FileContent, FileNode } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal } from "solid-js"
import {
  createWorkbenchFile,
  deleteWorkbenchFile,
  findFiles,
  listWorkbenchFiles,
  readWorkbenchFile,
  renameWorkbenchFile,
  writeWorkbenchFile,
  type WorkbenchOperationResult,
} from "../lib/store"
import {
  closeWorkbenchBuffer,
  flattenWorkbenchFileTree,
  renameWorkbenchBuffer,
  updateWorkbenchBuffer,
  upsertWorkbenchBuffer,
  workbenchAncestorPaths,
  workbenchBufferDirty,
  workbenchDirtyBufferPaths,
  workbenchDirtyPathSet,
  workbenchNewFileDraft,
  workbenchOpenFileOptions,
  workbenchParentPath,
  workbenchPathKey,
  workbenchProjectScopes,
  workbenchScopeDirectory,
  workbenchUnsavedChangesMessage,
  type WorkbenchFileBuffer,
} from "../lib/workbench"
import { errorText } from "./workbench-page-helpers"
import type { WorkbenchPageProps } from "./workbench-page-types"

export function createWorkbenchFileController(input: {
  props: WorkbenchPageProps
  setNotice: (value: string) => void
  setBusy: (value: string) => void
  runOperation: (operation: () => Promise<WorkbenchOperationResult>) => Promise<WorkbenchOperationResult | undefined>
}) {
  const [filesByPath, setFilesByPath] = createSignal<Record<string, FileNode[]>>({})
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set())
  const [selectedProjectID, setSelectedProjectID] = createSignal(input.props.projectID ?? "")
  const [filePath, setFilePath] = createSignal("")
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
  const [scopeRevision, setScopeRevision] = createSignal(0)
  const [mutationRevision, setMutationRevision] = createSignal(0)
  let newFileInput: HTMLInputElement | undefined
  let explorerSearchToken = 0
  let openFileSearchToken = 0

  const activeGui = createMemo(() => input.props.gui)
  const activeBuffer = createMemo(() => buffers().find((buffer) => buffer.path === activePath()))
  const fileContent = createMemo(() => activeBuffer()?.fileContent)
  const dirty = createMemo(() => workbenchBufferDirty(activeBuffer()))
  const openPath = createMemo(() => activePath())
  const projectOptions = createMemo(() => workbenchProjectScopes(input.props.projects ?? [], activeGui()?.directory ?? ""))
  const selectedProject = createMemo(() => projectOptions().find((project) => project.id === selectedProjectID()) ?? projectOptions()[0])
  const selectedDirectory = createMemo(() => workbenchScopeDirectory(selectedProject(), activeGui()?.directory ?? ""))
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

  createEffect(() => {
    const options = projectOptions()
    if (input.props.projectID && options.some((option) => option.id === input.props.projectID)) {
      setSelectedProjectID(input.props.projectID)
      return
    }
    if (options.some((option) => option.id === selectedProjectID())) return
    setSelectedProjectID(options[0]?.id ?? "")
  })

  createEffect(() => {
    const directory = selectedDirectory()
    if (!directory) return
    explorerSearchToken++
    openFileSearchToken++
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
    setScopeRevision((value) => value + 1)
    void refreshFiles("")
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
        setOpenFileSearchState("error")
      })
  })

  async function refreshFiles(path: string) {
    const gui = activeGui()
    if (!gui || !selectedDirectory()) {
      input.setNotice("Choose a project before refreshing files.")
      return
    }
    input.setBusy("files")
    input.setNotice("")
    try {
      const files = await listWorkbenchFiles(gui, path, selectedDirectory())
      setFilesByPath((current) => ({ ...current, [path]: files }))
      setFilePath(path)
    } catch (err) {
      input.setNotice(errorText(err, "Failed to load files."))
    } finally {
      input.setBusy("")
    }
  }

  async function syncLoadedFileFolders() {
    const gui = activeGui()
    const directory = selectedDirectory()
    if (!gui || !directory) return
    const paths = Object.keys(filesByPath()).length > 0 ? Object.keys(filesByPath()) : [""]
    try {
      const entries = await Promise.all(paths.map((path) =>
        listWorkbenchFiles(gui, path, directory).then((files) => [path, files] as const),
      ))
      setFilesByPath((current) => entries.reduce((next, [path, files]) => ({ ...next, [path]: files }), current))
    } catch {
      // Background reconciliation must not replace still-usable cached file content.
    }
  }

  async function openFile(path: string) {
    const gui = activeGui()
    if (!gui || !selectedDirectory()) return
    await revealFile(path)
    if (buffers().some((buffer) => buffer.path === path)) {
      setActivePath(path)
      return
    }
    input.setBusy("open-file")
    input.setNotice("")
    try {
      const content = await readWorkbenchFile(gui, path, selectedDirectory())
      const text = content?.type === "text" ? content.content : ""
      setBuffers((current) => upsertWorkbenchBuffer(current, { path, content: text, original: text, fileContent: content }))
      setActivePath(path)
      setEditorSelection("")
    } catch (err) {
      input.setNotice(errorText(err, "Failed to open file."))
    } finally {
      input.setBusy("")
    }
  }

  async function revealFile(path: string) {
    const parents = workbenchAncestorPaths(path)
    setExpandedFolders((current) => new Set([...current, ...parents]))
    setFilePath(workbenchParentPath(path))
    await parents
      .filter((parent) => filesByPath()[parent] === undefined)
      .reduce((promise, parent) => promise.then(() => refreshFiles(parent)), Promise.resolve())
  }

  async function selectProject(projectID: string, select?: HTMLSelectElement) {
    if (projectID === selectedProjectID()) return
    const paths = workbenchDirtyBufferPaths(buffers())
    if (paths.length > 0 && !(await confirm({
      title: "Switch Project",
      message: workbenchUnsavedChangesMessage(paths, "Switch projects and discard these unsaved editor changes?"),
      confirm: "Switch",
    }))) {
      if (select) select.value = selectedProjectID()
      return
    }
    setSelectedProjectID(projectID)
  }

  async function closeBuffer(buffer: WorkbenchFileBuffer<FileContent>) {
    if (workbenchBufferDirty(buffer) && !(await confirm({
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
    input.setBusy("save-file")
    input.setNotice("")
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
        input.setNotice(result.message ?? "File was not saved.")
        return
      }
      setBuffers((current) => updateWorkbenchBuffer(current, buffer.path, (item) => ({ ...item, original: item.content })))
      input.setNotice(result.message ?? "Saved.")
      setMutationRevision((value) => value + 1)
    } catch (err) {
      input.setNotice(errorText(err, "Failed to save file."))
    } finally {
      input.setBusy("")
    }
  }

  async function createItem() {
    const gui = activeGui()
    const path = newFilePath().trim()
    if (!gui || !selectedDirectory() || !path) return
    const directory = newItemKind() === "folder"
    const result = await input.runOperation(() => createWorkbenchFile(gui, directory ? { path, directory: true } : { path, content: "" }, selectedDirectory()))
    if (!result?.ok) return
    setNewFilePath("")
    if (directory) {
      setExpandedFolders((current) => new Set([...current, path]))
      setFilePath(path)
      void refreshFiles(workbenchParentPath(path))
      void refreshFiles(path)
      setMutationRevision((value) => value + 1)
      return
    }
    void refreshFiles(workbenchParentPath(path))
    void openFile(path)
    setMutationRevision((value) => value + 1)
  }

  async function renameFile() {
    const gui = activeGui()
    const from = activePath()
    if (!gui || !from) return
    const to = (await askText({ title: "Rename File", message: "Enter the new workspace path.", value: from }))?.trim()
    if (!to || to === from) return
    const result = await input.runOperation(() => renameWorkbenchFile(gui, { from, to }, selectedDirectory()))
    if (!result?.ok) return
    setBuffers((current) => renameWorkbenchBuffer(current, from, to))
    setActivePath(to)
    void refreshFiles(workbenchParentPath(to))
    setMutationRevision((value) => value + 1)
  }

  async function deleteFile() {
    const gui = activeGui()
    const path = activePath()
    if (!gui || !path) return
    if (!(await confirm({
      title: "Delete File",
      message: `Delete ${path}?\n\nThis removes the file from the selected workspace.`,
      confirm: "Delete",
    }))) return
    const result = await input.runOperation(() => deleteWorkbenchFile(gui, path, selectedDirectory()))
    if (!result?.ok) return
    setBuffers((current) => {
      const next = closeWorkbenchBuffer(current, activePath(), path)
      setActivePath(next.activePath)
      return next.buffers
    })
    setEditorSelection("")
    void refreshFiles(workbenchParentPath(path))
    setMutationRevision((value) => value + 1)
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

  function startNewItem(kind: "file" | "folder") {
    setNewItemKind(kind)
    setNewFilePath((current) => workbenchNewFileDraft({ currentDraft: current, folder: filePath() }) || (kind === "file" ? "untitled.txt" : "new-folder"))
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

  function confirm(value: { title: string; message: string; confirm?: string }) {
    return input.props.confirm?.(value) ?? Promise.resolve(false)
  }

  function askText(value: { title: string; message?: string; value?: string; multiline?: boolean }) {
    return input.props.askText?.(value) ?? Promise.resolve(undefined)
  }

  return {
    activeGui, activeBuffer, fileContent, dirty, openPath, projectOptions, selectedProject, selectedDirectory,
    selectedProjectID, selectProject, filesByPath, expandedFolders, filePath, explorerFilter, setExplorerFilter,
    explorerMatches, explorerSearchState, newFilePath, setNewFilePath, newItemKind, openFileQuery, setOpenFileQuery,
    openFileMatches, openFileSearchState, openFileModalOpen, setOpenFileModalOpen, activePath, setActivePath,
    buffers, setBuffers, editorSelection, setEditorSelection, dirtyPaths, fileTreeRows, openFileOptions, scopeRevision,
    mutationRevision, refreshFiles, syncLoadedFileFolders, openFile, revealFile, closeBuffer, saveFile, createItem,
    renameFile, deleteFile, toggleFolder, collapseExplorer, startNewFile: () => startNewItem("file"),
    startNewFolder: () => startNewItem("folder"), openDirectFile, openFilePalette,
    setNewFileInput: (element: HTMLInputElement) => { newFileInput = element },
    changeBuffer: (path: string, value: string) => setBuffers((current) => updateWorkbenchBuffer(current, path, (item) => ({ ...item, content: value }))),
    revertFile: () => setBuffers((current) => updateWorkbenchBuffer(current, activePath(), (buffer) => ({ ...buffer, content: buffer.original }))),
  }
}

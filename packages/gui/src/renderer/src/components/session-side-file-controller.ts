import type { FileNode } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import type { GuiClient } from "../lib/client"
import { compactPath } from "../lib/format"
import { findFiles, listWorkbenchFiles, readWorkbenchFile, writeWorkbenchFile } from "../lib/store"
import { flattenWorkbenchFileTree, workbenchPathKey } from "../lib/workbench"
import type { OpenTab } from "./session-side-open-types"

export function createSessionSideFileController(input: {
  active: Accessor<boolean>
  gui: Accessor<GuiClient | undefined>
  directory: Accessor<string>
  activeID: Accessor<string>
  activeTab: Accessor<OpenTab | undefined>
  createTab: (input: Partial<OpenTab>) => string
  updateTab: (id: string, patch: Partial<OpenTab>) => void
  closeTab: (id: string) => void
  addFileTab: () => void
  hideWebTabs: () => void
}) {
  const [busy, setBusy] = createSignal(false)
  const [filesByPath, setFilesByPath] = createSignal<Record<string, FileNode[]>>({})
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set())
  const [filter, setFilter] = createSignal("")
  const [matches, setMatches] = createSignal<FileNode[]>([])
  const [searchState, setSearchState] = createSignal<"idle" | "loading" | "error">("idle")
  let searchToken = 0

  const rows = createMemo(() => flattenWorkbenchFileTree({
    root: filesByPath()[""] ?? [],
    children: filesByPath(),
    expanded: expandedFolders(),
    filter: filter(),
  }))
  const pickerOpen = createMemo(() => input.activeTab()?.kind === "picker")

  createEffect(() => {
    const directory = input.directory()
    setFilesByPath({})
    setExpandedFolders(new Set<string>())
    setFilter("")
    setMatches([])
    setSearchState(directory ? "idle" : "error")
  })

  createEffect(() => {
    const directory = input.directory()
    if (!input.active() || !pickerOpen() || !input.gui() || !directory || filesByPath()[""] !== undefined) return
    void refresh("")
  })

  createEffect(() => {
    const gui = input.gui()
    const query = filter().trim()
    const directory = input.directory()
    const token = ++searchToken
    if (!pickerOpen() || !gui || !directory || query.length < 2) {
      setMatches([])
      setSearchState("idle")
      return
    }
    setSearchState("loading")
    findFiles(gui, { query, directory, limit: 40 })
      .then((files) => {
        if (token !== searchToken) return
        setMatches(files.filter((file) => file.path))
        setSearchState("idle")
      })
      .catch(() => {
        if (token !== searchToken) return
        setSearchState("error")
      })
  })

  createEffect(() => {
    if (!input.active() || input.activeTab()?.kind !== "file") return
    const save = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return
      event.preventDefault()
      void saveActiveFile()
    }
    document.addEventListener("keydown", save)
    onCleanup(() => document.removeEventListener("keydown", save))
  })

  function openExplorer() {
    if (pickerOpen()) return
    input.addFileTab()
  }

  function openInActiveTab() {
    const tab = input.activeTab()
    if (!tab) {
      input.addFileTab()
      return
    }
    input.hideWebTabs()
    input.updateTab(tab.id, { kind: "picker", input: "", title: "Open file", message: "" })
  }

  function closeExplorer() {
    const tab = input.activeTab()
    if (tab?.kind === "picker" && tab.path) {
      input.updateTab(tab.id, { kind: "file", input: tab.path, title: compactPath(tab.path), message: "" })
      return
    }
    input.closeTab(input.activeID())
  }

  async function refresh(path: string) {
    const gui = input.gui()
    const directory = input.directory()
    if (!gui || !directory) return
    setBusy(true)
    try {
      const files = await listWorkbenchFiles(gui, path, directory)
      setFilesByPath((current) => ({ ...current, [path]: files }))
    } finally {
      setBusy(false)
    }
  }

  async function toggleFolder(file: FileNode) {
    if (expandedFolders().has(file.path)) {
      setExpandedFolders((current) => new Set([...current].filter((path) => path !== file.path)))
      return
    }
    setExpandedFolders((current) => new Set([...current, file.path]))
    if (filesByPath()[file.path] === undefined) await refresh(file.path)
  }

  async function openExplorerFile(path: string) {
    const target = workbenchPathKey(path)
    if (!target) return
    setFilter("")
    if (pickerOpen()) {
      await openFile(input.activeID(), target, undefined, input.directory())
      return
    }
    const id = input.createTab({ input: target, title: compactPath(target), directory: input.directory() })
    await openFile(id, target, undefined, input.directory())
  }

  async function openFile(id: string, path: string, title?: string, directory = input.directory()) {
    const gui = input.gui()
    if (!gui) {
      input.updateTab(id, { kind: "file", path, directory, input: path, title: title || compactPath(path), message: "GUI client is not ready." })
      return
    }
    input.hideWebTabs()
    input.updateTab(id, { kind: "file", path, directory, input: path, title: title || compactPath(path), message: "Loading file..." })
    try {
      const content = await readWorkbenchFile(gui, path, directory)
      const text = content?.type === "text" ? content.content : ""
      input.updateTab(id, { kind: "file", path, directory, input: path, title: title || compactPath(path), content, text, original: text, message: "" })
    } catch (cause) {
      input.updateTab(id, { message: cause instanceof Error ? cause.message : "Failed to open file." })
    }
  }

  async function saveActiveFile() {
    const tab = input.activeTab()
    const gui = input.gui()
    if (!gui || !tab || tab.kind !== "file" || !tab.path || tab.content?.type !== "text") return
    input.updateTab(tab.id, { message: "Saving file..." })
    try {
      const result = await writeWorkbenchFile(gui, { path: tab.path, content: tab.text, previousContent: tab.original }, tab.directory || input.directory())
      if (!result.ok) {
        input.updateTab(tab.id, { message: result.message ?? "File was not saved." })
        return
      }
      input.updateTab(tab.id, { original: tab.text, message: result.message ?? "Saved." })
    } catch (cause) {
      input.updateTab(tab.id, { message: cause instanceof Error ? cause.message : "Failed to save file." })
    }
  }

  return { busy, filter, setFilter, matches, searchState, rows, openExplorer, openInActiveTab, closeExplorer, toggleFolder, openExplorerFile, openFile, saveActiveFile }
}

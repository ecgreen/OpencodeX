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
  tabs: Accessor<OpenTab[]>
  activeID: Accessor<string>
  activeTab: Accessor<OpenTab | undefined>
  selectTab: (id: string) => void
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
  let directoryGeneration = 0

  const rows = createMemo(() => flattenWorkbenchFileTree({
    root: filesByPath()[""] ?? [],
    children: filesByPath(),
    expanded: expandedFolders(),
    filter: filter(),
  }))
  const filesOpen = createMemo(() => input.activeTab()?.kind === "files" || input.activeTab()?.kind === "picker")

  createEffect(() => {
    const directory = input.directory()
    directoryGeneration++
    setFilesByPath({})
    setExpandedFolders(new Set<string>())
    setFilter("")
    setMatches([])
    setSearchState(directory ? "idle" : "error")
  })

  createEffect(() => {
    const directory = input.directory()
    if (!input.active() || !filesOpen() || !input.gui() || !directory || filesByPath()[""] !== undefined) return
    void refresh("")
  })

  createEffect(() => {
    const gui = input.gui()
    const query = filter().trim()
    const directory = input.directory()
    const token = ++searchToken
    if (!filesOpen() || !gui || !directory || query.length < 2) {
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

  createEffect(() => {
    const tab = input.activeTab()
    if (!input.active() || tab?.kind !== "file" || !tab.path || tab.content || tab.message) return
    void openFile(tab.id, tab.path, tab.title, tab.directory || input.directory())
  })

  createEffect(() => {
    const tab = input.activeTab()
    if (!input.active() || tab?.kind !== "file" || !tab.path || !input.gui()) return
    const check = () => void checkExternalFile(tab.id)
    const visible = () => {
      if (document.visibilityState === "visible") check()
    }
    const timer = window.setTimeout(check, 250)
    window.addEventListener("focus", check)
    document.addEventListener("visibilitychange", visible)
    onCleanup(() => {
      window.clearTimeout(timer)
      window.removeEventListener("focus", check)
      document.removeEventListener("visibilitychange", visible)
    })
  })

  function openExplorer() {
    const existing = input.tabs().find((tab) => tab.kind === "files" || tab.kind === "picker")
    if (existing) {
      input.selectTab(existing.id)
      queueMicrotask(focusFilter)
      return
    }
    input.addFileTab()
    queueMicrotask(focusFilter)
  }

  function openInActiveTab() {
    openExplorer()
  }

  function closeExplorer() {
    input.closeTab(input.activeID())
  }

  async function refresh(path: string) {
    const gui = input.gui()
    const directory = input.directory()
    if (!gui || !directory) return
    const generation = directoryGeneration
    setBusy(true)
    try {
      const files = await listWorkbenchFiles(gui, path, directory)
      if (generation !== directoryGeneration || directory !== input.directory()) return
      setFilesByPath((current) => ({ ...current, [path]: files }))
    } finally {
      if (generation === directoryGeneration) setBusy(false)
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
    const existing = input.tabs().find((tab) => tab.kind === "file" && workbenchPathKey(tab.path ?? "") === target)
    if (existing) {
      input.selectTab(existing.id)
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
      input.updateTab(tab.id, { original: tab.text, externalText: undefined, externallyChanged: false, message: result.message ?? "Saved." })
    } catch (cause) {
      input.updateTab(tab.id, { message: cause instanceof Error ? cause.message : "Failed to save file." })
    }
  }

  async function checkExternalFile(id: string) {
    const gui = input.gui()
    const started = input.tabs().find((item) => item.id === id)
    if (!gui || started?.kind !== "file" || !started.path || started.content?.type !== "text" || started.externallyChanged) return
    const content = await readWorkbenchFile(gui, started.path, started.directory || input.directory()).catch(() => undefined)
    const tab = input.tabs().find((item) => item.id === id)
    if (content?.type !== "text" || tab?.kind !== "file" || tab.path !== started.path || content.content === tab.original) return
    if (tab.text === tab.original) {
      input.updateTab(id, { content, text: content.content, original: content.content, message: "Reloaded after an external change." })
      return
    }
    input.updateTab(id, {
      externalText: content.content,
      externallyChanged: true,
      message: "This file changed on disk while you have unsaved edits.",
    })
  }

  function reloadExternalFile() {
    const tab = input.activeTab()
    if (tab?.kind !== "file" || tab.externalText === undefined) return
    const content = tab.content?.type === "text" ? { ...tab.content, content: tab.externalText } : tab.content
    input.updateTab(tab.id, {
      content,
      text: tab.externalText,
      original: tab.externalText,
      externalText: undefined,
      externallyChanged: false,
      message: "Reloaded the version on disk.",
    })
  }

  function keepLocalChanges() {
    const tab = input.activeTab()
    if (tab?.kind !== "file" || tab.externalText === undefined) return
    input.updateTab(tab.id, {
      original: tab.externalText,
      externalText: undefined,
      externallyChanged: false,
      message: "Keeping your buffer. Saving will replace the version on disk.",
    })
  }

  function discardActiveChanges() {
    const tab = input.activeTab()
    if (tab?.kind !== "file") return
    input.updateTab(tab.id, { text: tab.original, externalText: undefined, externallyChanged: false, message: "Changes discarded." })
  }

  function focusFilter() {
    document.querySelector<HTMLInputElement>(".session-open-file-explorer .workbench-filter input")?.focus()
  }

  return {
    busy, filter, setFilter, matches, searchState, rows, openExplorer, openInActiveTab, closeExplorer, toggleFolder,
    openExplorerFile, openFile, saveActiveFile, reloadExternalFile, keepLocalChanges, discardActiveChanges,
  }
}

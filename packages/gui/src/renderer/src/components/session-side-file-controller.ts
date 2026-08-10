import type { FileNode } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { createDebouncedSearch } from "../lib/async-search"
import type { GuiClient } from "../lib/client"
import type { WorkbenchFileRead } from "../lib/file-resource-limits"
import { compactPath } from "../lib/format"
import { updateBoundedExplorerCache } from "../lib/resource-limits"
import {
  findFiles,
  listWorkbenchFiles,
  readWorkbenchFile,
  writeWorkbenchFile,
} from "../lib/session-api"
import { flattenWorkbenchFileTree, workbenchPathKey } from "../lib/workbench"
import { createSessionSideFileExternal } from "./session-side-file-external"
import { openTabFileIdentity } from "./session-side-open-state"
import type { OpenFileTarget, OpenTab } from "./session-side-open-types"
import { createSessionSideDefinitionController } from "./session-side-definition-controller"

export function createSessionSideFileController(input: {
  active: Accessor<boolean>
  gui: Accessor<GuiClient | undefined>
  directory: Accessor<string>
  tabs: Accessor<OpenTab[]>
  activeID: Accessor<string>
  activeTab: Accessor<OpenTab | undefined>
  /** True while the explorer pane is on screen, including beside an open file. */
  explorerVisible?: Accessor<boolean>
  selectTab: (id: string) => void
  createTab: (input: Partial<OpenTab>) => string | undefined
  updateTab: (id: string, patch: Partial<OpenTab>) => void
  closeTab: (id: string) => void
  addFileTab: () => void
  hideWebTabs: () => void
  afterSave?: () => void | Promise<void>
  languageStatus?: (supported: boolean, message?: string) => void
}) {
  const MAX_EXPLORER_FOLDERS = 64
  const MAX_EXPLORER_NODES = 2_000
  const [busy, setBusy] = createSignal(false)
  const [filesByPath, setFilesByPath] = createSignal<Record<string, FileNode[]>>({})
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set())
  // Folders the user collapsed while a filter auto-expanded them. Cleared on
  // every filter change so each new query re-reveals its matches fresh.
  const [collapsedFolders, setCollapsedFolders] = createSignal<Set<string>>(new Set())
  const [filter, setFilter] = createSignal("")
  const [matches, setMatches] = createSignal<FileNode[]>([])
  const [searchState, setSearchState] = createSignal<"idle" | "loading" | "error">("idle")
  const folderRequests = new Map<string, AbortController>()
  const fileRequests = new Map<string, AbortController>()
  let folderCacheOrder: string[] = []
  let directoryGeneration = 0
  const definition = createSessionSideDefinitionController({
    gui: input.gui,
    directory: input.directory,
    tabs: input.tabs,
    activeTab: input.activeTab,
    selectTab: input.selectTab,
    createTab: input.createTab,
    updateTab: input.updateTab,
    openFile,
    languageStatus: input.languageStatus,
  })

  const fileSearch = createDebouncedSearch<{ gui: GuiClient; query: string; directory: string }, FileNode[]>({
    key: (value) => `${value.gui.url}\n${value.directory}\n${value.query}`,
    load: (value, signal) => findFiles(value.gui, { query: value.query, directory: value.directory, limit: 40, signal }),
    loading: () => setSearchState("loading"),
    success: (files) => {
      setMatches(files.filter((file) => file.path))
      setSearchState("idle")
    },
    error: () => setSearchState("error"),
  })
  onCleanup(() => {
    fileSearch.dispose()
    abortRequests(folderRequests)
    abortRequests(fileRequests)
  })

  const rows = createMemo(() => flattenWorkbenchFileTree({
    root: filesByPath()[""] ?? [],
    children: filesByPath(),
    expanded: expandedFolders(),
    collapsed: collapsedFolders(),
    filter: filter(),
    matches: matches(),
  }))
  const external = createSessionSideFileExternal({
    gui: input.gui,
    directory: input.directory,
    tabs: input.tabs,
    activeTab: input.activeTab,
    updateTab: input.updateTab,
  })
  // Whether the explorer is on screen, which is not the same as it being the
  // active tab: it also sits beside an open file. The panel owns that rule.
  const filesOpen = createMemo(
    () => input.explorerVisible?.() ?? (input.activeTab()?.kind === "files" || input.activeTab()?.kind === "picker"),
  )

  createEffect(() => {
    const directory = input.directory()
    directoryGeneration++
    fileSearch.clear()
    abortRequests(folderRequests)
    abortRequests(fileRequests)
    folderCacheOrder = []
    setFilesByPath({})
    setBusy(false)
    setExpandedFolders(new Set<string>())
    setCollapsedFolders(new Set<string>())
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
    if (!filesOpen() || !gui || !directory || query.length < 2) {
      fileSearch.clear()
      setMatches([])
      setSearchState("idle")
      return
    }
    fileSearch.search({ gui, query, directory })
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

  // Opens a file tab that has no content yet - a tab restored from storage, or
  // one an action created without reading. `loading` is what says a read is
  // already in flight; without it this re-entered openFile on its own tab
  // write and span forever.
  createEffect(() => {
    const tab = input.activeTab()
    if (!input.active() || tab?.kind !== "file" || !tab.path || tab.content || tab.loading || tab.message) return
    void openFile(tab.id, { path: tab.path, title: tab.title, directory: tab.directory || input.directory(), root: tab.root, readOnly: tab.readOnly })
  })

  createEffect(() => {
    const tab = input.activeTab()
    if (!input.active() || tab?.kind !== "file" || !tab.path || !input.gui() || tab.readOnly) return
    const controller = new AbortController()
    const check = () => void external.check(tab.id, controller.signal)
    const visible = () => {
      if (document.visibilityState === "visible") check()
    }
    const timer = window.setTimeout(check, 250)
    window.addEventListener("focus", check)
    document.addEventListener("visibilitychange", visible)
    onCleanup(() => {
      window.clearTimeout(timer)
      controller.abort()
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
    folderRequests.get(path)?.abort()
    const controller = new AbortController()
    folderRequests.set(path, controller)
    setBusy(true)
    try {
      const files = await listWorkbenchFiles(gui, path, directory, controller.signal)
      if (controller.signal.aborted || generation !== directoryGeneration || directory !== input.directory()) return
      setFilesByPath((current) => {
        const next = updateBoundedExplorerCache({
          cache: current,
          order: folderCacheOrder,
          path,
          nodes: files,
          maxFolders: MAX_EXPLORER_FOLDERS,
          maxNodes: MAX_EXPLORER_NODES,
        })
        folderCacheOrder = next.order
        if (next.evicted.length > 0) {
          const retained = new Set(Object.keys(next.cache))
          setExpandedFolders((expanded) => new Set([...expanded].filter((folder) => retained.has(folder))))
        }
        return next.cache
      })
    } catch {
      return
    } finally {
      if (folderRequests.get(path) === controller) folderRequests.delete(path)
      if (generation === directoryGeneration) setBusy(folderRequests.size > 0)
    }
  }

  function updateFilter(value: string) {
    setCollapsedFolders(new Set<string>())
    setFilter(value)
  }

  // `expandedNow` is the rendered state: while filtering, folders auto-expand
  // without being in expandedFolders, so membership alone cannot tell whether
  // this click should collapse or expand.
  async function toggleFolder(file: FileNode, expandedNow?: boolean) {
    const isExpanded = expandedNow ?? (expandedFolders().has(file.path) && !collapsedFolders().has(file.path))
    if (isExpanded) {
      setExpandedFolders((current) => new Set([...current].filter((path) => path !== file.path)))
      setCollapsedFolders((current) => new Set([...current, file.path]))
      return
    }
    setCollapsedFolders((current) => new Set([...current].filter((path) => path !== file.path)))
    setExpandedFolders((current) => new Set([...current, file.path]))
    if (filesByPath()[file.path] === undefined) await refresh(file.path)
  }

  async function openExplorerFile(path: string) {
    const target = workbenchPathKey(path)
    if (!target) return
    updateFilter("")
    const identity = openTabFileIdentity({ path: target, directory: input.directory() })
    const existing = input.tabs().find((tab) => tab.kind === "file" && openTabFileIdentity(tab, input.directory()) === identity)
    if (existing) {
      input.selectTab(existing.id)
      return
    }
    const id = input.createTab({ input: target, title: compactPath(target), directory: input.directory() })
    if (!id) return
    await openFile(id, { path: target, directory: input.directory() })
  }

  async function openFile(id: string, target: OpenFileTarget) {
    const directory = target.directory || input.directory()
    const path = target.path
    const gui = input.gui()
    if (!gui) {
      input.updateTab(id, { kind: "file", path, directory, root: target.root, readOnly: target.readOnly, input: path, title: target.title || compactPath(path), message: "GUI client is not ready." })
      return
    }
    fileRequests.get(id)?.abort()
    const controller = new AbortController()
    const abort = () => controller.abort()
    target.signal?.addEventListener("abort", abort, { once: true })
    if (target.signal?.aborted) controller.abort()
    fileRequests.set(id, controller)
    input.hideWebTabs()
    // `loading` drives the skeleton. The previous file's content stays on the
    // tab until the new one lands, so nothing here clears it - the pane reads
    // the flag, not the absence of content, and only the file area swaps.
    input.updateTab(id, { kind: "file", path, directory, root: target.root, readOnly: target.readOnly, input: path, title: target.title || compactPath(path), loading: true, message: "" })
    try {
      const file = await readWorkbenchFile(gui, path, directory, controller.signal, target.root)
      if (!file) throw new Error(`Could not read ${path}.`)
      const current = input.tabs().find((tab) => tab.id === id)
      if (controller.signal.aborted || !current || openTabFileIdentity(current, input.directory()) !== openTabFileIdentity(target, directory)) return
      applyFile(id, file, { kind: "file", path, directory, root: target.root, readOnly: target.readOnly, input: path, title: target.title || compactPath(path) })
    } catch (cause) {
      if (isAbort(cause)) return
      input.updateTab(id, { loading: false, message: cause instanceof Error ? cause.message : "Failed to open file." })
    } finally {
      target.signal?.removeEventListener("abort", abort)
      // Every exit clears the skeleton, including the identity bail above that
      // returns without applying anything - otherwise the pane waits forever on
      // a read that already decided it was stale. Guarded so a newer read that
      // has taken over the tab keeps its own skeleton up.
      if (fileRequests.get(id) === controller) {
        fileRequests.delete(id)
        input.updateTab(id, { loading: false })
      }
    }
  }

  async function saveActiveFile() {
    const tab = input.activeTab()
    const gui = input.gui()
    if (!gui || !tab || tab.kind !== "file" || !tab.path || tab.content?.type !== "text" || tab.fileMode !== "editable" || tab.readOnly) return false
    input.updateTab(tab.id, { message: "Saving file..." })
    try {
      const result = await writeWorkbenchFile(gui, { path: tab.path, content: tab.text, previousContent: tab.original }, tab.directory || input.directory())
      if (!result.ok) {
        input.updateTab(tab.id, { message: result.message ?? "File was not saved." })
        return false
      }
      input.updateTab(tab.id, { original: tab.text, externalText: undefined, externallyChanged: false, message: result.message ?? "Saved." })
      await input.afterSave?.()
      return true
    } catch (cause) {
      input.updateTab(tab.id, { message: cause instanceof Error ? cause.message : "Failed to save file." })
      return false
    }
  }

  function discardActiveChanges() {
    const tab = input.activeTab()
    if (tab?.kind !== "file" || tab.readOnly) return
    input.updateTab(tab.id, { text: tab.original, externalText: undefined, externallyChanged: false, message: "Changes discarded." })
  }

  function cancelTabs(tabs: readonly OpenTab[]) {
    tabs.forEach((tab) => {
      fileRequests.get(tab.id)?.abort()
      fileRequests.delete(tab.id)
    })
  }

  function applyFile(id: string, file: WorkbenchFileRead | undefined, patch: Partial<OpenTab>) {
    const content = file?.content
    const text = content?.type === "text" ? content.content : ""
    input.updateTab(id, {
      ...patch,
      content,
      fileMode: file?.mode,
      fileBytes: file?.bytes,
      text,
      original: text,
      loading: false,
      message: file?.mode === "metadata"
        ? `This file is ${formatBytes(file.bytes)}. Preview content is omitted above 2 MiB.`
        : file?.mode === "preview"
          ? `Read-only preview (${formatBytes(file.bytes)}). Editing is limited to UTF-8 files up to 750 KiB.`
          : "",
    })
  }

  function focusFilter() {
    document.querySelector<HTMLInputElement>(".session-open-file-explorer .workbench-filter input")?.focus()
  }

  return {
    busy, filter, setFilter: updateFilter, matches, searchState, rows, openExplorer, openInActiveTab, closeExplorer, toggleFolder,
    openExplorerFile, openFile, saveActiveFile, openDefinition: definition.open, loadHover: definition.hover, loadCompletion: definition.completion, navigation: definition.navigation,
    reloadExternalFile: external.reload, keepLocalChanges: external.keepLocal,
    discardActiveChanges, cancelTabs,
  }
}

function abortRequests(requests: Map<string, AbortController>) {
  requests.forEach((controller) => controller.abort())
  requests.clear()
}

function isAbort(cause: unknown) {
  return cause instanceof DOMException && cause.name === "AbortError"
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`
}

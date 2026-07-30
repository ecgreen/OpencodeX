import { createSignal, type Accessor, type Setter } from "solid-js"
import { newBrowserID } from "../lib/browser-id"
import { reserveOpenTabSlot } from "../lib/resource-limits"
import { workbenchNormalizeBrowserURL } from "../lib/workbench"
import type { createSessionSideBrowserController } from "./session-side-browser-controller"
import type { createSessionSideFileController } from "./session-side-file-controller"
import { openTabDefaults, openTabDirty, openTabFileIdentity } from "./session-side-open-state"
import { OPEN_PANEL_TAB_LIMIT, type OpenTab } from "./session-side-open-types"
import { filePathFromInput, inputLabel, isBrowserInput, webInputURL } from "./session-side-path"
import type { createSessionSideTabBarController } from "./session-side-tab-bar-controller"
import type { createSessionSideTerminalController } from "./session-side-terminal"

/**
 * Every mutation of the open-panel tab list. The browser, tab-bar, terminal and
 * file controllers are taken as accessors rather than values because the panel
 * builds them *after* these actions - each controller receives action callbacks
 * at construction, so the dependency is genuinely mutual and only resolves at
 * call time.
 */
export function createSessionSideOpenTabActions(input: {
  tabs: Accessor<OpenTab[]>
  setTabs: Setter<OpenTab[]>
  activeID: Accessor<string>
  setActiveID: Setter<string>
  activeTab: Accessor<OpenTab | undefined>
  directory: Accessor<string>
  directoryOnly: Accessor<boolean>
  setExplorerOpen: Setter<boolean>
  browser: Accessor<ReturnType<typeof createSessionSideBrowserController>>
  tabBar: Accessor<ReturnType<typeof createSessionSideTabBarController>>
  terminals: Accessor<ReturnType<typeof createSessionSideTerminalController>>
  files: Accessor<ReturnType<typeof createSessionSideFileController>>
}) {
  const activeDirectory = () => input.directory()
  // Closing a tab with unsaved edits used to leave a message telling the reader
  // to save or discard, without saying which file or offering either action.
  // The id parks here instead and the panel asks.
  const [dirtyClose, setDirtyClose] = createSignal<string>()

  function updateOpenTab(id: string, patch: Partial<OpenTab>) {
    input.setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)))
  }
  function setActiveInput(value: string) {
    updateOpenTab(input.activeID(), { input: value })
  }
  function disposeTabs(items: readonly OpenTab[]) {
    input.browser().closeAll(items)
    input.terminals().closeAll(items)
    input.files().cancelTabs(items)
  }
  function createTab(tab: Partial<OpenTab>) {
    const slot = reserveOpenTabSlot({ tabs: input.tabs(), active: input.activeTab(), clean: (item) => !openTabDirty(item), limit: OPEN_PANEL_TAB_LIMIT })
    if (!slot.available) {
      const active = input.activeTab()
      if (active) updateOpenTab(active.id, { message: "Close or save an inactive tab before opening another." })
      return undefined
    }
    const id = newBrowserID()
    if (input.activeTab()?.kind === "web") input.browser().hideAll()
    disposeTabs(slot.evicted)
    input.setTabs([...slot.tabs, { ...openTabDefaults(id), ...tab }])
    input.setActiveID(id)
    return id
  }
  function selectSingletonTab(kind: "context" | "files" | "git", title: string) {
    const existing = input.tabs().find((tab) => tab.kind === kind)
    if (existing) {
      if (input.activeTab()?.kind === "web" && existing.id !== input.activeID()) input.browser().hideAll()
      input.setActiveID(existing.id)
      input.tabBar().closeNewMenu()
      return existing.id
    }
    const id = createTab({ kind, title })
    if (!id) return undefined
    input.tabBar().closeNewMenu()
    return id
  }
  function addContextTab() {
    if (input.directoryOnly()) return
    selectSingletonTab("context", "Context")
  }
  function addGitTab() {
    selectSingletonTab("git", "Git")
  }
  // Deliberately not a singleton: "+ Files" always opens a fresh explorer tab.
  function addFileTab() {
    createTab({ kind: "files", title: "Files" })
    input.tabBar().closeNewMenu()
  }
  function addWebTab() {
    createTab({ kind: "web", input: "https://", title: "New webpage" })
    input.tabBar().closeNewMenu()
    queueMicrotask(() => document.querySelector<HTMLInputElement>(".session-open-location input")?.focus())
  }
  function closeTab(id: string) {
    const closing = input.tabs().find((tab) => tab.id === id)
    if (closing && openTabDirty(closing)) {
      // Make it visible before asking, so the reader sees the edits the dialog
      // is about rather than being told about a file they cannot find.
      input.setActiveID(id)
      setDirtyClose(id)
      return
    }
    discardTab(id)
  }

  /** Closes without the unsaved-changes check. Only the dialog resolution reaches this directly. */
  function discardTab(id: string) {
    const current = input.tabs()
    const index = current.findIndex((tab) => tab.id === id)
    const next = current.filter((tab) => tab.id !== id)
    const closing = current.find((tab) => tab.id === id)
    if (closing?.kind === "web") input.browser().close(closing)
    if (closing?.kind === "terminal") input.terminals().close(closing)
    if (closing) input.files().cancelTabs([closing])
    input.setTabs(next)
    if (input.activeID() === id) input.setActiveID(next[Math.min(index, next.length - 1)]?.id ?? next[0]?.id ?? "")
  }
  /**
   * Answers the unsaved-changes prompt. A failed save keeps the tab open with
   * the reason on it - closing anyway would throw away the edits the reader
   * just asked to keep.
   */
  async function resolveDirtyClose(action: "save" | "discard" | "cancel") {
    const id = dirtyClose()
    setDirtyClose(undefined)
    if (!id || action === "cancel") return
    if (action === "save" && !(await input.files().saveActiveFile())) return
    if (action === "discard") input.files().discardActiveChanges()
    discardTab(id)
  }

  async function openActiveInput() {
    const tab = input.activeTab()
    if (!tab) return
    await openInput(tab.id, tab.kind === "web" ? webInputURL(tab.input) : tab.input)
  }
  async function openInputInNewTab(value: string, title?: string) {
    const trimmed = value.trim()
    const path = trimmed && !trimmed.startsWith("opencodex://") && !isBrowserInput(trimmed) ? filePathFromInput(trimmed, activeDirectory()) : ""
    const identity = path ? openTabFileIdentity({ path, directory: activeDirectory() }) : ""
    const existing = identity ? input.tabs().find((tab) => tab.kind === "file" && openTabFileIdentity(tab, activeDirectory()) === identity) : undefined
    if (existing) input.tabBar().select(existing.id)
    if (existing && !existing.content) await input.files().openFile(existing.id, { path, title, directory: activeDirectory() })
    if (existing) return
    const id = createTab({ input: value, title: title || inputLabel(value, activeDirectory()) })
    if (!id) return
    await openInput(id, value, title)
  }
  async function openInput(id: string, value: string, title?: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    if (trimmed === "opencodex://files") {
      closeTab(id)
      addFileTab()
      return
    }
    if (trimmed === "opencodex://terminal") {
      closeTab(id)
      input.terminals().create()
      return
    }
    if (isBrowserInput(trimmed)) {
      const url = workbenchNormalizeBrowserURL(trimmed)
      updateOpenTab(id, {
        input: url,
        url,
        kind: "web",
        title: title || inputLabel(url),
        directory: undefined,
        content: undefined,
        text: "",
        original: "",
        message: "",
      })
      queueMicrotask(() => void input.browser().navigate(id, url))
      return
    }
    await input.files().openFile(id, { path: filePathFromInput(trimmed, activeDirectory()), title, directory: activeDirectory() })
  }
  function openFromExplorer(path: string) {
    input.setExplorerOpen(true)
    const tab = input.activeTab()
    // The explorer navigates the tab it lives in, like the Git view: a Files
    // tab converts into the picked file in place, and a file tab swaps its
    // file. Two guards: a dirty buffer is never replaced (a new tab opens
    // instead), and a file already open elsewhere is focused, not duplicated.
    const inPlace = tab && (tab.kind === "files" || tab.kind === "picker" || (tab.kind === "file" && !openTabDirty(tab)))
    if (inPlace) {
      const identity = openTabFileIdentity({ path, directory: activeDirectory() })
      const existing = input.tabs().find((item) => item.kind === "file" && openTabFileIdentity(item, activeDirectory()) === identity)
      if (existing && existing.id !== tab.id) {
        input.tabBar().select(existing.id)
        return
      }
      void input.files().openFile(tab.id, { path, directory: activeDirectory() })
      return
    }
    void input.files().openExplorerFile(path)
  }

  return {
    activeDirectory,
    addContextTab,
    addFileTab,
    addGitTab,
    addWebTab,
    closeTab,
    createTab,
    dirtyClose,
    resolveDirtyClose,
    disposeTabs,
    openActiveInput,
    openFromExplorer,
    openInput,
    openInputInNewTab,
    selectSingletonTab,
    setActiveInput,
    updateOpenTab,
  }
}

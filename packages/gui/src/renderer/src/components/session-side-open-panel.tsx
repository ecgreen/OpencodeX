import type { LspStatus } from "@opencode-ai/sdk/v2/client"
import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import type { GuiClient } from "../lib/client"
import type { DiffFile, WorkbenchGitBranches, WorkbenchGitStatus } from "../lib/store"
import { isWorkbenchImageContent, workbenchBufferDirty, workbenchNormalizeBrowserURL } from "../lib/workbench"
import { newBrowserID } from "../lib/browser-id"
import { LazyCodeEditor } from "./lazy-code-editor"
import { Select } from "./ui"
import { SessionContextPanel, sessionInspectorModel } from "./session-inspector"
import { SessionSideDiffPanel } from "./session-side-git-view"
import { createSessionSideBrowserController } from "./session-side-browser-controller"
import { createSessionSideAgentController } from "./session-side-agent-controller"
import { SessionSideBrowserHost } from "./session-side-browser-host"
import { SessionSideEmptyState } from "./session-side-empty"
import { createSessionSideFileController } from "./session-side-file-controller"
import { SessionSideFileExplorer } from "./session-side-file-explorer"
import { createSessionSideTabBarController } from "./session-side-tab-bar-controller"
import { openTabDefaults, openTabDirty, restoreOpenPanelState, saveOpenPanelState } from "./session-side-open-state"
import { OPEN_PANEL_EDIT_LIMIT, type OpenTab } from "./session-side-open-types"
import { filePathFromInput, inputLabel, isBrowserInput, webInputURL } from "./session-side-path"
import { SessionOpenTerminal, createSessionSideTerminalController } from "./session-side-terminal"
import type { SessionSidePanelContextOption, SessionSidePanelRequest } from "./session-side-panel-types"
import { createWorkbenchDiagnosticsController } from "./workbench-diagnostics-controller"
import { SessionSideOpenChrome } from "./session-side-open-chrome"
export function SessionSideOpenPanel(props: {
  sessionID: string
  active: boolean
  gui?: GuiClient
  directory?: string
  request?: SessionSidePanelRequest
  contextModel: ReturnType<typeof sessionInspectorModel>
  contextOptions?: SessionSidePanelContextOption[]
  selectedContextID?: string
  selectContext?: (id: string) => void
  contextCollapsed: Record<string, boolean>
  toggleContext: (section: string) => void
  lsp: LspStatus[]
  lspEnabled?: boolean
  diffs: DiffFile[]
  gitFiles: DiffFile[]
  gitMessage: string
  gitLoading: boolean
  gitStatus?: WorkbenchGitStatus
  gitBranches?: WorkbenchGitBranches
  refreshGit: () => void
  openCommitModal: (path?: string) => void
  gitActiveChange?: (state: { sessionID: string; active: boolean }) => void
}) {
  const restoredState = restoreOpenPanelState(props.sessionID)
  const [tabs, setTabs] = createSignal<OpenTab[]>(restoredState.tabs)
  const [activeID, setActiveID] = createSignal(restoredState.activeID)
  const activeTab = createMemo(() => tabs().find((item) => item.id === activeID()) ?? tabs()[0])
  const [menuOpen, setMenuOpen] = createSignal(false)
  let handledRequestToken = 0
  let loadedSessionID = props.sessionID
  const browser = createSessionSideBrowserController({
    active: () => props.active,
    tabs,
    activeID,
    activeTab,
    menuOpen,
    updateTab: updateOpenTab,
  })
  const tabBar = createSessionSideTabBarController({
    tabs,
    setTabs,
    activeID,
    activeTab,
    setActiveID,
    closeTab,
    hideWebTabs: browser.hideAll,
    parkBrowser: browser.parkActive,
    setMenuOpen,
  })
  const terminals = createSessionSideTerminalController({
    active: () => props.active,
    tabs,
    activeTab,
    directory: activeDirectory,
    createTab,
    updateTab: updateOpenTab,
    closeMenu: tabBar.closeNewMenu,
    openURL: (url) => void openInputInNewTab(url),
  })
  const files = createSessionSideFileController({
    active: () => props.active,
    gui: () => props.gui,
    directory: activeDirectory,
    tabs,
    activeID,
    activeTab,
    selectTab: tabBar.select,
    createTab,
    updateTab: updateOpenTab,
    closeTab,
    addFileTab,
    hideWebTabs: browser.hideAll,
  })
  const activeFilePath = createMemo(() => activeTab()?.kind === "file" ? activeTab()?.path ?? "" : "")
  const diagnostics = createWorkbenchDiagnosticsController({
    gui: () => props.gui,
    directory: activeDirectory,
    path: activeFilePath,
  })
  const agent = createSessionSideAgentController({
    sessionID: () => props.sessionID,
    directory: activeDirectory,
    tabs,
    activeTab,
    selectTab: tabBar.select,
    createTab,
    updateTab: updateOpenTab,
    openFile: files.openFile,
    navigate: browser.navigate,
    capture: browser.capture,
    snapshot: browser.snapshot,
  })
  createEffect(() => {
    const sessionID = props.sessionID
    if (sessionID === loadedSessionID) return
    const previousTabs = untrack(tabs)
    const previousActiveID = untrack(activeID)
    saveOpenPanelState(loadedSessionID, previousTabs, previousActiveID)
    browser.hideAll()
    const next = loadedSessionID.startsWith("pending:")
      ? { tabs: previousTabs, activeID: previousActiveID }
      : restoreOpenPanelState(sessionID)
    loadedSessionID = sessionID
    setTabs(next.tabs)
    setActiveID(next.activeID)
    tabBar.clearDrag()
  })
  createEffect(() => props.gitActiveChange?.({ sessionID: props.sessionID, active: props.active && props.sessionID === loadedSessionID && activeTab()?.kind === "git" }))
  createEffect(() => {
    const path = activeFilePath()
    if (!props.active || !path) return
    void diagnostics.refresh()
  })
  createEffect(() => {
    if (!props.active) return
    const keydown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === "p" && !event.shiftKey && event.target instanceof Element && event.target.closest(".session-side-panel")) {
        event.preventDefault()
        event.stopPropagation()
        files.openExplorer()
        return
      }
      if (key !== "pageup" && key !== "pagedown") return
      const items = tabs()
      if (items.length < 2) return
      event.preventDefault()
      event.stopPropagation()
      const index = Math.max(0, items.findIndex((tab) => tab.id === activeID()))
      tabBar.select(items[(index + (key === "pageup" ? -1 : 1) + items.length) % items.length].id)
    }
    document.addEventListener("keydown", keydown, true)
    onCleanup(() => document.removeEventListener("keydown", keydown, true))
  })
  createEffect(() => {
    saveOpenPanelState(loadedSessionID, tabs(), activeID())
  })
  createEffect(() => {
    const request = props.request
    if (!request?.token) return
    if (handledRequestToken === request.token) return
    handledRequestToken = request.token
    untrack(() => {
      if (request.tab === "context") {
        addContextTab()
        return
      }
      if (request.tab === "git") {
        addGitTab()
        return
      }
      if (request.value) void openInputInNewTab(request.value, request.title)
    })
  })
  onCleanup(() => {
    saveOpenPanelState(loadedSessionID, tabs(), activeID())
  })
  function setActiveInput(value: string) {
    updateOpenTab(activeID(), { input: value })
  }

  function createTab(input: Partial<OpenTab>) {
    const id = newBrowserID()
    if (activeTab()?.kind === "web") browser.hideAll()
    setTabs((current) => [...current, { ...openTabDefaults(id), ...input }])
    setActiveID(id)
    return id
  }

  function selectSingletonTab(kind: "context" | "files" | "git", title: string) {
    const existing = tabs().find((tab) => tab.kind === kind)
    if (existing) {
      if (activeTab()?.kind === "web" && existing.id !== activeID()) browser.hideAll()
      setActiveID(existing.id)
      tabBar.closeNewMenu()
      return existing.id
    }
    const id = createTab({ kind, title })
    tabBar.closeNewMenu()
    return id
  }
  function addContextTab() {
    selectSingletonTab("context", "Context")
  }
  function addGitTab() {
    selectSingletonTab("git", "Git")
  }
  function addFileTab() {
    selectSingletonTab("files", "Files")
  }
  function addWebTab() {
    createTab({ kind: "web", input: "https://", title: "New webpage" })
    tabBar.closeNewMenu()
    queueMicrotask(() => document.querySelector<HTMLInputElement>(".session-open-location input")?.focus())
  }

  function closeTab(id: string) {
    const current = tabs()
    const index = current.findIndex((tab) => tab.id === id)
    const next = current.filter((tab) => tab.id !== id)
    const closing = current.find((tab) => tab.id === id)
    if (closing && openTabDirty(closing)) {
      setActiveID(id)
      updateOpenTab(id, { message: "Save or discard your changes before closing this tab." })
      return
    }
    if (closing?.kind === "web") browser.close(closing)
    if (closing?.kind === "terminal") terminals.close(closing)
    setTabs(next)
    if (activeID() === id) setActiveID(next[Math.min(index, next.length - 1)]?.id ?? next[0]?.id ?? "")
  }

  async function openActiveInput() {
    const tab = activeTab()
    if (!tab) return
    await openInput(tab.id, tab.kind === "web" ? webInputURL(tab.input) : tab.input)
  }

  async function openInputInNewTab(value: string, title?: string) {
    const id = createTab({ input: value, title: title || inputLabel(value, activeDirectory()) })
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
      terminals.create()
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
      queueMicrotask(() => void browser.navigate(id, url))
      return
    }
    await files.openFile(id, filePathFromInput(trimmed, activeDirectory()), title, activeDirectory())
  }

  function updateOpenTab(id: string, patch: Partial<OpenTab>) {
    setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, ...patch } : tab))
  }

  function activeDirectory() {
    return props.directory || props.gui?.directory || ""
  }

  const dirty = createMemo(() => {
    const tab = activeTab()
    return tab?.kind === "file" ? workbenchBufferDirty({ content: tab.text, original: tab.original }) : false
  })

  return (
    <section class="session-side-open">
      <SessionSideOpenChrome sessionID={props.sessionID} tabs={tabs()} activeTab={activeTab()} controller={tabBar} changedFiles={props.diffs.flatMap((file) => file.file ? [file.file] : [])} addGit={addGitTab} addFile={addFileTab} addTerminal={terminals.create} addContext={addContextTab} addWeb={addWebTab} setWebInput={setActiveInput} openWebInput={() => void openActiveInput()} browserAction={(action) => void browser.action(action)} browserDevtools={() => void browser.devtools()} browserExternal={() => void browser.openExternal()} browserScreenshot={browser.screenshot} updateTab={updateOpenTab} openFiles={files.openInActiveTab} discardFile={files.discardActiveChanges} saveFile={() => void files.saveActiveFile()} dirty={dirty()} agentBrowsing={agent.active()} reloadExternal={files.reloadExternalFile} keepLocal={files.keepLocalChanges} diagnostics={{ loading: diagnostics.loading(), message: diagnostics.message(), command: diagnostics.command(), active: diagnostics.active(), total: diagnostics.diagnostics().length, refresh: () => void diagnostics.refresh(), open: (path) => void files.openExplorerFile(path) }} />
      <Switch>
        <Match when={activeTab()?.kind === "context"}>
          <div class="session-side-context">
            <Show when={(props.contextOptions?.length ?? 0) > 1}>
              <Select<NonNullable<typeof props.contextOptions>[number]>
                class="session-side-context-select"
                label="Session"
                options={props.contextOptions ?? []}
                current={(props.contextOptions ?? []).find((option) => option.id === (props.selectedContextID ?? props.sessionID))}
                optionValue={(option) => option.id}
                optionLabel={(option) => option.label}
                onSelect={(option) => option && props.selectContext?.(option.id)}
              />
            </Show>
            <SessionContextPanel
              model={props.contextModel}
              lsp={props.lsp}
              lspEnabled={props.lspEnabled}
              diffs={props.diffs}
              collapsed={props.contextCollapsed}
              toggle={props.toggleContext}
            />
          </div>
        </Match>
        <Match when={activeTab()?.kind === "git"}>
          <SessionSideDiffPanel
            title="Working Tree"
            empty={props.gitMessage}
            loading={props.gitLoading}
            files={props.gitFiles}
            status={props.gitStatus}
            branches={props.gitBranches}
            gui={props.gui}
            directory={activeDirectory()}
            request={props.request?.tab === "git" ? props.request : undefined}
            openCommitModal={props.openCommitModal}
            openFile={(path) => void openInputInNewTab(path)}
            refresh={props.refreshGit}
          />
        </Match>
        <Match when={activeTab()?.kind === "files" || activeTab()?.kind === "picker"}>
          <SessionSideFileExplorer
            directory={activeDirectory()}
            filter={files.filter()}
            setFilter={files.setFilter}
            searchState={files.searchState()}
            matches={files.matches()}
            rows={files.rows()}
            loading={files.busy()}
            openPath={activeTab()?.path ?? ""}
            toggleFolder={(file) => void files.toggleFolder(file)}
            openFile={(path) => void files.openExplorerFile(path)}
            close={files.closeExplorer}
          />
        </Match>
        <Match when={isWorkbenchImageContent(activeTab()?.content)}>
          <div class="workbench-image-preview">
            <img src={`data:${activeTab()?.content?.mimeType ?? "image/png"};base64,${activeTab()?.content?.content ?? ""}`} alt={activeTab()?.path} />
          </div>
        </Match>
        <Match when={activeTab()?.kind === "file" && activeTab()?.content?.type === "binary"}>
          <div class="session-side-empty">Binary preview is read-only.</div>
        </Match>
        <Match when={activeTab()?.kind === "file" && activeTab()?.content?.type === "text" && (activeTab()?.text.length ?? 0) > OPEN_PANEL_EDIT_LIMIT}>
          <pre class="session-open-large-file">{activeTab()?.text}</pre>
        </Match>
        <Match when={activeTab()?.kind === "file" && activeTab()?.content?.type === "text"}>
          <LazyCodeEditor
            path={activeTab()?.path ?? ""}
             value={activeTab()?.text ?? ""}
             original={activeTab()?.original ?? ""}
             diagnostics={diagnostics.active()}
            onChange={(value) => activeTab() && updateOpenTab(activeTab()!.id, { text: value })}
            onSave={() => void files.saveActiveFile()}
          />
        </Match>
        <Match when={activeTab()?.kind === "web"}>
          <SessionSideBrowserHost preview={browser.activePreview()} parked={browser.parkedID() === activeTab()?.id} available={Boolean(window.opencodex?.browser)} lifecycle={browser.lifecycle()} error={browser.error()} url={activeTab()?.url ?? ""} setHost={browser.setHost} />
        </Match>
        <Match when={activeTab()?.kind === "terminal"}>
          <SessionOpenTerminal tab={activeTab()!} write={terminals.write} rename={terminals.rename} />
        </Match>
        <Match when={true}>
          <SessionSideEmptyState
            directory={props.directory}
            diffs={props.diffs}
            openContext={addContextTab}
            openGit={addGitTab}
            openFiles={files.openExplorer}
            openChangedFile={(path) => void openInputInNewTab(path)}
            openTerminal={terminals.create}
            addWebTab={addWebTab}
          />
        </Match>
      </Switch>
    </section>
  )
}

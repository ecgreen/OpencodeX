import type { LspStatus } from "@opencode-ai/sdk/v2/client"
import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import type { GuiClient } from "../lib/client"
import type { DiffFile } from "../lib/session-api"
import { isWorkbenchImageContent } from "../lib/workbench"
import { sessionReplacementCleanupTabs } from "../lib/resource-limits"
import { Select } from "./ui"
import { SessionContextPanel, sessionInspectorModel } from "./session-inspector"
import { SessionSideDiffPanel } from "./session-side-git-view"
import type { SessionSideGitController } from "./session-side-git-controller"
import { createSessionSideBrowserController } from "./session-side-browser-controller"
import { createSessionSideAgentController } from "./session-side-agent-controller"
import { SessionSideBrowserHost } from "./session-side-browser-host"
import { SessionSideEmptyState } from "./session-side-empty"
import { createSessionSideFileController } from "./session-side-file-controller"
import { SessionSideFileExplorer } from "./session-side-file-explorer"
import { createSessionSideTabBarController } from "./session-side-tab-bar-controller"
import { openTabDirty, restoreOpenPanelState, saveOpenPanelState } from "./session-side-open-state"
import { createSessionSideOpenTabActions } from "./session-side-open-tab-actions"
import { type OpenTab } from "./session-side-open-types"
import { SessionOpenTerminal, createSessionSideTerminalController } from "./session-side-terminal"
import type { SessionSidePanelContextOption, SessionSidePanelRequest } from "./session-side-panel-types"
import { createWorkbenchDiagnosticsController } from "./workbench-diagnostics-controller"
import { SessionSideOpenChrome } from "./session-side-open-chrome"
import { SessionSideFileEditor } from "./session-side-file-editor"
import { SessionSideFileSkeleton } from "./session-side-file-skeleton"

const EXPLORER_WIDTH_KEY = "opencodex.file-explorer-width"

function clampExplorerWidth(value: number) {
  return Math.max(180, Math.min(480, Math.round(value)))
}

function storedExplorerWidth() {
  try {
    const value = Number(localStorage.getItem(EXPLORER_WIDTH_KEY))
    return Number.isFinite(value) && value > 0 ? clampExplorerWidth(value) : 240
  } catch {
    return 240
  }
}
export function SessionSideOpenPanel(props: {
  sessionID: string; active: boolean
  gui?: GuiClient; directory?: string
  request?: SessionSidePanelRequest
  contextModel?: ReturnType<typeof sessionInspectorModel>
  directoryOnly?: boolean
  contextOptions?: SessionSidePanelContextOption[]
  selectedContextID?: string
  selectContext?: (id: string) => void
  contextCollapsed: Record<string, boolean>
  toggleContext: (section: string) => void
  lsp: LspStatus[]; lspEnabled?: boolean
  diffs: DiffFile[]
  git: SessionSideGitController
  openCommitModal: (path?: string) => void
  gitActiveChange?: (state: { sessionID: string; active: boolean }) => void
}) {
  const restoredState = restoreOpenPanelState(props.sessionID)
  const [tabs, setTabs] = createSignal<OpenTab[]>(restoredState.tabs)
  const [activeID, setActiveID] = createSignal(restoredState.activeID)
  const activeTab = createMemo(() => tabs().find((item) => item.id === activeID()) ?? tabs()[0])
  const [menuOpen, setMenuOpen] = createSignal(false)
  // File tabs render Git-style: a collapsible explorer beside the file. Opening
  // a file from the explorer keeps the pane open so browsing feels continuous.
  const [explorerOpen, setExplorerOpen] = createSignal(false)
  const [explorerWidth, setExplorerWidth] = createSignal(storedExplorerWidth())
  let handledRequestToken = 0
  let loadedSessionID = props.sessionID
  // The tab actions and these controllers depend on each other: controllers take
  // action callbacks at construction, actions drive the controllers at call time.
  // Actions are built first and reach the controllers through accessors.
  let browser!: ReturnType<typeof createSessionSideBrowserController>
  let tabBar!: ReturnType<typeof createSessionSideTabBarController>
  let terminals!: ReturnType<typeof createSessionSideTerminalController>
  let files!: ReturnType<typeof createSessionSideFileController>
  const actions = createSessionSideOpenTabActions({
    tabs,
    setTabs,
    activeID,
    setActiveID,
    activeTab,
    directory: () => props.directory || props.gui?.directory || "",
    directoryOnly: () => props.directoryOnly === true,
    setExplorerOpen,
    browser: () => browser,
    tabBar: () => tabBar,
    terminals: () => terminals,
    files: () => files,
  })
  const { activeDirectory, addContextTab, addFileTab, addGitTab, addWebTab, closeTab, createTab, disposeTabs, openActiveInput, openFromExplorer, openInputInNewTab, setActiveInput, updateOpenTab } = actions
  browser = createSessionSideBrowserController({
    active: () => props.active,
    tabs,
    activeID,
    activeTab,
    menuOpen,
    updateTab: updateOpenTab,
  })
  tabBar = createSessionSideTabBarController({
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
  terminals = createSessionSideTerminalController({
    active: () => props.active,
    tabs,
    activeTab,
    directory: activeDirectory,
    createTab,
    updateTab: updateOpenTab,
    closeTab,
    closeMenu: tabBar.closeNewMenu,
    openURL: (url) => void openInputInNewTab(url),
  })
  const activeFilePath = createMemo(() => activeTab()?.kind === "file" ? activeTab()?.path ?? "" : "")
  const diagnostics = createWorkbenchDiagnosticsController({
    gui: () => props.gui,
    directory: activeDirectory, root: () => activeTab()?.kind === "file" ? activeTab()?.root : undefined,
    path: activeFilePath,
    content: () => activeTab()?.kind === "file" ? activeTab()?.text ?? "" : "",
  })
  files = createSessionSideFileController({
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
    afterSave: diagnostics.refresh,
    languageStatus: diagnostics.setLanguageStatus,
  })
  const agent = createSessionSideAgentController({
    enabled: () => !props.directoryOnly,
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
    const transfer = loadedSessionID.startsWith("pending:")
    if (transfer) browser.hideAll()
    disposeTabs(sessionReplacementCleanupTabs(previousTabs, transfer))
    const next = transfer
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
        if (props.directoryOnly) return
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
    disposeTabs(tabs())
  })
  const dirty = createMemo(() => activeTab() ? openTabDirty(activeTab()!) : false)
  // A files/picker tab *is* the explorer, so closing it closes the tab; beside
  // a file it is a side pane, so closing only hides it.
  const fileKinds = new Set(["file", "files", "picker"])
  const explorerVisible = () => activeTab()?.kind !== "file" || explorerOpen()
  const closeExplorerPane = () => (activeTab()?.kind === "file" ? setExplorerOpen(false) : files.closeExplorer())

  function fileExplorerPane(close: () => void) {
    return (
      <div class="session-open-file-pane" style={{ width: `${explorerWidth()}px` }}>
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
          openFile={openFromExplorer}
          close={close}
        />
        <div class="session-open-file-resize" role="separator" aria-orientation="vertical" aria-label="Resize file explorer" onPointerDown={startExplorerResize} />
      </div>
    )
  }
  function startExplorerResize(event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    const pointerID = event.pointerId
    const origin = event.clientX
    const startWidth = explorerWidth()
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerID) return
      setExplorerWidth(clampExplorerWidth(startWidth + (moveEvent.clientX - origin)))
    }
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerID) return
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", finish)
      try { localStorage.setItem(EXPLORER_WIDTH_KEY, String(explorerWidth())) } catch { /* storage unavailable */ }
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", finish)
  }

  return (
    <section class="session-side-open">
      <SessionSideOpenChrome sessionID={props.sessionID} tabs={tabs()} activeTab={activeTab()} controller={tabBar} changedFiles={props.diffs.flatMap((file) => file.file ? [file.file] : [])} addGit={addGitTab} addFile={addFileTab} addTerminal={terminals.create} addContext={addContextTab} directoryOnly={props.directoryOnly} addWeb={addWebTab} setWebInput={setActiveInput} openWebInput={() => void openActiveInput()} browserAction={(action) => void browser.action(action)} browserDevtools={() => void browser.devtools()} browserExternal={() => void browser.openExternal()} browserScreenshot={browser.screenshot} updateTab={updateOpenTab} openFiles={() => setExplorerOpen((open) => !open)} explorerOpen={explorerOpen()} discardFile={files.discardActiveChanges} saveFile={() => void files.saveActiveFile()} dirty={dirty()} readOnly={activeTab()?.readOnly === true} agentBrowsing={agent.active()} reloadExternal={files.reloadExternalFile} keepLocal={files.keepLocalChanges} />
      <Switch>
        <Match when={!props.directoryOnly && activeTab()?.kind === "context" && props.contextModel}>
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
              model={props.contextModel!}
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
            controller={props.git}
            gui={props.gui}
            directory={activeDirectory()}
            request={props.request?.tab === "git" ? props.request : undefined}
            openCommitModal={props.openCommitModal}
            openFile={(path) => void openInputInNewTab(path)}
            refresh={props.git.refresh}
          />
        </Match>
        {/* One branch for the explorer and the file it opens into. Splitting
            them meant picking a file crossed a Match boundary, unmounting the
            explorer and remounting it beside the editor - the whole pane
            flashed for what is really just the content area changing. */}
        <Match when={fileKinds.has(activeTab()?.kind ?? "")}>
          <div class="session-open-file-split">
            <Show when={explorerVisible()}>{fileExplorerPane(closeExplorerPane)}</Show>
            <div class="session-open-file-content">
              <Switch>
                <Match when={activeTab()?.kind !== "file"}>
                  <div class="session-side-empty">Select a file to view it here.</div>
                </Match>
                <Match when={activeTab()?.loading}>
                  <SessionSideFileSkeleton />
                </Match>
                <Match when={activeTab()?.fileMode === "metadata"}>
                  <div class="session-side-empty">File metadata only. Preview content is omitted above 2 MiB.</div>
                </Match>
                <Match when={isWorkbenchImageContent(activeTab()?.content)}>
                  <div class="workbench-image-preview">
                    <img src={`data:${activeTab()?.content?.mimeType ?? "image/png"};base64,${activeTab()?.content?.content ?? ""}`} alt={activeTab()?.path} />
                  </div>
                </Match>
                <Match when={activeTab()?.content?.type === "binary"}>
                  <div class="session-side-empty">Binary preview is read-only.</div>
                </Match>
                <Match when={activeTab()?.content?.type === "text" && activeTab()?.fileMode === "preview"}>
                  <pre class="session-open-large-file">{activeTab()?.text}</pre>
                </Match>
                <Match when={activeTab()?.content?.type === "text"}>
                  <SessionSideFileEditor
                    tab={activeTab()}
                    diagnostics={diagnostics}
                    navigation={files.navigation()}
                    change={(value) => activeTab() && !activeTab()?.readOnly && updateOpenTab(activeTab()!.id, { text: value })}
                    save={() => void files.saveActiveFile()}
                    definition={(position) => void files.openDefinition(position)}
                    hover={files.loadHover}
                    completion={files.loadCompletion}
                  />
                </Match>
              </Switch>
            </div>
          </div>
        </Match>
        <Match when={activeTab()?.kind === "web"}>
          <SessionSideBrowserHost preview={browser.activePreview()} parked={browser.parkedID() === activeTab()?.id} available={Boolean(window.opencodex?.browser)} lifecycle={browser.lifecycle()} error={browser.error()} url={activeTab()?.url ?? ""} setHost={browser.setHost} />
        </Match>
        <Match when={activeTab()?.kind === "terminal"}>
          <SessionOpenTerminal tab={activeTab()!} write={terminals.write} rename={terminals.rename} />
        </Match>
        <Match when={true}>
          <SessionSideEmptyState
            directory={props.directory} diffs={props.diffs}
            openContext={addContextTab} showContext={!props.directoryOnly}
            openGit={addGitTab} openFiles={files.openExplorer}
            openChangedFile={(path) => void openInputInNewTab(path)}
            openTerminal={terminals.create} addWebTab={addWebTab}
          />
        </Match>
      </Switch>
    </section>
  )
}

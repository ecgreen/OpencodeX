import type { LspStatus, Provider, Session } from "@opencode-ai/sdk/v2/client"
import { For, Match, Show, Switch, createEffect, createMemo, createResource, createSignal, onCleanup, untrack } from "solid-js"
import type { GuiClient } from "../lib/client"
import type { DiffFile, GuiSnapshot, SessionData } from "../lib/store"
import { isWorkbenchImageContent, workbenchBufferDirty, workbenchNormalizeBrowserURL } from "../lib/workbench"
import { compactPath } from "../lib/format"
import { newBrowserID } from "./workbench-page-helpers"
import { LazyCodeEditor } from "./lazy-code-editor"
import { Icon } from "./icon"
import { IconButton, Select, TextInput } from "./ui"
import { SessionContextPanel, sessionInspectorModel } from "./session-inspector"
import {
  SIDE_PANEL_GIT_VISIBLE_RECHECK_MS,
  loadCachedSidePanelGit,
  normalizeSidePanelDiffs,
  refreshSidePanelGitIfStale,
  resourceGitCacheKey,
  sidePanelGitCacheKey,
  sidePanelGitCacheVersions,
  type SidePanelGitResult,
} from "./session-side-git-controller"
import { SessionSideDiffPanel, SidePanelGitCommitModal } from "./session-side-git-view"
import { createSessionSideBrowserController } from "./session-side-browser-controller"
import { SessionSideBrowserHost } from "./session-side-browser-host"
import { readSessionSideContextCollapseState, writeSessionSideContextCollapseState } from "./session-side-context-state"
import { SessionSideEmptyState } from "./session-side-empty"
import { createSessionSideFileController } from "./session-side-file-controller"
import { SessionSideFileExplorer } from "./session-side-file-explorer"
import { createSessionSideTabBarController } from "./session-side-tab-bar-controller"
import { SessionSideTabBar } from "./session-side-tab-bar"
import { openTabDefaults, restoreOpenPanelState, saveOpenPanelState } from "./session-side-open-state"
import { OPEN_PANEL_EDIT_LIMIT, type OpenTab } from "./session-side-open-types"
import { filePathFromInput, inputLabel, isBrowserInput, webLocationValue } from "./session-side-path"
import { SessionOpenTerminal, createSessionSideTerminalController } from "./session-side-terminal"
import type { SessionSidePanelContextOption, SessionSidePanelRequest } from "./session-side-panel-types"

export function SessionSideOpenPanel(props: {
  sessionID: string
  active: boolean
  gui?: GuiClient
  directory?: string
  request?: SessionSidePanelRequest
  closePanel: () => void
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
  openCommitModal: () => void
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
  })
  const files = createSessionSideFileController({
    active: () => props.active,
    gui: () => props.gui,
    directory: activeDirectory,
    activeID,
    activeTab,
    createTab,
    updateTab: updateOpenTab,
    closeTab,
    addFileTab,
    hideWebTabs: browser.hideAll,
  })

  createEffect(() => {
    const sessionID = props.sessionID
    if (sessionID === loadedSessionID) return
    saveOpenPanelState(loadedSessionID, untrack(tabs), untrack(activeID))
    browser.hideAll()
    const next = restoreOpenPanelState(sessionID)
    loadedSessionID = sessionID
    setTabs(next.tabs)
    setActiveID(next.activeID)
    tabBar.clearDrag()
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

  function selectSingletonTab(kind: "context" | "git", title: string) {
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
    createTab({ kind: "picker", title: "Open file" })
    tabBar.closeNewMenu()
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
    if (closing?.kind === "web") browser.close(closing)
    if (closing?.kind === "terminal") terminals.close(closing)
    setTabs(next)
    if (activeID() === id) setActiveID(next[Math.min(index, next.length - 1)]?.id ?? next[0]?.id ?? "")
  }

  async function openActiveInput() {
    const tab = activeTab()
    if (!tab) return
    await openInput(tab.id, tab.input)
  }

  async function openInputInNewTab(value: string, title?: string) {
    const id = createTab({ input: value, title: title || inputLabel(value, activeDirectory()) })
    await openInput(id, value, title)
  }

  async function openInput(id: string, value: string, title?: string) {
    const trimmed = value.trim()
    if (!trimmed) return
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
      <IconButton class="session-side-panel-close" icon="x" label="Close side panel" onClick={props.closePanel} />
      <Show when={tabs().length > 0}>
        <div class="session-open-chrome">
          <SessionSideTabBar
            controller={tabBar}
            addGit={addGitTab}
            addFile={addFileTab}
            addTerminal={terminals.create}
            addContext={addContextTab}
            addWeb={addWebTab}
          />
          <Show when={activeTab()?.kind === "web"}>
            <div class="session-open-bar">
              <IconButton icon="chevronLeft" label="Back" disabled={!activeTab()?.state?.canGoBack} onClick={() => void browser.action("back")} />
              <IconButton icon="chevronRight" label="Forward" disabled={!activeTab()?.state?.canGoForward} onClick={() => void browser.action("forward")} />
              <IconButton icon={activeTab()?.state?.loading ? "stop" : "refresh"} label={activeTab()?.state?.loading ? "Stop loading" : "Refresh"} onClick={() => void browser.action(activeTab()?.state?.loading ? "stop" : "reload")} />
              <div class="session-open-location">
                <Icon name="browser" />
                <TextInput
                  value={webLocationValue(activeTab()?.input ?? "")}
                  onInput={(event) => setActiveInput(event.currentTarget.value)}
                  onKeyDown={(event) => event.key === "Enter" && void openActiveInput()}
                  placeholder="Search or enter address"
                />
              </div>
            </div>
          </Show>
          <Show when={activeTab()?.kind === "file"}>
            <div class="session-open-file-bar">
              <span><Icon name="file" /> {activeTab()?.path ? compactPath(activeTab()?.path ?? "") : "File"}</span>
              <div class="session-open-file-actions">
                <IconButton icon="folder-open" label="Open another file in this tab" onClick={files.openInActiveTab} />
                <IconButton icon="save" label="Save file" disabled={!dirty()} onClick={() => void files.saveActiveFile()} />
              </div>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={activeTab()?.message}>
        {(message) => <div class="session-side-message">{message()}</div>}
      </Show>
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
            request={props.request?.tab === "git" ? props.request : undefined}
            openCommitModal={props.openCommitModal}
          />
        </Match>
        <Match when={activeTab()?.kind === "picker"}>
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
            onChange={(value) => activeTab() && updateOpenTab(activeTab()!.id, { text: value })}
            onSave={() => void files.saveActiveFile()}
          />
        </Match>
        <Match when={activeTab()?.kind === "web"}>
          <SessionSideBrowserHost preview={browser.activePreview()} parked={browser.parkedID() === activeTab()?.id} available={Boolean(window.opencodex?.browser)} lifecycle={browser.lifecycle()} error={browser.error()} url={activeTab()?.url ?? ""} setHost={browser.setHost} />
        </Match>
        <Match when={activeTab()?.kind === "terminal"}>
          <SessionOpenTerminal tab={activeTab()!} write={terminals.write} />
        </Match>
        <Match when={true}>
          <SessionSideEmptyState directory={props.directory} openContext={addContextTab} openGit={addGitTab} openFile={files.openExplorer} openTerminal={terminals.create} addWebTab={addWebTab} />
        </Match>
      </Switch>
    </section>
  )
}

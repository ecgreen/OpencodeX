import type { FileContent, FileNode, LspStatus, Provider, Session } from "@opencode-ai/sdk/v2/client"
import type { WorkbenchBrowserTabState } from "../lib/workbench"
import { File as FileDiffView } from "@opencode-ai/ui/file"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { For, Match, Show, Switch, createEffect, createMemo, createResource, createSignal, onCleanup, onMount, untrack } from "solid-js"
import { Portal } from "solid-js/web"
import type { GuiClient } from "../lib/client"
import type { DiffFile, GuiSnapshot, SessionData, WorkbenchDataResult, WorkbenchGitBranches, WorkbenchGitStatus } from "../lib/store"
import { findFiles, listWorkbenchFiles, readWorkbenchFile, workbenchGitBranches, workbenchGitDiff, workbenchGitOperation, workbenchGitStatus, writeWorkbenchFile } from "../lib/store"
import { flattenWorkbenchFileTree, isWorkbenchImageContent, workbenchBufferDirty, workbenchNormalizeBrowserURL, workbenchPathKey, type WorkbenchTreeRow } from "../lib/workbench"
import { patchContents } from "../lib/tool-display"
import { compactPath } from "../lib/format"
import { moveRelative } from "../lib/reorder"
import { OPEN_TAB_LAYOUT_FALLBACK_MEASUREMENTS, numberedDuplicateOpenTabLabels, visibleOpenTabIDs, type OpenTabLayoutMeasurements } from "../lib/open-tabs"
import { buildDiffFileTree, expandedDirectories, flattenDiffFileTree } from "../lib/diff-file-tree"
import { newBrowserID } from "./workbench-page-helpers"
import { CodeEditor } from "./code-editor"
import { Icon } from "./icon"
import { Button, IconButton, TextArea, TextInput } from "./ui"
import { SessionContextPanel, sessionInspectorModel } from "./session-inspector"
import { ModalFrame } from "./modal-frame"

export type SessionSidePanelTab = "context" | "git" | "open"

export type SessionSidePanelTarget =
  | { tab: "context" }
  | { tab: "git"; value?: string }
  | { tab: "open"; value?: string; title?: string }

export type SessionSidePanelRequest = SessionSidePanelTarget & { token: number }

export type SessionSidePanelContextOption = {
  id: string
  label: string
  description?: string
}

type OpenTab = {
  id: string
  input: string
  title: string
  kind: "context" | "file" | "git" | "picker" | "terminal" | "web"
  path?: string
  directory?: string
  url?: string
  state?: WorkbenchBrowserTabState
  content?: FileContent
  text: string
  original: string
  terminalStatus?: "connecting" | "open" | "closed" | "error"
  message?: string
}

type OpenPanelState = {
  tabs: OpenTab[]
  activeID: string
}

type OpenTabRow =
  | { type: "tab"; tab: OpenTab }
  | { type: "placeholder"; id: string; width: number }

type OpenTabDragPreview = {
  id: string
  x: number
  y: number
  width: number
  height: number
}

type PopupMenuPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

const OPEN_PANEL_EDIT_LIMIT = 750_000
const OPEN_PANEL_OVERFLOW_VISIBLE_ROWS = 5
const OPEN_PANEL_OVERFLOW_FALLBACK_MAX_HEIGHT = 182
const SIDE_DIFF_SPLIT_MIN = 0.22
const SIDE_DIFF_SPLIT_MAX = 0.55
const SIDE_PANEL_GIT_STATUS_CHECK_MS = 5_000
const SIDE_PANEL_GIT_VISIBLE_RECHECK_MS = 6_000
const SIDE_PANEL_GIT_FULL_REFRESH_MS = 30_000
const SIDE_PANEL_GIT_FALLBACK_REFRESH_MS = 120_000
const SIDE_PANEL_GIT_MAX_CACHE_ENTRIES = 12

type SidePanelGitResult = {
  diff: WorkbenchDataResult<DiffFile[]>
  status?: WorkbenchGitStatus
  branches?: WorkbenchGitBranches
  fallback?: "project-files"
}

type SidePanelGitCacheEntry = {
  result: SidePanelGitResult
  loadedAt: number
  statusCheckedAt: number
  statusSignature: string
}

const sidePanelGitCache = new Map<string, SidePanelGitCacheEntry>()
const sidePanelGitRequests = new Map<string, Promise<SidePanelGitResult>>()
const sidePanelGitStatusRequests = new Map<string, Promise<WorkbenchGitStatus | undefined>>()
const openPanelStateBySession = new Map<string, OpenPanelState>()
const terminalViews = new Map<string, TerminalView>()
const openTerminalIDs = new Set<string>()
const terminalRestartTimers = new Map<string, number>()
const [sidePanelGitCacheVersions, setSidePanelGitCacheVersions] = createSignal<Record<string, number>>({})

function cancelTerminalRestart(id: string) {
  const timer = terminalRestartTimers.get(id)
  if (timer === undefined) return
  window.clearTimeout(timer)
  terminalRestartTimers.delete(id)
}

function terminalExitDescription(event: { exitCode?: number; signal?: number | string }) {
  if (typeof event.exitCode === "number") return ` with code ${event.exitCode}`
  if (event.signal !== undefined) return ` from signal ${event.signal}`
  return ""
}

function terminalExitShouldRestart(event: { exitCode?: number; signal?: number | string }) {
  return event.exitCode === undefined || event.exitCode !== 0 || event.signal !== undefined
}

type TerminalView = {
  terminal: Terminal
  fit: FitAddon
  disposeInput: () => void
  resizeObserver?: ResizeObserver
}

export function SessionSidePanel(props: {
  open: boolean
  widthRatio: number
  session: Session
  data: SessionData
  providers: Provider[]
  mcp: GuiSnapshot["mcp"]
  lsp: LspStatus[]
  config: GuiSnapshot["config"]
  gui?: GuiClient
  directory?: string
  request?: SessionSidePanelRequest
  contextOptions?: SessionSidePanelContextOption[]
  selectedContextID?: string
  selectContext?: (id: string) => void
  startResize: (event: PointerEvent & { currentTarget: HTMLElement }) => void
  close: () => void
}) {
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>(readContextCollapseState())
  const [commitModalOpen, setCommitModalOpen] = createSignal(false)
  const gitDirectory = createMemo(() => props.directory ?? props.session.directory)
  const gitCacheKey = createMemo(() => sidePanelGitCacheKey(props.gui, gitDirectory()))
  const gitResourceKey = createMemo(() => `${sidePanelGitCacheVersions()[gitCacheKey()] ?? 0}\u0000${gitCacheKey()}`)
  const [gitResult, { refetch: refetchGit }] = createResource<SidePanelGitResult, string, "force">(gitResourceKey, (key, info) =>
    loadCachedSidePanelGit({ key: resourceGitCacheKey(key), gui: props.gui, directory: gitDirectory() }, info.refetching === "force"),
  )
  const gitFiles = createMemo(() => normalizeDiffs(gitResult()?.diff.data ?? []))
  const gitMessage = createMemo(() => gitResult()?.diff.message ?? (gitResult()?.diff.ok === false ? "Unable to load Git diff." : ""))
  const contextModel = createMemo(() => sessionInspectorModel({
    session: props.session,
    data: props.data,
    providers: props.providers,
    mcp: props.mcp ?? {},
    lsp: props.lsp ?? [],
    lspEnabled: props.config?.lsp === undefined ? undefined : props.config.lsp !== false,
  }))

  createEffect(() => {
    if (!props.open) return
    const gui = props.gui
    if (!gui) return
    const key = gitCacheKey()
    const directory = gitDirectory()
    const refresh = () => void refreshSidePanelGitIfStale({ key, gui, directory })
    refresh()
    const interval = window.setInterval(refresh, SIDE_PANEL_GIT_VISIBLE_RECHECK_MS)
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh()
    }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refreshWhenVisible)
    onCleanup(() => {
      window.clearInterval(interval)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
    })
  })

  const toggleContext = (section: string) => {
    setCollapsed((current) => {
      const next = { ...current, [section]: !current[section] }
      writeContextCollapseState(next)
      return next
    })
  }

  return (
    <>
      <div
        class="session-side-panel-resize"
        classList={{ open: props.open }}
        role="separator"
        aria-orientation="vertical"
        tabIndex={props.open ? 0 : -1}
        onPointerDown={props.startResize}
      >
        <Icon name="panel" />
      </div>
      <aside
        class="session-side-panel"
        classList={{ open: props.open }}
        style={{ "--session-side-panel-width": `${Math.round(props.widthRatio * 10000) / 100}%` }}
        aria-label="Side panel"
        aria-hidden={!props.open}
      >
        <SessionSideOpenPanel
          sessionID={props.session.id}
          active={props.open}
          gui={props.gui}
          directory={props.directory ?? props.session.directory}
          request={props.request}
          closePanel={props.close}
          contextModel={contextModel()}
          contextOptions={props.contextOptions}
          selectedContextID={props.selectedContextID}
          selectContext={props.selectContext}
          contextCollapsed={collapsed()}
          toggleContext={toggleContext}
          lsp={props.lsp ?? []}
          lspEnabled={props.config?.lsp === undefined ? undefined : props.config.lsp !== false}
          diffs={props.data.diffs}
          gitFiles={gitFiles()}
          gitMessage={gitMessage() || "No project changes."}
          gitLoading={gitResult.loading}
          openCommitModal={() => setCommitModalOpen(true)}
        />
      </aside>
      <Show when={commitModalOpen()}>
        <SidePanelGitCommitModal
          gui={props.gui}
          directory={gitDirectory()}
          status={gitResult()?.status}
          branches={gitResult()?.branches}
          files={gitFiles()}
          close={() => setCommitModalOpen(false)}
          refresh={() => void refetchGit("force")}
        />
      </Show>
    </>
  )
}

function loadCachedSidePanelGit(input: { key: string; gui?: GuiClient; directory?: string }, force = false) {
  if (!force) {
    const cached = sidePanelGitCache.get(input.key)
    if (cached) {
      void refreshSidePanelGitIfStale(input)
      return cached.result
    }
    const pending = sidePanelGitRequests.get(input.key)
    if (pending) return pending
  }
  sidePanelGitRequests.delete(input.key)
  const request = loadSidePanelGit(input)
    .then((result) => {
      if (sidePanelGitRequests.get(input.key) === request) writeSidePanelGitCache(input.key, result)
      return result
    })
    .finally(() => {
      if (sidePanelGitRequests.get(input.key) === request) sidePanelGitRequests.delete(input.key)
    })
  sidePanelGitRequests.set(input.key, request)
  return request
}

async function refreshSidePanelGitIfStale(input: { key: string; gui?: GuiClient; directory?: string }) {
  const gui = input.gui
  if (!gui) return
  const cached = sidePanelGitCache.get(input.key)
  if (!cached) {
    await loadCachedSidePanelGit(input)
    return
  }
  const now = Date.now()
  const fullRefreshMs = cached.result.fallback === "project-files" ? SIDE_PANEL_GIT_FALLBACK_REFRESH_MS : SIDE_PANEL_GIT_FULL_REFRESH_MS
  if (now - cached.loadedAt >= fullRefreshMs) {
    await loadCachedSidePanelGit(input, true)
    return
  }
  if (cached.result.fallback === "project-files" || now - cached.statusCheckedAt < SIDE_PANEL_GIT_STATUS_CHECK_MS) return
  const status = await loadSidePanelGitStatus({ key: input.key, gui, directory: input.directory })
  const latest = sidePanelGitCache.get(input.key)
  if (!latest) return
  latest.statusCheckedAt = Date.now()
  if (sidePanelGitStatusSignature(status) === latest.statusSignature) return
  await loadCachedSidePanelGit(input, true)
}

async function loadSidePanelGit(input: { gui?: GuiClient; directory?: string }): Promise<SidePanelGitResult> {
  if (!input.gui) return {
    diff: { ok: false, message: "GUI client is not ready.", data: [] as DiffFile[] },
    status: undefined,
    branches: undefined,
  }
  const [diff, status, branches] = await Promise.all([
    workbenchGitDiff(input.gui, input.directory),
    workbenchGitStatus(input.gui, input.directory).catch(() => undefined),
    workbenchGitBranches(input.gui, input.directory).catch(() => undefined),
  ])
  if (diff.ok !== false || !isNonGitMessage(diff.message)) return { diff, status, branches }
  const fallback = {
    ok: true,
    message: "No Git repository found. Showing project files as added.",
    data: await projectFilesAsAddedDiffs(input.gui, input.directory),
  }
  return { diff: fallback, status, branches, fallback: "project-files" }
}

function sidePanelGitCacheKey(gui: GuiClient | undefined, directory: string | undefined) {
  return `${gui?.url ?? "no-gui"}\n${normalizeRoot(directory ?? gui?.directory ?? "")}`
}

function resourceGitCacheKey(value: string) {
  const index = value.indexOf("\u0000")
  return index >= 0 ? value.slice(index + 1) : value
}

function writeSidePanelGitCache(key: string, result: SidePanelGitResult) {
  sidePanelGitCache.set(key, {
    result,
    loadedAt: Date.now(),
    statusCheckedAt: Date.now(),
    statusSignature: sidePanelGitStatusSignature(result.status),
  })
  pruneSidePanelGitCache()
  setSidePanelGitCacheVersions((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }))
}

function pruneSidePanelGitCache() {
  if (sidePanelGitCache.size <= SIDE_PANEL_GIT_MAX_CACHE_ENTRIES) return
  Array.from(sidePanelGitCache.entries())
    .toSorted((left, right) => left[1].loadedAt - right[1].loadedAt)
    .slice(0, sidePanelGitCache.size - SIDE_PANEL_GIT_MAX_CACHE_ENTRIES)
    .forEach(([key]) => sidePanelGitCache.delete(key))
}

function loadSidePanelGitStatus(input: { key: string; gui: GuiClient; directory?: string }) {
  const pending = sidePanelGitStatusRequests.get(input.key)
  if (pending) return pending
  const request = workbenchGitStatus(input.gui, input.directory)
    .catch(() => undefined)
    .finally(() => {
      if (sidePanelGitStatusRequests.get(input.key) === request) sidePanelGitStatusRequests.delete(input.key)
    })
  sidePanelGitStatusRequests.set(input.key, request)
  return request
}

function sidePanelGitStatusSignature(status: WorkbenchGitStatus | undefined) {
  if (!status?.ok) return "unavailable"
  return JSON.stringify({
    branch: status.branch ?? "",
    upstream: status.upstream ?? "",
    ahead: status.ahead ?? 0,
    behind: status.behind ?? 0,
    clean: status.clean,
    files: status.files
      .map((file) => `${file.path}\u0000${file.code}\u0000${file.status}\u0000${file.staged ? 1 : 0}\u0000${file.unstaged ? 1 : 0}\u0000${file.untracked ? 1 : 0}`)
      .toSorted(),
  })
}

function SessionSideDiffPanel(props: {
  title: string
  empty: string
  loading: boolean
  files: DiffFile[]
  request?: { token: number; value?: string }
  openCommitModal: () => void
}) {
  const [selectedFile, setSelectedFile] = createSignal("")
  const [expandedTree, setExpandedTree] = createSignal<ReadonlySet<string>>(new Set())
  const [splitRatio, setSplitRatio] = createSignal(0.32)
  const fileTree = createMemo(() => buildDiffFileTree(props.files))
  const rows = createMemo(() => flattenDiffFileTree(fileTree(), expandedTree()))
  const selected = createMemo(() => props.files.find((file) => file.file === selectedFile()) ?? props.files[0])
  const totals = createMemo(() => props.files.reduce((total, file) => ({
    additions: total.additions + file.additions,
    deletions: total.deletions + file.deletions,
  }), { additions: 0, deletions: 0 }))

  createEffect(() => setExpandedTree(expandedDirectories(fileTree())))
  createEffect(() => {
    if (selectedFile() && props.files.some((file) => file.file === selectedFile())) return
    setSelectedFile(props.files[0]?.file ?? "")
  })
  createEffect(() => {
    const request = props.request
    if (!request?.token || !request.value) return
    const file = diffFileForPath(props.files, request.value)
    if (!file?.file) return
    setSelectedFile(file.file)
  })

  const startSplitResize = (event: PointerEvent & { currentTarget: HTMLElement }) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const container = event.currentTarget.parentElement
    const width = container?.getBoundingClientRect().width ?? 1
    const startX = event.clientX
    const startRatio = splitRatio()
    const onMove = (moveEvent: PointerEvent) => {
      setSplitRatio(clamp(startRatio + ((moveEvent.clientX - startX) / width), SIDE_DIFF_SPLIT_MIN, SIDE_DIFF_SPLIT_MAX))
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  return (
    <section class="session-side-diff">
      <header>
        <div>
          <strong>{props.title}</strong>
          <span>{props.files.length} file{props.files.length === 1 ? "" : "s"} <b class="diff-additions">+{totals().additions}</b> <b class="diff-deletions">-{totals().deletions}</b></span>
        </div>
        <button type="button" class="session-side-git-action" onClick={props.openCommitModal}><Icon name="send" /> Commit / Push</button>
      </header>
      <Show when={!props.loading} fallback={<div class="session-side-empty">Loading diff...</div>}>
        <Show when={props.files.length > 0} fallback={<div class="session-side-empty">{props.empty}</div>}>
          <div class="session-side-diff-layout" style={{ "--session-side-file-list-width": `${Math.round(splitRatio() * 10000) / 100}%` }}>
            <aside class="session-side-file-list">
              <For each={rows()}>
                {(row) => (
                  <button
                    type="button"
                    classList={{ selected: row.file?.file === selected()?.file, directory: row.type === "directory", expanded: row.type === "directory" && expandedTree().has(row.id) }}
                    style={{ "--indent": `${row.depth * 14}px` }}
                    onClick={() => {
                      if (!row.file?.file) {
                        setExpandedTree((current) => current.has(row.id) ? new Set([...current].filter((id) => id !== row.id)) : new Set([...current, row.id]))
                        return
                      }
                      setSelectedFile(row.file.file)
                    }}
                  >
                    <span class="session-side-tree-guides" aria-hidden="true">
                      <For each={row.guides}>
                        {(active, index) => <span classList={{ active }} style={{ "--guide-indent": `${index() * 14}px` }} />}
                      </For>
                    </span>
                    <span class="session-side-file-name">
                      <span class="session-side-disclosure" classList={{ placeholder: row.type !== "directory" }}>
                        <Show when={row.type === "directory"}>
                          <Icon name={expandedTree().has(row.id) ? "chevronDown" : "chevronRight"} />
                        </Show>
                      </span>
                      <strong>{row.name}</strong>
                    </span>
                    <Show when={row.file}>
                      {(file) => <small><b class="diff-additions">+{file().additions}</b><b class="diff-deletions">-{file().deletions}</b></small>}
                    </Show>
                  </button>
                )}
              </For>
            </aside>
            <div
              class="session-side-diff-splitter"
              role="separator"
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={startSplitResize}
            >
              <Icon name="grip" />
            </div>
            <main class="session-side-patch">
              <Show when={selected()} fallback={<div class="session-side-empty">Select a file.</div>}>
                {(file) => (
                  <section>
                    <header data-side-panel-file={file().file ?? ""}>
                      <strong>{file().file ?? ""}</strong>
                      <span>{file().status}</span>
                    </header>
                    <Show when={file().patch} fallback={<div class="session-side-empty">No text patch available.</div>}>
                      {(patch) => <SideDiffPatch file={file().file ?? ""} patch={patch()} />}
                    </Show>
                  </section>
                )}
              </Show>
            </main>
          </div>
        </Show>
      </Show>
    </section>
  )
}

function SideDiffPatch(props: { file: string; patch: string }) {
  const contents = createMemo(() => patchContents(props.patch, props.file))
  return (
    <div class="session-side-diff-patch">
      <Show when={contents()} fallback={<pre>{props.patch}</pre>}>
        {(value) => (
          <FileDiffView
            mode="diff"
            before={value().before}
            after={value().after}
            diffStyle="unified"
            overflow="scroll"
            virtualize={false}
            hunkSeparators="simple"
          />
        )}
      </Show>
    </div>
  )
}

function SidePanelGitCommitModal(props: {
  gui?: GuiClient
  directory?: string
  status?: WorkbenchGitStatus
  branches?: WorkbenchGitBranches
  files: DiffFile[]
  close: () => void
  refresh: () => void
}) {
  const currentBranch = createMemo(() => props.status?.branch ?? props.branches?.current ?? "")
  const [branch, setBranch] = createSignal(currentBranch())
  const [message, setMessage] = createSignal("")
  const [body, setBody] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [busy, setBusy] = createSignal<"" | "commit" | "commit-push" | "push">("")
  const changedPaths = createMemo(() => {
    const statusPaths = props.status?.files.map((file) => file.path).filter(Boolean) ?? []
    if (statusPaths.length > 0) return statusPaths
    return props.files.map((file) => file.file).filter((file): file is string => !!file)
  })
  const canPushAfterCommit = createMemo(() => !!props.status?.upstream || !!props.status?.remoteUrl)
  const canPushOnly = createMemo(() => !!props.status?.remoteUrl && (!props.status?.upstream || (props.status.ahead ?? 0) > 0))
  const pushLabel = createMemo(() => props.status?.upstream ? "Push" : "Publish branch")

  createEffect(() => setBranch(currentBranch()))

  async function run(action: "commit" | "commit-push" | "push") {
    const gui = props.gui
    if (!gui) {
      setNotice("GUI client is not ready.")
      return
    }
    setBusy(action)
    setNotice("")
    try {
      const result = await runGitCommitFlow({
        gui,
        directory: props.directory,
        action,
        currentBranch: currentBranch(),
        branch: branch(),
        paths: changedPaths(),
        message: message(),
        body: body(),
        publish: !props.status?.upstream,
      })
      setNotice(result.message)
      props.refresh()
      if (result.ok) props.close()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Git operation failed.")
    } finally {
      setBusy("")
    }
  }

  return (
    <ModalFrame
      class="session-git-modal"
      backdropClass="session-git-modal-backdrop"
      title="Commit / Push"
      description={`${changedPaths().length} file${changedPaths().length === 1 ? "" : "s"} in the working tree`}
      close={props.close}
      footer={(
        <div class="session-git-modal-actions">
          <Button variant="ghost" onClick={props.close}>Cancel</Button>
          <Button icon="send" disabled={!canPushOnly() || busy() !== ""} onClick={() => void run("push")}>{busy() === "push" ? "Pushing..." : pushLabel()}</Button>
          <Button icon="check" disabled={!message().trim() || changedPaths().length === 0 || busy() !== ""} onClick={() => void run("commit")}>{busy() === "commit" ? "Committing..." : "Commit"}</Button>
          <Button variant="primary" icon="send" disabled={!message().trim() || changedPaths().length === 0 || !canPushAfterCommit() || busy() !== ""} onClick={() => void run("commit-push")}>{busy() === "commit-push" ? "Working..." : `Commit + ${pushLabel()}`}</Button>
        </div>
      )}
    >
      <div class="session-git-modal-body">
        <div class="session-git-modal-summary">
          <div>
            <span>Current branch</span>
            <strong>{props.status?.branch ?? "No branch"}</strong>
          </div>
          <div>
            <span>Remote</span>
            <strong>{props.status?.upstream ?? (props.status?.remoteUrl ? "Publish required" : "No remote")}</strong>
          </div>
          <div>
            <span>Changes</span>
            <strong>{changedPaths().length} file{changedPaths().length === 1 ? "" : "s"}</strong>
          </div>
        </div>
        <label>
          <span>Branch</span>
          <select value={branch()} onChange={(event) => setBranch(event.currentTarget.value)}>
            <For each={props.branches?.branches ?? (currentBranch() ? [currentBranch()] : [])}>
              {(item) => <option value={item}>{item}</option>}
            </For>
          </select>
        </label>
        <label>
          <span>Commit summary</span>
          <TextInput value={message()} onInput={(event) => setMessage(event.currentTarget.value)} placeholder="Describe the change" autofocus />
        </label>
        <label>
          <span>Description</span>
          <TextArea value={body()} onInput={(event) => setBody(event.currentTarget.value)} placeholder="Optional details" />
        </label>
        <div class="session-git-modal-status">
          <span>Push readiness</span>
          <span>{props.status?.upstream ? `${props.status.upstream}${props.status.ahead ? `, ${props.status.ahead} ahead` : ""}` : props.status?.remoteUrl ? "No upstream. Push will publish this branch." : "No remote configured."}</span>
        </div>
        <Show when={notice()}>
          {(value) => <p class="session-git-modal-notice">{value()}</p>}
        </Show>
      </div>
    </ModalFrame>
  )
}

async function runGitCommitFlow(input: {
  gui: GuiClient
  directory?: string
  action: "commit" | "commit-push" | "push"
  currentBranch: string
  branch: string
  paths: string[]
  message: string
  body: string
  publish: boolean
}) {
  if (input.branch && input.branch !== input.currentBranch) {
    const checkout = await workbenchGitOperation(input.gui, "checkout", { branch: input.branch }, input.directory)
    if (!checkout.ok) return { ok: false, message: checkout.message ?? "Could not checkout branch." }
  }
  if (input.action !== "push") {
    if (input.paths.length === 0) return { ok: false, message: "No working tree changes to commit." }
    const stage = await workbenchGitOperation(input.gui, "stage", { paths: input.paths }, input.directory)
    if (!stage.ok) return { ok: false, message: stage.message ?? "Could not stage files." }
    const commit = await workbenchGitOperation(input.gui, "commit", {
      message: input.message.trim(),
      body: input.body.trim() || undefined,
    }, input.directory)
    if (!commit.ok) return { ok: false, message: commit.message ?? "Could not create commit." }
  }
  if (input.action === "commit") return { ok: true, message: "Committed changes." }
  const push = await workbenchGitOperation(input.gui, input.publish ? "publish" : "push", undefined, input.directory)
  return { ok: push.ok, message: push.message ?? (push.ok ? "Pushed current branch." : "Could not push current branch.") }
}

function SessionSideOpenPanel(props: {
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
  const [fileExplorerBusy, setFileExplorerBusy] = createSignal(false)
  const [filesByPath, setFilesByPath] = createSignal<Record<string, FileNode[]>>({})
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set())
  const [fileFilter, setFileFilter] = createSignal("")
  const [fileMatches, setFileMatches] = createSignal<FileNode[]>([])
  const [fileSearchState, setFileSearchState] = createSignal<"idle" | "loading" | "error">("idle")
  const [tabBarWidth, setTabBarWidth] = createSignal(0)
  const [tabMeasurements, setTabMeasurements] = createSignal<OpenTabLayoutMeasurements>(OPEN_TAB_LAYOUT_FALLBACK_MEASUREMENTS)
  const [dragTabID, setDragTabID] = createSignal("")
  const [tabDropTarget, setTabDropTarget] = createSignal<{ id: string; placement: "before" | "after" }>()
  const [tabDragPreview, setTabDragPreview] = createSignal<OpenTabDragPreview>()
  const [tabDragPlaceholderWidth, setTabDragPlaceholderWidth] = createSignal(168)
  const [newTabMenuOpen, setNewTabMenuOpen] = createSignal(false)
  const [overflowTabMenuOpen, setOverflowTabMenuOpen] = createSignal(false)
  const [newTabMenuPlacement, setNewTabMenuPlacement] = createSignal<PopupMenuPlacement>()
  const [overflowTabMenuPlacement, setOverflowTabMenuPlacement] = createSignal<PopupMenuPlacement>()
  const [webPreviewByID, setWebPreviewByID] = createSignal<Record<string, string>>({})
  const [parkedWebTabID, setParkedWebTabID] = createSignal("")
  const fileTreeRows = createMemo(() => flattenWorkbenchFileTree({
    root: filesByPath()[""] ?? [],
    children: filesByPath(),
    expanded: expandedFolders(),
    filter: fileFilter(),
  }))
  const pickerOpen = createMemo(() => activeTab()?.kind === "picker")
  const tabLabels = createMemo(() => numberedDuplicateOpenTabLabels(tabs().map((tab) => ({
    id: tab.id,
    label: openTabLabel(tab),
  }))))
  const visibleTabs = createMemo(() => {
    const visible = new Set(visibleOpenTabIDs({
      ids: tabs().map((tab) => tab.id),
      activeID: activeID(),
      width: tabBarWidth(),
      measurements: tabMeasurements(),
    }))
    return tabs().filter((tab) => visible.has(tab.id))
  })
  const openTabRows = createMemo<OpenTabRow[]>(() => {
    const items = visibleTabs()
    const source = dragTabID()
    if (!source) return items.map((tab) => ({ type: "tab", tab }))
    const byID = new Map(items.map((tab) => [tab.id, tab]))
    const target = tabDropTarget()
    const ids = target
      ? moveRelative(items.map((tab) => tab.id), source, target.id, target.placement)
      : items.map((tab) => tab.id)
    return ids.flatMap((id): OpenTabRow[] => {
      if (id === source) return [{ type: "placeholder", id, width: tabDragPlaceholderWidth() }]
      const tab = byID.get(id)
      return tab ? [{ type: "tab", tab }] : []
    })
  })
  const overflowTabs = createMemo(() => {
    const visible = new Set(visibleTabs().map((tab) => tab.id))
    return tabs().filter((tab) => !visible.has(tab.id))
  })
  const activeWebPreview = createMemo(() => {
    const tab = activeTab()
    if (!tab || tab.kind !== "web") return
    return webPreviewByID()[tab.id]
  })
  const previewTab = createMemo(() => tabs().find((tab) => tab.id === tabDragPreview()?.id))
  const previewLabel = createMemo(() => {
    const tab = previewTab()
    return tab ? openPanelTabLabel(tab) : undefined
  })
  const createdWebIDs = new Set<string>()
  const loadedWebURLByID = new Map<string, string>()
  const webLoadTokens = new Map<string, number>()
  const webPreviewTokens = new Map<string, number>()
  let fileSearchToken = 0
  let handledRequestToken = 0
  let loadedSessionID = props.sessionID
  let host: HTMLDivElement | undefined
  let tabBar: HTMLDivElement | undefined
  let tabMeasure: HTMLDivElement | undefined
  let newTabMenu: HTMLButtonElement | undefined
  let newTabMenuPanel: HTMLDivElement | undefined
  let overflowTabMenu: HTMLButtonElement | undefined
  let overflowTabMenuPanel: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined
  let openTabRowRects = new Map<string, DOMRect>()
  let openTabAnimationFrame = 0
  let tabMeasureAnimationFrame = 0
  let visibleWebTabID = ""
  let lastBrowserBoundsKey = ""

  createEffect(() => {
    const sessionID = props.sessionID
    if (sessionID === loadedSessionID) return
    saveOpenPanelState(loadedSessionID, untrack(tabs), untrack(activeID))
    hideWebTabs()
    setParkedWebTabID("")
    const next = restoreOpenPanelState(sessionID)
    loadedSessionID = sessionID
    setTabs(next.tabs)
    setActiveID(next.activeID)
    clearTabDrag()
  })

  createEffect(() => {
    saveOpenPanelState(loadedSessionID, tabs(), activeID())
  })

  createEffect(() => {
    if (overflowTabs().length > 0) return
    setOverflowTabMenuOpen(false)
  })

  createEffect(() => {
    if (!newTabMenuOpen()) return
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Node && (newTabMenu?.contains(event.target) || newTabMenuPanel?.contains(event.target))) return
      closeNewTabMenu()
    }
    document.addEventListener("pointerdown", closeMenu, true)
    onCleanup(() => document.removeEventListener("pointerdown", closeMenu, true))
  })

  createEffect(() => {
    if (!overflowTabMenuOpen()) return
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Node && (overflowTabMenu?.contains(event.target) || overflowTabMenuPanel?.contains(event.target))) return
      setOverflowTabMenuOpen(false)
    }
    document.addEventListener("pointerdown", closeMenu, true)
    onCleanup(() => document.removeEventListener("pointerdown", closeMenu, true))
  })

  createEffect(() => {
    const signature = tabs().map((tab) => `${tab.id}:${openPanelTabLabel(tab)}`).join("\n")
    void signature
    scheduleOpenTabMeasure()
  })

  onMount(() => {
    const repositionMenus = () => updateOpenMenuPlacements()
    const parkForResize = () => {
      const tab = activeTab()
      if (!props.active || !tab || tab.kind !== "web") return
      parkWebTab(tab.id)
    }
    const restoreAfterResize = () => {
      requestAnimationFrame(() => {
        const tab = activeTab()
        if (!props.active || !tab || tab.kind !== "web") return
        setParkedWebTabID("")
        void showWebTab(tab)
      })
    }
    window.addEventListener("resize", repositionMenus)
    window.addEventListener("scroll", repositionMenus, true)
    window.addEventListener("opencodex:session-side-panel-resize-start", parkForResize)
    window.addEventListener("opencodex:session-side-panel-resize-end", restoreAfterResize)
    onCleanup(() => {
      window.removeEventListener("resize", repositionMenus)
      window.removeEventListener("scroll", repositionMenus, true)
      window.removeEventListener("opencodex:session-side-panel-resize-start", parkForResize)
      window.removeEventListener("opencodex:session-side-panel-resize-end", restoreAfterResize)
    })
    if (!tabBar) return
    scheduleOpenTabMeasure()
    const observer = new ResizeObserver(scheduleOpenTabMeasure)
    observer.observe(tabBar)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    const signature = openTabRows().map(openTabRowKey).join("\n")
    const active = dragTabID() !== ""
    cancelAnimationFrame(openTabAnimationFrame)
    openTabAnimationFrame = requestAnimationFrame(() => {
      openTabRowRects = animateOpenTabRows(openTabRowRects, active)
      void signature
    })
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

  createEffect(() => {
    const terminal = window.opencodex?.terminal
    if (!terminal) return
    const disposeData = terminal.onData((event) => {
      const tab = tabs().find((tab) => tab.id === event.id)
      if (!tab || tab.kind !== "terminal") return
      cancelTerminalRestart(event.id)
      ensureTerminalView(event.id, writeTerminal).terminal.write(event.data)
      if (openTerminalIDs.has(event.id)) return
      openTerminalIDs.add(event.id)
      updateOpenTab(event.id, { terminalStatus: "open" })
    })
    const disposeExit = terminal.onExit((event) => {
      const tab = tabs().find((tab) => tab.id === event.id)
      if (!tab || tab.kind !== "terminal") return
      openTerminalIDs.delete(event.id)
      cancelTerminalRestart(event.id)
      const shouldRestart = terminalExitShouldRestart(event)
      ensureTerminalView(event.id, writeTerminal).terminal.writeln(
        shouldRestart
          ? `\r\n[terminal process exited${terminalExitDescription(event)}; restarting...]`
          : `\r\n[process exited${terminalExitDescription(event)}]`,
      )
      updateOpenTab(event.id, { terminalStatus: shouldRestart ? "connecting" : "closed" })
      if (shouldRestart) scheduleTerminalRestart(event.id)
    })
    onCleanup(() => {
      disposeData()
      disposeExit()
    })
  })

  createEffect(() => {
    const tab = activeTab()
    const menuOpen = newTabMenuOpen() || overflowTabMenuOpen()
    const signature = `${props.active ? "1" : "0"}:${tab?.id ?? ""}:${tab?.kind ?? ""}:${tab?.kind === "web" ? tab.url ?? "" : ""}:${menuOpen ? "menu" : "ready"}`
    void signature
    if (!props.active || !tab || tab.kind !== "web") {
      hideWebTabs()
      return
    }
    if (menuOpen) {
      parkWebTab(tab.id)
      return
    }
    void showWebTab(tab)
  })

  createEffect(() => {
    if (!props.active) return
    const tab = activeTab()
    if (!tab || tab.kind !== "terminal") return
    queueMicrotask(() => {
      fitTerminalView(tab.id)
      terminalViews.get(tab.id)?.terminal.focus()
    })
  })

  createEffect(() => {
    const directory = activeDirectory()
    if (!props.active || !pickerOpen() || !props.gui || !directory) return
    if (filesByPath()[""] !== undefined) return
    void refreshExplorerFiles("")
  })

  createEffect(() => {
    const gui = props.gui
    const query = fileFilter().trim()
    const directory = activeDirectory()
    const token = ++fileSearchToken
    if (!pickerOpen() || !gui || !directory || query.length < 2) {
      setFileMatches([])
      setFileSearchState("idle")
      return
    }
    setFileSearchState("loading")
    findFiles(gui, { query, directory, limit: 40 })
      .then((matches) => {
        if (token !== fileSearchToken) return
        setFileMatches(matches.filter((file) => file.path))
        setFileSearchState("idle")
      })
      .catch(() => {
        if (token !== fileSearchToken) return
        setFileMatches([])
        setFileSearchState("error")
      })
  })

  createEffect(() => {
    const directory = activeDirectory()
    setFilesByPath({})
    setExpandedFolders(new Set<string>())
    setFileFilter("")
    setFileMatches([])
    setFileSearchState(directory ? "idle" : "error")
  })

  createEffect(() => {
    if (!props.active || activeTab()?.kind !== "file") return
    const save = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return
      event.preventDefault()
      void saveActiveFile()
    }
    document.addEventListener("keydown", save)
    onCleanup(() => document.removeEventListener("keydown", save))
  })

  onCleanup(() => {
    saveOpenPanelState(loadedSessionID, tabs(), activeID())
    cancelAnimationFrame(openTabAnimationFrame)
    cancelAnimationFrame(tabMeasureAnimationFrame)
    resizeObserver?.disconnect()
    hideWebTabs()
  })

  function setActiveInput(value: string) {
    updateOpenTab(activeID(), { input: value })
  }

  function createTab(input: Partial<OpenTab>) {
    const id = newBrowserID()
    if (activeTab()?.kind === "web") hideWebTabs()
    setTabs((current) => [...current, { ...openTabDefaults(id), ...input }])
    setActiveID(id)
    return id
  }

  function selectSingletonTab(kind: "context" | "git", title: string) {
    const existing = tabs().find((tab) => tab.kind === kind)
    if (existing) {
      if (activeTab()?.kind === "web" && existing.id !== activeID()) hideWebTabs()
      setActiveID(existing.id)
      closeNewTabMenu()
      return existing.id
    }
    const id = createTab({ kind, title })
    closeNewTabMenu()
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
    closeNewTabMenu()
  }

  function addWebTab() {
    createTab({ kind: "web", input: "https://", title: "New webpage" })
    closeNewTabMenu()
    queueMicrotask(() => document.querySelector<HTMLInputElement>(".session-open-location input")?.focus())
  }

  function addTerminalTab() {
    const id = createTab({
      kind: "terminal",
      title: "Terminal",
      directory: activeDirectory(),
      terminalStatus: "connecting",
      text: "",
    })
    openTerminalIDs.delete(id)
    ensureTerminalView(id, writeTerminal)
    closeNewTabMenu()
    void startTerminal(id)
  }

  function closeNewTabMenu() {
    setNewTabMenuOpen(false)
  }

  function updateOpenMenuPlacements() {
    if (newTabMenuOpen()) placePopupMenu(newTabMenu, newTabMenuPanel, setNewTabMenuPlacement)
    if (overflowTabMenuOpen()) {
      placePopupMenu(
        overflowTabMenu,
        overflowTabMenuPanel,
        setOverflowTabMenuPlacement,
        overflowTabs().length > OPEN_PANEL_OVERFLOW_VISIBLE_ROWS
          ? popupMenuRowsMaxHeight(overflowTabMenuPanel, OPEN_PANEL_OVERFLOW_VISIBLE_ROWS) ?? OPEN_PANEL_OVERFLOW_FALLBACK_MAX_HEIGHT
          : undefined,
      )
    }
  }

  function toggleNewTabMenu() {
    const open = !newTabMenuOpen()
    if (open) parkActiveWebTabForChrome()
    if (open) setNewTabMenuPlacement(initialPopupMenuPlacement(newTabMenu))
    setNewTabMenuOpen(open)
    setOverflowTabMenuOpen(false)
    requestAnimationFrame(updateOpenMenuPlacements)
  }

  function toggleOverflowTabMenu() {
    const open = !overflowTabMenuOpen()
    if (open) parkActiveWebTabForChrome()
    if (open) {
      setOverflowTabMenuPlacement(initialPopupMenuPlacement(
        overflowTabMenu,
        overflowTabs().length > OPEN_PANEL_OVERFLOW_VISIBLE_ROWS ? OPEN_PANEL_OVERFLOW_FALLBACK_MAX_HEIGHT : undefined,
      ))
    }
    setOverflowTabMenuOpen(open)
    setNewTabMenuOpen(false)
    requestAnimationFrame(updateOpenMenuPlacements)
  }

  function closeTab(id: string) {
    const current = tabs()
    const index = current.findIndex((tab) => tab.id === id)
    const next = current.filter((tab) => tab.id !== id)
    if (current.find((tab) => tab.id === id)?.kind === "web") {
      hideWebTab(id)
      createdWebIDs.delete(id)
      loadedWebURLByID.delete(id)
      webLoadTokens.delete(id)
      webPreviewTokens.delete(id)
      setWebPreviewByID((previews) => Object.fromEntries(Object.entries(previews).filter(([key]) => key !== id)))
      if (parkedWebTabID() === id) setParkedWebTabID("")
      void window.opencodex?.browser?.destroy(id)
    }
    if (current.find((tab) => tab.id === id)?.kind === "terminal") {
      cancelTerminalRestart(id)
      disposeTerminalView(id)
      void window.opencodex?.terminal?.destroy(id)
    }
    setTabs(next)
    if (activeID() === id) setActiveID(next[Math.min(index, next.length - 1)]?.id ?? next[0]?.id ?? "")
  }

  function reorderOpenTab(sourceID: string, targetID: string, placement: "before" | "after") {
    setTabs((current) => {
      const next = moveRelative(current.map((tab) => tab.id), sourceID, targetID, placement)
      if (next.length === 0) return current
      const byID = new Map(current.map((tab) => [tab.id, tab]))
      return next.map((id) => byID.get(id)).filter((tab): tab is OpenTab => tab !== undefined)
    })
  }

  function clearTabDrag() {
    setDragTabID("")
    setTabDropTarget(undefined)
    setTabDragPreview(undefined)
  }

  function startOpenTabPointerDrag(event: PointerEvent & { currentTarget: HTMLElement }, tab: OpenTab) {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest(".session-open-tab-close"))) return
    const pointerID = event.pointerId
    const origin = { x: event.clientX, y: event.clientY }
    const rect = event.currentTarget.getBoundingClientRect()
    const offset = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    let dragging = false
    let target: { id: string; placement: "before" | "after" } | undefined
    let lastTargetKey = ""

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerID) return
      if (!dragging && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 5) return
      dragging = true
      moveEvent.preventDefault()
      setDragTabID(tab.id)
      setTabDragPlaceholderWidth(rect.width)
      setTabDragPreview({
        id: tab.id,
        x: moveEvent.clientX - offset.x,
        y: moveEvent.clientY - offset.y,
        width: rect.width,
        height: rect.height,
      })
      const nextTarget = openTabDropTargetFromPointer(tab.id, moveEvent.clientX)
      if (!nextTarget) {
        target = undefined
        if (lastTargetKey !== "") {
          setTabDropTarget(undefined)
          lastTargetKey = ""
        }
        return
      }
      target = nextTarget
      const targetKey = `${target.id}:${target.placement}`
      if (targetKey === lastTargetKey) return
      lastTargetKey = targetKey
      setTabDropTarget(target)
    }

    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerID) return
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      if (!dragging) return
      upEvent.preventDefault()
      document.addEventListener("click", suppressNextClick, { capture: true, once: true })
      setTimeout(() => document.removeEventListener("click", suppressNextClick, true), 250)
      if (target) reorderOpenTab(tab.id, target.id, target.placement)
      clearTabDrag()
    }

    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerID) return
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      clearTabDrag()
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
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

  function openFileExplorer() {
    if (activeTab()?.kind === "picker") return
    addFileTab()
  }

  function openFileInActiveTab() {
    const tab = activeTab()
    if (!tab) {
      addFileTab()
      return
    }
    hideWebTabs()
    updateOpenTab(tab.id, { kind: "picker", input: "", title: "Open file", message: "" })
  }

  function closeFileExplorer() {
    const tab = activeTab()
    if (tab?.kind === "picker" && tab.path) {
      updateOpenTab(tab.id, { kind: "file", input: tab.path, title: compactPath(tab.path), message: "" })
      return
    }
    closeTab(activeID())
  }

  async function startTerminal(id: string) {
    if (!window.opencodex?.terminal) {
      ensureTerminalView(id, writeTerminal).terminal.writeln("Open terminal needs the latest desktop bridge. Restart OpencodeX and try again.")
      updateOpenTab(id, { terminalStatus: "error" })
      return
    }
    const tab = tabs().find((tab) => tab.id === id)
    const result = await window.opencodex.terminal.create({ id, cwd: tab?.directory || activeDirectory(), cols: 100, rows: 30 })
    if (!result.ok) {
      ensureTerminalView(id, writeTerminal).terminal.writeln(result.message ?? "Failed to open terminal.")
      updateOpenTab(id, { terminalStatus: "error" })
      return
    }
    fitTerminalView(id)
  }

  function scheduleTerminalRestart(id: string) {
    cancelTerminalRestart(id)
    terminalRestartTimers.set(id, window.setTimeout(() => {
      terminalRestartTimers.delete(id)
      const tab = tabs().find((tab) => tab.id === id)
      if (!tab || tab.kind !== "terminal" || tab.terminalStatus !== "connecting") return
      void startTerminal(id)
    }, 250))
  }

  async function refreshExplorerFiles(path: string) {
    const gui = props.gui
    if (!gui || !activeDirectory()) return
    setFileExplorerBusy(true)
    try {
      const files = await listWorkbenchFiles(gui, path, activeDirectory())
      setFilesByPath((current) => ({ ...current, [path]: files }))
    } finally {
      setFileExplorerBusy(false)
    }
  }

  async function toggleExplorerFolder(file: FileNode) {
    if (expandedFolders().has(file.path)) {
      setExpandedFolders((current) => new Set([...current].filter((path) => path !== file.path)))
      return
    }
    setExpandedFolders((current) => new Set([...current, file.path]))
    if (filesByPath()[file.path] === undefined) await refreshExplorerFiles(file.path)
  }

  async function openExplorerFile(path: string) {
    const target = workbenchPathKey(path)
    if (!target) return
    setFileFilter("")
    if (activeTab()?.kind === "picker") {
      await openFileTab(activeID(), target, undefined, activeDirectory())
      return
    }
    const id = createTab({ input: target, title: compactPath(target), directory: activeDirectory() })
    await openFileTab(id, target, undefined, activeDirectory())
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
      queueMicrotask(() => void navigateWebTab(id, url))
      return
    }
    await openFileTab(id, filePathFromInput(trimmed, activeDirectory()), title, activeDirectory())
  }

  async function openFileTab(id: string, path: string, title?: string, directory = activeDirectory()) {
    const gui = props.gui
    if (!gui) {
      updateOpenTab(id, { kind: "file", path, directory, input: path, title: title || compactPath(path), message: "GUI client is not ready." })
      return
    }
    hideWebTabs()
    updateOpenTab(id, { kind: "file", path, directory, input: path, title: title || compactPath(path), message: "Loading file..." })
    try {
      const content = await readWorkbenchFile(gui, path, directory)
      const text = content?.type === "text" ? content.content : ""
      updateOpenTab(id, {
        kind: "file",
        path,
        directory,
        input: path,
        title: title || compactPath(path),
        content,
        text,
        original: text,
        message: "",
      })
    } catch (cause) {
      updateOpenTab(id, { message: cause instanceof Error ? cause.message : "Failed to open file." })
    }
  }

  async function saveActiveFile() {
    const tab = activeTab()
    const gui = props.gui
    if (!gui || !tab || tab.kind !== "file" || !tab.path || tab.content?.type !== "text") return
    updateOpenTab(tab.id, { message: "Saving file..." })
    try {
      const result = await writeWorkbenchFile(gui, { path: tab.path, content: tab.text, previousContent: tab.original }, tab.directory || activeDirectory())
      if (!result.ok) {
        updateOpenTab(tab.id, { message: result.message ?? "File was not saved." })
        return
      }
      updateOpenTab(tab.id, { original: tab.text, message: result.message ?? "Saved." })
    } catch (cause) {
      updateOpenTab(tab.id, { message: cause instanceof Error ? cause.message : "Failed to save file." })
    }
  }

  async function ensureBrowserView(tab: OpenTab) {
    if (createdWebIDs.has(tab.id)) return true
    const browser = window.opencodex?.browser
    if (!browser) {
      updateOpenTab(tab.id, { message: "Embedded browser is not available." })
      return false
    }
    const next = await browser.create({ id: tab.id }).catch(() => undefined)
    createdWebIDs.add(tab.id)
    if (next) updateOpenTab(tab.id, {
      state: next,
      title: next.title || tab.title,
      input: next.url || tab.input,
      url: next.url || tab.url,
      message: "",
    })
    return true
  }

  async function showWebTab(tab: OpenTab) {
    if (!tab.url || !(await ensureBrowserView(tab))) return
    const current = tabs().find((item) => item.id === tab.id)
    if (!props.active || newTabMenuOpen() || overflowTabMenuOpen() || activeID() !== tab.id || current?.kind !== "web") return
    const url = current.url ?? tab.url
    if (url && loadedWebURLByID.get(tab.id) !== url) await loadWebTabURL(tab.id, url)
    if (!props.active || newTabMenuOpen() || overflowTabMenuOpen() || activeID() !== tab.id) return
    setParkedWebTabID("")
    syncBrowserBounds(tab.id)
    hideWebTabs(tab.id)
  }

  async function loadWebTabURL(id: string, url: string) {
    const browser = window.opencodex?.browser
    if (!browser) {
      updateOpenTab(id, { message: "Embedded browser is not available." })
      return
    }
    const token = (webLoadTokens.get(id) ?? 0) + 1
    webLoadTokens.set(id, token)
    loadedWebURLByID.set(id, url)
    const next = await browser.navigate({ id, url }).catch(() => undefined)
    if (webLoadTokens.get(id) !== token) return
    if (!next) return
    loadedWebURLByID.set(id, next.url || url)
    updateOpenTab(id, {
      state: next,
      title: next.title || inputLabel(next.url || url),
      input: next.url || url,
      url: next.url || url,
      message: "",
    })
    refreshWebPreview(id)
  }

  async function navigateWebTab(id: string, url: string) {
    if (!(await ensureBrowserView(tabs().find((tab) => tab.id === id) ?? openTabDefaults(id)))) return
    await loadWebTabURL(id, url)
    if (activeID() === id && activeTab()?.kind === "web" && !newTabMenuOpen() && !overflowTabMenuOpen()) syncBrowserBounds(id)
  }

  async function browserAction(action: "back" | "forward" | "reload" | "stop") {
    const tab = activeTab()
    if (!tab || tab.kind !== "web") return
    const next = await window.opencodex?.browser?.action({ id: tab.id, action })
    if (next) updateOpenTab(tab.id, { state: next, title: next.title || tab.title, input: next.url || tab.input, url: next.url || tab.url })
    refreshWebPreview(tab.id)
  }

  function parkActiveWebTabForChrome() {
    const tab = activeTab()
    if (!tab || tab.kind !== "web") return
    parkWebTab(tab.id)
  }

  function parkWebTab(id: string) {
    if (parkedWebTabID() !== id) setParkedWebTabID(id)
    hideWebTab(id)
  }

  function syncBrowserBounds(id: string) {
    const browser = window.opencodex?.browser
    if (!host || !browser) return
    const rect = host.getBoundingClientRect()
    const x = Math.round(rect.x)
    const y = Math.round(rect.y)
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    const nextBoundsKey = `${id}:${x}:${y}:${width}:${height}`
    if (visibleWebTabID === id && lastBrowserBoundsKey === nextBoundsKey) return
    visibleWebTabID = id
    lastBrowserBoundsKey = nextBoundsKey
    void browser.bounds({ id, x, y, width, height }).then((next) => {
      const tab = tabs().find((item) => item.id === id)
      if (!next || !tab || tab.kind !== "web") return
      updateOpenTab(id, {
        state: next,
        title: next.title || tab.title,
        input: next.url || tab.input,
        url: next.url || tab.url,
      })
    })
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        const tab = activeTab()
        if (!props.active || !tab || tab.kind !== "web" || newTabMenuOpen() || overflowTabMenuOpen()) return
        syncBrowserBounds(tab.id)
      })
      resizeObserver.observe(host)
    }
  }

  function refreshWebPreview(id: string) {
    const browser = window.opencodex?.browser
    if (!browser) return
    const token = (webPreviewTokens.get(id) ?? 0) + 1
    webPreviewTokens.set(id, token)
    window.setTimeout(() => {
      void browser.screenshot(id).catch(() => undefined).then((screenshot) => {
        if (!screenshot || webPreviewTokens.get(id) !== token || !tabs().some((tab) => tab.id === id)) return
        setWebPreviewByID((current) => ({ ...current, [id]: screenshot }))
      })
    }, 180)
  }

  function hideWebTab(id: string) {
    if (visibleWebTabID === id) {
      visibleWebTabID = ""
      lastBrowserBoundsKey = ""
    }
    void window.opencodex?.browser?.hide(id)
  }

  function hideWebTabs(exceptID = "") {
    tabs().filter((tab) => tab.kind === "web" && tab.id !== exceptID).forEach((tab) => hideWebTab(tab.id))
  }

  function writeTerminal(id: string, data: string) {
    void window.opencodex?.terminal?.write({ id, data })
  }

  function updateOpenTab(id: string, patch: Partial<OpenTab>) {
    setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, ...patch } : tab))
  }

  function scheduleOpenTabMeasure() {
    cancelAnimationFrame(tabMeasureAnimationFrame)
    tabMeasureAnimationFrame = requestAnimationFrame(measureOpenTabBar)
  }

  function measureOpenTabBar() {
    setTabBarWidth(tabBar?.clientWidth ?? 0)
    updateOpenMenuPlacements()
    if (!tabBar || !tabMeasure) return
    const style = getComputedStyle(tabBar)
    setTabMeasurements({
      tabs: Object.fromEntries(
        Array.from(tabMeasure.querySelectorAll<HTMLElement>("[data-open-tab-measure-id]"))
          .map((element) => [element.dataset.openTabMeasureId, Math.ceil(element.getBoundingClientRect().width)] as const)
          .filter((entry): entry is readonly [string, number] => entry[0] !== undefined),
      ),
      overflow: Object.fromEntries(
        Array.from(tabMeasure.querySelectorAll<HTMLElement>("[data-open-tab-measure-overflow-count]"))
          .map((element) => [Number(element.dataset.openTabMeasureOverflowCount), Math.ceil(element.getBoundingClientRect().width)] as const)
          .filter((entry): entry is readonly [number, number] => Number.isFinite(entry[0])),
      ),
      newTab: Math.ceil(tabMeasure.querySelector<HTMLElement>("[data-open-tab-measure-control='new']")?.getBoundingClientRect().width ?? OPEN_TAB_LAYOUT_FALLBACK_MEASUREMENTS.newTab),
      padding: cssPixelValue(style.paddingLeft) + cssPixelValue(style.paddingRight),
      gap: cssPixelValue(style.columnGap) || cssPixelValue(style.gap),
    })
  }

  function openPanelTabLabel(tab: OpenTab) {
    return tabLabels()[tab.id] ?? openTabLabel(tab)
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
      <Show when={tabs().length > 0}>
        <div class="session-open-chrome">
          <div class="session-open-tabs" ref={(element) => { tabBar = element }}>
            <For each={openTabRows()}>
              {(row) => row.type === "placeholder" ? (
                <div class="session-open-tab-placeholder" data-open-tab-row-id="placeholder" style={{ width: `${row.width}px` }} />
              ) : (
                <button
                  type="button"
                  class="session-open-tab-button"
                  role="tab"
                  data-open-tab-id={row.tab.id}
                  data-open-tab-row-id={row.tab.id}
                  aria-selected={activeID() === row.tab.id}
                  classList={{ active: activeID() === row.tab.id, dragging: dragTabID() === row.tab.id }}
                  onPointerDown={(event) => {
                    if (activeTab()?.kind === "web" && row.tab.id !== activeID()) hideWebTabs()
                    startOpenTabPointerDrag(event, row.tab)
                  }}
                  onClick={() => setActiveID(row.tab.id)}
                >
                  <Icon name={openTabIcon(row.tab)} />
                  <span>{openPanelTabLabel(row.tab)}</span>
                  <span
                    class="session-open-tab-close"
                    role="button"
                    tabIndex={0}
                    aria-label={`Close ${openPanelTabLabel(row.tab)}`}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      if (row.tab.kind === "web") hideWebTabs()
                    }}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      closeTab(row.tab.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return
                      event.preventDefault()
                      event.stopPropagation()
                      closeTab(row.tab.id)
                    }}
                  >
                    <Icon name="x" />
                  </span>
                </button>
              )}
            </For>
            <Show when={overflowTabs().length > 0}>
              <div class="session-open-overflow-tab-menu">
                <button
                  type="button"
                  class="session-open-menu-trigger session-open-overflow-trigger"
                  ref={(element) => { overflowTabMenu = element }}
                  aria-label={`${overflowTabs().length} hidden tabs`}
                  title="Open tabs"
                  aria-expanded={overflowTabMenuOpen()}
                  onClick={toggleOverflowTabMenu}
                >
                  <Icon name="more" />
                  <span>{overflowTabs().length} tabs</span>
                </button>
              </div>
              <Show when={overflowTabMenuOpen()}>
                <Portal>
                  <div
                    class="session-open-popup-menu session-open-overflow-tab-panel"
                    classList={{ scrollable: overflowTabs().length > OPEN_PANEL_OVERFLOW_VISIBLE_ROWS }}
                    ref={(element) => {
                      overflowTabMenuPanel = element
                      requestAnimationFrame(updateOpenMenuPlacements)
                    }}
                    style={popupMenuStyle(overflowTabMenuPlacement())}
                  >
                    <For each={overflowTabs()}>
                      {(item) => (
                        <button
                          type="button"
                          classList={{ active: activeID() === item.id }}
                          onClick={() => {
                            if (activeTab()?.kind === "web" && item.id !== activeID()) hideWebTabs()
                            setActiveID(item.id)
                            setOverflowTabMenuOpen(false)
                          }}
                        >
                          <Icon name={openTabIcon(item)} />
                          <span>{openPanelTabLabel(item)}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </Portal>
              </Show>
            </Show>
            <div class="session-open-new-tab-menu">
              <button
                type="button"
                class="session-open-menu-trigger"
                ref={(element) => { newTabMenu = element }}
                aria-label="New tab"
                title="New tab"
                aria-expanded={newTabMenuOpen()}
                onClick={toggleNewTabMenu}
              >
                <Icon name="plus" />
              </button>
            </div>
            <Show when={newTabMenuOpen()}>
              <Portal>
                <div
                  class="session-open-popup-menu session-open-new-tab-panel"
                  ref={(element) => {
                    newTabMenuPanel = element
                    requestAnimationFrame(updateOpenMenuPlacements)
                  }}
                  style={popupMenuStyle(newTabMenuPlacement())}
                >
                  <button type="button" onClick={addGitTab}><Icon name="branch" /><span>Git</span></button>
                  <button type="button" onClick={addFileTab}><Icon name="file" /><span>New file</span></button>
                  <button type="button" onClick={addTerminalTab}><Icon name="terminal" /><span>New Terminal</span></button>
                  <button type="button" onClick={addContextTab}><Icon name="context" /><span>Context</span></button>
                  <button type="button" onClick={addWebTab}><Icon name="browser" /><span>New Webpage</span></button>
                </div>
              </Portal>
            </Show>
            <OpenTabDragPreviewView preview={tabDragPreview()} tab={previewTab()} label={previewLabel()} />
            <div class="session-open-tab-measure" ref={(element) => { tabMeasure = element }} aria-hidden="true">
              <For each={tabs()}>
                {(tab) => (
                  <button type="button" class="session-open-tab-button" data-open-tab-measure-id={tab.id} tabIndex={-1}>
                    <Icon name={openTabIcon(tab)} />
                    <span>{openPanelTabLabel(tab)}</span>
                    <span class="session-open-tab-close"><Icon name="x" /></span>
                  </button>
                )}
              </For>
              <For each={tabs().map((_, index) => index + 1)}>
                {(count) => (
                  <button type="button" class="session-open-menu-trigger session-open-overflow-trigger" data-open-tab-measure-overflow-count={count} tabIndex={-1}>
                    <Icon name="more" />
                    <span>{count} tabs</span>
                  </button>
                )}
              </For>
              <button type="button" class="session-open-menu-trigger" data-open-tab-measure-control="new" tabIndex={-1}>
                <Icon name="plus" />
              </button>
            </div>
          </div>
          <Show when={activeTab()?.kind === "web"}>
            <div class="session-open-bar">
              <IconButton icon="chevronLeft" label="Back" disabled={!activeTab()?.state?.canGoBack} onClick={() => void browserAction("back")} />
              <IconButton icon="chevronRight" label="Forward" disabled={!activeTab()?.state?.canGoForward} onClick={() => void browserAction("forward")} />
              <IconButton icon={activeTab()?.state?.loading ? "stop" : "refresh"} label={activeTab()?.state?.loading ? "Stop loading" : "Refresh"} onClick={() => void browserAction(activeTab()?.state?.loading ? "stop" : "reload")} />
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
                <IconButton icon="folder-open" label="Open another file in this tab" onClick={openFileInActiveTab} />
                <IconButton icon="save" label="Save file" disabled={!dirty()} onClick={() => void saveActiveFile()} />
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
              <label class="session-side-context-select">
                <span>Session</span>
                <select value={props.selectedContextID ?? props.sessionID} onChange={(event) => props.selectContext?.(event.currentTarget.value)}>
                  <For each={props.contextOptions ?? []}>
                    {(option) => <option value={option.id}>{option.label}</option>}
                  </For>
                </select>
              </label>
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
          <SessionOpenFileExplorer
            directory={activeDirectory()}
            filter={fileFilter()}
            setFilter={setFileFilter}
            searchState={fileSearchState()}
            matches={fileMatches()}
            rows={fileTreeRows()}
            loading={fileExplorerBusy()}
            openPath={activeTab()?.path ?? ""}
            toggleFolder={(file) => void toggleExplorerFolder(file)}
            openFile={(path) => void openExplorerFile(path)}
            close={closeFileExplorer}
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
          <CodeEditor
            path={activeTab()?.path ?? ""}
            value={activeTab()?.text ?? ""}
            original={activeTab()?.original ?? ""}
            onChange={(value) => activeTab() && updateOpenTab(activeTab()!.id, { text: value })}
            onSave={() => void saveActiveFile()}
          />
        </Match>
        <Match when={activeTab()?.kind === "web"}>
          <div class="session-side-browser-host" ref={(element) => { host = element }}>
            <Show when={activeWebPreview()}>
              {(src) => <img class="session-side-browser-preview" src={src()} alt="" />}
            </Show>
            <Show when={parkedWebTabID() === activeTab()?.id && !activeWebPreview()}>
              <div class="session-side-browser-preview empty" aria-hidden="true" />
            </Show>
          </div>
        </Match>
        <Match when={activeTab()?.kind === "terminal"}>
          <SessionOpenTerminal tab={activeTab()!} write={writeTerminal} />
        </Match>
        <Match when={true}>
          <SessionOpenEmptyState directory={props.directory} openContext={addContextTab} openGit={addGitTab} openFile={openFileExplorer} openTerminal={addTerminalTab} addWebTab={addWebTab} />
        </Match>
      </Switch>
    </section>
  )
}

function placePopupMenu(anchor: HTMLElement | undefined, panel: HTMLElement | undefined, setPlacement: (placement: PopupMenuPlacement) => void, maxHeight?: number) {
  if (!anchor || !panel) return
  const gap = 8
  const viewportWidth = document.documentElement.clientWidth
  const viewportHeight = document.documentElement.clientHeight
  const summaryRect = anchor.getBoundingClientRect()
  const panelWidth = Math.min(panel.offsetWidth || 224, viewportWidth - gap * 2)
  const contentHeight = Math.min(panel.scrollHeight || panel.offsetHeight || 40, maxHeight ?? Number.POSITIVE_INFINITY)
  const availableBelow = viewportHeight - summaryRect.bottom - gap
  const availableAbove = summaryRect.top - gap
  const openAbove = availableBelow < contentHeight && availableAbove > availableBelow
  const availableHeight = Math.max(40, openAbove ? availableAbove : availableBelow)
  const panelHeight = Math.min(contentHeight, availableHeight)
  const preferredLeft = summaryRect.left + panelWidth > viewportWidth - gap ? summaryRect.right - panelWidth : summaryRect.left
  const left = Math.max(gap, Math.min(preferredLeft, viewportWidth - panelWidth - gap))
  const top = openAbove
    ? Math.max(gap, summaryRect.top - panelHeight - gap)
    : Math.min(summaryRect.bottom + gap, viewportHeight - panelHeight - gap)
  setPlacement({
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(panelWidth),
    maxHeight: Math.round(panelHeight),
  })
}

function popupMenuRowsMaxHeight(panel: HTMLElement | undefined, rows: number) {
  if (!panel) return
  const items = Array.from(panel.querySelectorAll<HTMLElement>("button")).slice(0, rows)
  if (items.length === 0) return
  const style = getComputedStyle(panel)
  return cssPixelValue(style.paddingTop)
    + cssPixelValue(style.paddingBottom)
    + items.reduce((total, item) => total + Math.ceil(item.getBoundingClientRect().height), 0)
    + Math.max(0, items.length - 1) * cssPixelValue(style.rowGap)
}

function initialPopupMenuPlacement(anchor?: HTMLElement, maxHeight = 320): PopupMenuPlacement {
  const gap = 8
  const panelWidth = 224
  const rect = anchor?.getBoundingClientRect()
  if (!rect) return { left: gap, top: gap, width: panelWidth, maxHeight }
  const viewportWidth = document.documentElement.clientWidth
  return {
    left: Math.max(gap, Math.min(rect.right - panelWidth, viewportWidth - panelWidth - gap)),
    top: Math.round(rect.bottom + gap),
    width: panelWidth,
    maxHeight,
  }
}

function popupMenuStyle(placement?: PopupMenuPlacement) {
  return placement
    ? {
      left: `${placement.left}px`,
      top: `${placement.top}px`,
      width: `${placement.width}px`,
      "max-height": `${placement.maxHeight}px`,
    }
    : undefined
}

function openTabDropTargetFromPointer(sourceID: string, clientX: number) {
  const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-open-tab-id]"))
    .filter((element) => element.dataset.openTabId !== sourceID)
  if (elements.length === 0) return
  for (const element of elements) {
    const rect = element.getBoundingClientRect()
    const id = element.dataset.openTabId
    if (!id) continue
    if (clientX < rect.left + rect.width / 2) return { id, placement: "before" as const }
  }
  const last = elements.at(-1)
  const id = last?.dataset.openTabId
  return id ? { id, placement: "after" as const } : undefined
}

function animateOpenTabRows(previous: Map<string, DOMRect>, enabled: boolean) {
  const next = new Map<string, DOMRect>()
  for (const element of document.querySelectorAll<HTMLElement>("[data-open-tab-row-id]")) {
    const key = element.dataset.openTabRowId
    if (!key) continue
    const animations = element.getAnimations()
    const animatedRect = enabled && animations.length > 0 ? element.getBoundingClientRect() : undefined
    animations.forEach((animation) => animation.cancel())
    const rect = element.getBoundingClientRect()
    next.set(key, rect)
    const before = animatedRect ?? previous.get(key)
    if (!enabled || !before) continue
    const deltaX = before.left - rect.left
    if (Math.abs(deltaX) < 1) continue
    element.animate([
      { transform: `translateX(${deltaX}px)` },
      { transform: "translateX(0)" },
    ], {
      duration: 180,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    })
  }
  return next
}

function openTabRowKey(row: OpenTabRow) {
  return row.type === "tab" ? row.tab.id : "placeholder"
}

function suppressNextClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

function OpenTabDragPreviewView(props: { preview?: OpenTabDragPreview; tab?: OpenTab; label?: string }) {
  return (
    <Show when={props.preview && props.tab}>
      <Portal>
        <div
          class="session-open-tab-drag-preview"
          style={{
            left: `${props.preview?.x ?? 0}px`,
            top: `${props.preview?.y ?? 0}px`,
            width: `${props.preview?.width ?? 168}px`,
            height: `${props.preview?.height ?? 32}px`,
          }}
        >
          <Icon name={openTabIcon(props.tab!)} />
          <span>{props.label ?? openTabLabel(props.tab!)}</span>
        </div>
      </Portal>
    </Show>
  )
}

function SessionOpenFileExplorer(props: {
  directory: string
  filter: string
  setFilter: (value: string) => void
  searchState: "idle" | "loading" | "error"
  matches: FileNode[]
  rows: WorkbenchTreeRow[]
  loading: boolean
  openPath: string
  toggleFolder: (node: FileNode) => void
  openFile: (path: string) => void
  close: () => void
}) {
  return (
    <section class="session-open-file-explorer" aria-label="Workspace files">
      <header>
        <div>
          <strong>Workspace files</strong>
          <span>{props.directory ? compactPath(props.directory) : "No project folder selected"}</span>
        </div>
        <button type="button" aria-label="Close file explorer" onClick={props.close}><Icon name="x" /></button>
      </header>
      <div class="workbench-filter">
        <Icon name="search" />
        <input value={props.filter} placeholder="Filter files" onInput={(event) => props.setFilter(event.currentTarget.value)} />
        <Show when={props.filter}>
          <button type="button" aria-label="Clear file filter" onClick={() => props.setFilter("")}><Icon name="x" /></button>
        </Show>
      </div>
      <Show when={props.filter.trim().length >= 2}>
        <div class="workbench-search-results">
          <header>
            <span>Project matches</span>
            <small>{props.searchState === "loading" ? "Searching..." : props.searchState === "error" ? "Search failed" : `${props.matches.length} found`}</small>
          </header>
          <For each={props.matches} fallback={<div class="empty">{props.searchState === "loading" ? "Searching project..." : "No project matches."}</div>}>
            {(match) => (
              <button
                type="button"
                class="workbench-search-row"
                classList={{ selected: props.openPath === match.path, directory: match.type === "directory" }}
                onClick={() => match.type === "directory" ? props.toggleFolder(match) : props.openFile(match.path)}
              >
                <Icon name={match.type === "directory" ? "folder" : "file"} />
                <span>{match.path}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="workbench-tree" role="tree">
        <For each={props.rows} fallback={<div class="empty">{props.loading ? "Loading files..." : "No files found."}</div>}>
          {(row) => (
            <button
              type="button"
              class="workbench-file-row"
              classList={{ selected: props.openPath === row.node.path, directory: row.node.type === "directory", expanded: row.expanded, root: row.depth === 0 }}
              style={{ "--depth": String(row.depth), "--depth-lines": row.depth === 0 ? "0" : "1" }}
              role="treeitem"
              aria-expanded={row.node.type === "directory" ? row.expanded : undefined}
              onClick={() => row.node.type === "directory" ? props.toggleFolder(row.node) : props.openFile(row.node.path)}
            >
              <Show when={row.node.type === "directory"} fallback={<span class="workbench-tree-spacer" />}>
                <span class="workbench-disclosure"><Icon name={row.expanded ? "chevronDown" : "chevronRight"} /></span>
              </Show>
              <Icon name={row.node.type === "directory" ? row.expanded ? "folder-open" : "folder" : "file"} />
              <span>{row.node.name}</span>
              <Show when={row.node.type === "directory" && row.expanded && !row.loaded}>
                <span class="workbench-loading">...</span>
              </Show>
            </button>
          )}
        </For>
      </div>
    </section>
  )
}

function SessionOpenTerminal(props: { tab: OpenTab; write: (id: string, data: string) => void }) {
  let host: HTMLDivElement | undefined

  createEffect(() => {
    const id = props.tab.id
    if (!host) return
    const detach = attachTerminalView(id, host, props.write)
    onCleanup(detach)
  })

  createEffect(() => {
    props.tab.terminalStatus
    queueMicrotask(() => {
      fitTerminalView(props.tab.id)
    })
  })

  return (
    <div class="session-open-terminal">
      <header>
        <span><Icon name="terminal" /> {props.tab.directory ? compactPath(props.tab.directory) : "Terminal"}</span>
        <small>{props.tab.terminalStatus === "closed" ? "closed" : props.tab.terminalStatus === "connecting" ? "connecting" : "interactive"}</small>
      </header>
      <div class="session-open-terminal-host" ref={(element) => { host = element }} />
    </div>
  )
}

let detachedTerminalDock: HTMLDivElement | undefined

function terminalDock() {
  if (detachedTerminalDock) return detachedTerminalDock
  detachedTerminalDock = document.createElement("div")
  detachedTerminalDock.style.display = "none"
  document.body.append(detachedTerminalDock)
  return detachedTerminalDock
}

function ensureTerminalView(id: string, write: (id: string, data: string) => void) {
  const existing = terminalViews.get(id)
  if (existing) return existing
  const terminal = new Terminal({
    cursorBlink: true,
    customGlyphs: true,
    letterSpacing: 0,
    scrollback: 10_000,
    fontFamily: '"Cascadia Mono", "Cascadia Code", "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1,
    theme: {
      background: "#05070a",
      foreground: "#d6deeb",
      cursor: "#67e8f9",
      selectionBackground: "#264f78",
      black: "#1f2937",
      red: "#f87171",
      green: "#34d399",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#e5e7eb",
      brightBlack: "#6b7280",
      brightRed: "#fb7185",
      brightGreen: "#4ade80",
      brightYellow: "#fde047",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#f8fafc",
    },
  })
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  const input = terminal.onData((data) => write(id, data))
  const resize = terminal.onResize((size) => {
    void window.opencodex?.terminal?.resize({ id, cols: size.cols, rows: size.rows })
  })
  const view: TerminalView = {
    terminal,
    fit,
    disposeInput: () => {
      input.dispose()
      resize.dispose()
    },
  }
  terminalViews.set(id, view)
  return view
}

function attachTerminalView(id: string, host: HTMLElement, write: (id: string, data: string) => void) {
  const view = ensureTerminalView(id, write)
  if (view.terminal.element) host.append(view.terminal.element)
  else view.terminal.open(host)
  view.resizeObserver?.disconnect()
  view.resizeObserver = new ResizeObserver(() => fitTerminalView(id))
  view.resizeObserver.observe(host)
  queueMicrotask(() => {
    fitTerminalView(id)
    view.terminal.focus()
  })
  return () => {
    view.resizeObserver?.disconnect()
    view.resizeObserver = undefined
    if (view.terminal.element?.parentElement === host) terminalDock().append(view.terminal.element)
  }
}

function fitTerminalView(id: string) {
  const view = terminalViews.get(id)
  if (!view?.terminal.element?.isConnected) return
  try {
    view.fit.fit()
  } catch {
    return
  }
}

function disposeTerminalView(id: string) {
  const view = terminalViews.get(id)
  if (!view) return
  cancelTerminalRestart(id)
  openTerminalIDs.delete(id)
  view.resizeObserver?.disconnect()
  view.disposeInput()
  view.terminal.dispose()
  terminalViews.delete(id)
}

function SessionOpenEmptyState(props: { directory?: string; openContext: () => void; openGit: () => void; openFile: () => void; openTerminal: () => void; addWebTab: () => void }) {
  return (
    <div class="session-open-empty">
      <div class="session-open-empty-intro">
        <div class="session-open-empty-mark">
          <Icon name="browser" />
          <Icon name="branch" />
        </div>
        <div>
          <strong>Open a workspace tab</strong>
          <span>{props.directory ? compactPath(props.directory) : "No project folder selected"}</span>
        </div>
      </div>
      <div class="session-open-empty-actions">
        <button type="button" data-tone="git" onClick={props.openGit}>
          <Icon name="branch" />
          <strong>Git</strong>
          <span>Review working tree changes and prepare a commit.</span>
        </button>
        <button type="button" data-tone="file" onClick={props.openFile}>
          <Icon name="folder-open" />
          <strong>Open file</strong>
          <span>Browse the project and edit source files in place.</span>
        </button>
        <button type="button" data-tone="terminal" onClick={props.openTerminal}>
          <Icon name="terminal" />
          <strong>Terminal</strong>
          <span>Run commands from {props.directory ? compactPath(props.directory) : "the workspace"}.</span>
        </button>
        <button type="button" data-tone="context" onClick={props.openContext}>
          <Icon name="context" />
          <strong>Context</strong>
          <span>Inspect session state, tools, LSP, and related metadata.</span>
        </button>
        <button type="button" data-tone="web" onClick={props.addWebTab}>
          <Icon name="browser" />
          <strong>Webpage</strong>
          <span>Open docs, local apps, or URLs beside the session.</span>
        </button>
      </div>
    </div>
  )
}

function openTabDefaults(id: string): OpenTab {
  return { id, kind: "picker", input: "", title: "New tab", text: "", original: "" }
}

function restoreOpenPanelState(sessionID: string) {
  const state = openPanelStateBySession.get(sessionID)
  if (!state) return { tabs: [], activeID: "" }
  return {
    tabs: state.tabs,
    activeID: state.tabs.some((tab) => tab.id === state.activeID) ? state.activeID : state.tabs[0]?.id ?? "",
  }
}

function saveOpenPanelState(sessionID: string, tabs: OpenTab[], activeID: string) {
  openPanelStateBySession.set(sessionID, {
    tabs,
    activeID: tabs.some((tab) => tab.id === activeID) ? activeID : tabs[0]?.id ?? "",
  })
}

function cssPixelValue(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function openTabLabel(tab: OpenTab) {
  if (tab.kind === "context") return "Context"
  if (tab.kind === "file" && tab.path) return compactPath(tab.path)
  if (tab.kind === "git") return "Git"
  if (tab.kind === "picker") return "Open file"
  if (tab.kind === "terminal") return tab.title || "Terminal"
  if (tab.kind === "web") return tab.state?.title || tab.title || tab.url || "Web"
  return tab.title || "New tab"
}

function openTabIcon(tab: OpenTab) {
  if (tab.kind === "context") return "context"
  if (tab.kind === "file" || tab.kind === "picker") return "file"
  if (tab.kind === "git") return "branch"
  if (tab.kind === "terminal") return "terminal"
  return "browser"
}

function isBrowserInput(value: string) {
  const input = value.trim()
  if (/^file:/i.test(input)) return false
  if (/^(https?|about):/i.test(input)) return true
  if (/^localhost(?::\d+)?(?:\/.*)?$/i.test(input)) return true
  if (/^(?:127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/.*)?$/i.test(input)) return true
  if (/^\[::1\](?::\d+)?(?:\/.*)?$/i.test(input)) return true
  if (isFileInput(input)) return false
  if (/^[^\s/]+\.[^\s/]+(?:\/.*)?$/i.test(input)) return true
  return /^[^\s]+:\d+(?:\/.*)?$/i.test(input)
}

function isFileInput(value: string) {
  if (/^\.{1,2}(?:\/|\\)/.test(value)) return true
  if (/^(?:[a-z]:)?[\\/]/i.test(value)) return true
  if (/^[a-z]:[\\/]/i.test(value)) return true
  if (value.includes("\\") || value.includes("/")) {
    const first = value.split(/[\\/]/)[0] ?? ""
    return !/^[^\s.]+\.[^\s.]+$/.test(first)
  }
  if (/\.(?:astro|bash|c|cc|cjs|cpp|cs|css|env|fish|go|gql|graphql|h|hpp|html?|java|json|jsonc|jsx|kt|less|lock|log|md|mdx|mjs|php|ps1|py|rb|rs|sass|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|ya?ml|zsh)$/i.test(value)) return true
  return /^(?:bunfig|dockerfile|eslint|makefile|package|pnpm-lock|prettier|tsconfig|vite|vitest|yarn)(?:\.[\w.-]+)?$/i.test(value)
}

function inputLabel(value: string, directory = "") {
  if (!value.trim()) return "New tab"
  if (!isBrowserInput(value)) return compactPath(filePathFromInput(value, directory))
  try {
    const url = new URL(workbenchNormalizeBrowserURL(value))
    return url.hostname || url.toString()
  } catch {
    return value
  }
}

function webLocationValue(value: string) {
  return value.replace(/^https:\/\//i, "")
}

function filePathFromInput(value: string, directory = "") {
  const decoded = normalizeFilePath(value)
  const root = normalizeRoot(directory)
  if (root && isWithinRoot(decoded, root)) return decoded.slice(root.length + 1)
  return decoded.replace(/^\.\/+/, "")
}

function normalizeFilePath(value: string) {
  return safeDecodeURIComponent(value.replace(/^file:\/+/i, "")).replaceAll("\\", "/").replace(/\/+$/, "")
}

function normalizeRoot(value: string) {
  return value.replaceAll("\\", "/").replace(/\/+$/, "")
}

function isWithinRoot(path: string, root: string) {
  return path.toLowerCase().startsWith(`${root.toLowerCase()}/`)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeDiffs(files: DiffFile[]) {
  return files.flatMap((file) => file.file
    ? [{
      file: file.file,
      patch: file.patch,
      additions: file.additions,
      deletions: file.deletions,
      status: file.status ?? "modified",
    }]
    : [])
}

function diffFileForPath(files: DiffFile[], path: string) {
  const key = sidePanelPathKey(path)
  return files.find((file) => sidePanelPathKey(file.file ?? "") === key)
    ?? files.find((file) => {
      const fileKey = sidePanelPathKey(file.file ?? "")
      return key.endsWith(`/${fileKey}`) || fileKey.endsWith(`/${key}`)
    })
}

function sidePanelPathKey(value: string) {
  return normalizeFilePath(value).replace(/^\.\/+/, "").toLowerCase()
}

function isNonGitMessage(message: string | undefined) {
  return message?.toLowerCase().includes("not a git repository") || message?.toLowerCase().includes("not a git repo")
}

async function projectFilesAsAddedDiffs(gui: GuiClient, directory: string | undefined) {
  const paths = await listProjectFilePaths(gui, directory)
  return (await Promise.all(paths.map(async (path): Promise<DiffFile> => {
    const content = await readWorkbenchFile(gui, path, directory)
    if (content?.type !== "text") return {
      file: path,
      additions: 0,
      deletions: 0,
      status: "added",
    }
    const lines = content.content.split(/\r?\n/)
    return {
      file: path,
      patch: addedFilePatch(path, lines),
      additions: content.content.length === 0 ? 0 : lines.length,
      deletions: 0,
      status: "added",
    }
  }))).toSorted((left, right) => (left.file ?? "").localeCompare(right.file ?? ""))
}

async function listProjectFilePaths(gui: GuiClient, directory: string | undefined, path = ""): Promise<string[]> {
  const entries = await listWorkbenchFiles(gui, path, directory)
  return (await Promise.all(entries.map((entry) => projectFilePathsForEntry(gui, directory, entry)))).flat()
}

function projectFilePathsForEntry(gui: GuiClient, directory: string | undefined, entry: FileNode) {
  if (entry.type === "file") return Promise.resolve(entry.path ? [entry.path] : [])
  if (entry.type === "directory" && entry.path) return listProjectFilePaths(gui, directory, entry.path)
  return Promise.resolve([])
}

function addedFilePatch(path: string, lines: string[]) {
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n")
}

function readContextCollapseState(): Record<string, boolean> {
  if (typeof localStorage === "undefined") return {}
  try {
    const parsed = JSON.parse(localStorage.getItem("opencodex.gui.sessionSidePanel.context") ?? "{}")
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"))
  } catch {
    return {}
  }
}

function writeContextCollapseState(value: Record<string, boolean>) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem("opencodex.gui.sessionSidePanel.context", JSON.stringify(value))
}

import type { FileContent, FileNode, Provider, Session } from "@opencode-ai/sdk/v2/client"
import type { WorkbenchBrowserTabState } from "../lib/workbench"
import { File as FileDiffView } from "@opencode-ai/ui/file"
import { For, Match, Show, Switch, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import type { GuiClient } from "../lib/client"
import type { DiffFile, GuiSnapshot, SessionData, WorkbenchDataResult, WorkbenchGitBranches, WorkbenchGitStatus } from "../lib/store"
import { listWorkbenchFiles, readWorkbenchFile, workbenchGitBranches, workbenchGitDiff, workbenchGitOperation, workbenchGitStatus, writeWorkbenchFile } from "../lib/store"
import { isWorkbenchImageContent, workbenchBufferDirty, workbenchNormalizeBrowserURL } from "../lib/workbench"
import { patchContents } from "../lib/tool-display"
import { compactPath } from "../lib/format"
import { buildDiffFileTree, expandedDirectories, flattenDiffFileTree } from "../lib/diff-file-tree"
import { newBrowserID } from "./workbench-page-helpers"
import { CodeEditor } from "./code-editor"
import { Icon } from "./icon"
import { Button, IconButton, TextArea, TextInput } from "./ui"
import { SessionContextPanel, sessionInspectorModel } from "./session-inspector"
import { ModalFrame } from "./modal-frame"

export type SessionSidePanelTab = "context" | "git" | "open"

export type SessionSidePanelTarget =
  | { tab: "context" | "git" }
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
  kind: "blank" | "file" | "web"
  path?: string
  directory?: string
  url?: string
  state?: WorkbenchBrowserTabState
  content?: FileContent
  text: string
  original: string
  message?: string
}

const OPEN_PANEL_EDIT_LIMIT = 750_000
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
const [sidePanelGitCacheVersions, setSidePanelGitCacheVersions] = createSignal<Record<string, number>>({})

export function SessionSidePanel(props: {
  open: boolean
  widthRatio: number
  session: Session
  data: SessionData
  providers: Provider[]
  mcp: GuiSnapshot["mcp"]
  lsp: GuiSnapshot["lsp"]
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
  const [tab, setTab] = createSignal<SessionSidePanelTab>("git")
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
    const request = props.request
    if (!request?.token) return
    setTab(request.tab)
  })

  createEffect(() => {
    if (!props.open || tab() !== "git") return
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
        <div class="session-side-tabs" role="tablist" aria-label="Side panel tabs">
          <SideTab id="context" tab={tab()} setTab={setTab} icon="panel" label="Context" />
          <SideTab id="git" tab={tab()} setTab={setTab} icon="branch" label="Git" />
          <SideTab id="open" tab={tab()} setTab={setTab} icon="browser" label="Open" />
          <Show when={(props.contextOptions?.length ?? 0) > 1}>
            <label class="session-side-context-select">
              <span>Session</span>
              <select value={props.selectedContextID ?? props.session.id} onChange={(event) => props.selectContext?.(event.currentTarget.value)}>
                <For each={props.contextOptions ?? []}>
                  {(option) => <option value={option.id}>{option.label}</option>}
                </For>
              </select>
            </label>
          </Show>
          <IconButton class="session-side-close" icon="x" label="Close side panel" onClick={props.close} />
        </div>
        <Switch>
          <Match when={tab() === "context"}>
            <div class="session-side-context">
              <SessionContextPanel
                model={contextModel()}
                lsp={props.lsp ?? []}
                lspEnabled={props.config?.lsp === undefined ? undefined : props.config.lsp !== false}
                diffs={props.data.diffs}
                collapsed={collapsed()}
                toggle={toggleContext}
              />
            </div>
          </Match>
          <Match when={tab() === "git"}>
            <SessionSideDiffPanel
              title="Working Tree"
              empty={gitMessage() || "No project changes."}
              loading={gitResult.loading}
              files={gitFiles()}
              openCommitModal={() => setCommitModalOpen(true)}
            />
          </Match>
          <Match when={tab() === "open"}>
            <SessionSideOpenPanel
              active={props.open && tab() === "open"}
              gui={props.gui}
              directory={props.directory ?? props.session.directory}
              request={props.request?.tab === "open" ? props.request : undefined}
            />
          </Match>
        </Switch>
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

function SideTab(props: {
  id: SessionSidePanelTab
  tab: SessionSidePanelTab
  setTab: (tab: SessionSidePanelTab) => void
  icon: string
  label: string
}) {
  return (
    <button type="button" role="tab" aria-selected={props.tab === props.id} classList={{ active: props.tab === props.id }} onClick={() => props.setTab(props.id)}>
      <Icon name={props.icon} />
      <span>{props.label}</span>
    </button>
  )
}

function SessionSideDiffPanel(props: {
  title: string
  empty: string
  loading: boolean
  files: DiffFile[]
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
  active: boolean
  gui?: GuiClient
  directory?: string
  request?: { token: number; value?: string; title?: string }
}) {
  const firstID = newBrowserID()
  const [tabs, setTabs] = createSignal<OpenTab[]>([blankOpenTab(firstID)])
  const [activeID, setActiveID] = createSignal(firstID)
  const activeTab = createMemo(() => tabs().find((item) => item.id === activeID()) ?? tabs()[0])
  const createdWebIDs = new Set<string>()
  let host: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined

  createEffect(() => {
    const request = props.request
    if (!request?.token || !request.value) return
    void openInputInNewTab(request.value, request.title)
  })

  createEffect(() => {
    if (!props.active) {
      hideWebTabs()
      return
    }
    const tab = activeTab()
    if (!tab || tab.kind !== "web") {
      hideWebTabs()
      return
    }
    void ensureWebTab(tab)
    updateBrowserBounds(tab.id)
  })

  onCleanup(() => {
    resizeObserver?.disconnect()
    tabs().forEach((tab) => {
      if (tab.kind === "web") void window.opencodex?.browser?.destroy(tab.id)
    })
  })

  function setActiveInput(value: string) {
    updateOpenTab(activeID(), { input: value })
  }

  function addBlankTab() {
    const id = newBrowserID()
    setTabs((current) => [...current, blankOpenTab(id)])
    setActiveID(id)
  }

  function closeTab(id: string) {
    const current = tabs()
    const index = current.findIndex((tab) => tab.id === id)
    const next = current.filter((tab) => tab.id !== id)
    if (current.find((tab) => tab.id === id)?.kind === "web") {
      createdWebIDs.delete(id)
      void window.opencodex?.browser?.destroy(id)
    }
    if (next.length === 0) {
      const nextID = newBrowserID()
      setTabs([blankOpenTab(nextID)])
      setActiveID(nextID)
      return
    }
    setTabs(next)
    if (activeID() === id) setActiveID(next[Math.min(index, next.length - 1)]?.id ?? next[0]!.id)
  }

  async function openActiveInput() {
    const tab = activeTab()
    if (!tab) return
    await openInput(tab.id, tab.input)
  }

  async function openInputInNewTab(value: string, title?: string) {
    const id = newBrowserID()
    setTabs((current) => [...current, { ...blankOpenTab(id), input: value, title: title || inputLabel(value, activeDirectory()) }])
    setActiveID(id)
    await openInput(id, value, title)
  }

  async function chooseSystemFile() {
    if (!window.opencodex?.file) {
      updateOpenTab(activeID(), { message: "Open file needs the latest desktop bridge. Restart OpencodeX and try again." })
      return
    }
    const path = await window.opencodex.file(activeDirectory())
    if (!path) return
    const file = pickedFileTarget(path, activeDirectory())
    const tab = activeTab()
    if (!tab || tab.kind === "blank") {
      await openFileTab(activeID(), file.path, undefined, file.directory)
      return
    }
    const id = newBrowserID()
    setTabs((current) => [...current, { ...blankOpenTab(id), input: file.input, title: compactPath(file.path), directory: file.directory }])
    setActiveID(id)
    await openFileTab(id, file.path, undefined, file.directory)
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

  async function ensureWebTab(tab: OpenTab) {
    if (!tab.url) return
    const next = await window.opencodex?.browser?.create({ id: tab.id, url: createdWebIDs.has(tab.id) ? undefined : tab.url })
    createdWebIDs.add(tab.id)
    if (next) updateOpenTab(tab.id, { state: next, title: next.title || tab.title, input: next.url || tab.input, url: next.url || tab.url })
  }

  async function navigateWebTab(id: string, url: string) {
    const browser = window.opencodex?.browser
    if (!browser) {
      updateOpenTab(id, { message: "Embedded browser is not available." })
      return
    }
    await ensureWebTab(tabs().find((tab) => tab.id === id) ?? blankOpenTab(id))
    const next = await browser.navigate({ id, url })
    createdWebIDs.add(id)
    if (next) updateOpenTab(id, { state: next, title: next.title || inputLabel(next.url), input: next.url || url, url: next.url || url, message: "" })
    updateBrowserBounds(id)
  }

  async function browserAction(action: "back" | "forward" | "reload" | "stop") {
    const tab = activeTab()
    if (!tab || tab.kind !== "web") return
    const next = await window.opencodex?.browser?.action({ id: tab.id, action })
    if (next) updateOpenTab(tab.id, { state: next, title: next.title || tab.title, input: next.url || tab.input, url: next.url || tab.url })
  }

  function updateBrowserBounds(id: string) {
    if (!host || !window.opencodex?.browser) return
    const rect = host.getBoundingClientRect()
    void window.opencodex.browser.bounds({
      id,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }).then((next) => {
      if (next) updateOpenTab(id, {
        state: next,
        title: next.title || (activeTab()?.title ?? "Web"),
        input: next.url || (activeTab()?.input ?? ""),
        url: next.url || activeTab()?.url,
      })
    })
    hideWebTabs(id)
    if (resizeObserver) return
    resizeObserver = new ResizeObserver(() => updateBrowserBounds(activeTab()?.id ?? id))
    resizeObserver.observe(host)
  }

  function hideWebTabs(exceptID = "") {
    tabs().filter((tab) => tab.kind === "web" && tab.id !== exceptID).forEach((tab) => {
      void window.opencodex?.browser?.bounds({ id: tab.id, x: 0, y: 0, width: 1, height: 1 })
    })
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
      <div class="session-open-chrome">
        <div class="session-open-tabs" role="tablist" aria-label="Open tabs">
          <For each={tabs()}>
            {(item) => (
              <button type="button" role="tab" aria-selected={activeID() === item.id} classList={{ active: activeID() === item.id }} onClick={() => setActiveID(item.id)}>
                <Icon name={item.kind === "file" ? "file" : item.kind === "web" ? "browser" : "plus"} />
                <span>{openTabLabel(item)}</span>
                <span
                  class="session-open-tab-close"
                  role="button"
                  tabIndex={0}
                  aria-label={`Close ${openTabLabel(item)}`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    closeTab(item.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    event.stopPropagation()
                    closeTab(item.id)
                  }}
                >
                  <Icon name="x" />
                </span>
              </button>
            )}
          </For>
          <IconButton class="session-open-new-tab" icon="plus" label="New tab" onClick={addBlankTab} />
        </div>
        <div class="session-open-bar">
          <IconButton icon="chevronLeft" label="Back" disabled={activeTab()?.kind !== "web" || !activeTab()?.state?.canGoBack} onClick={() => void browserAction("back")} />
          <IconButton icon="chevronRight" label="Forward" disabled={activeTab()?.kind !== "web" || !activeTab()?.state?.canGoForward} onClick={() => void browserAction("forward")} />
          <IconButton icon={activeTab()?.state?.loading ? "stop" : "activity"} label={activeTab()?.state?.loading ? "Stop loading" : "Reload"} disabled={activeTab()?.kind !== "web"} onClick={() => void browserAction(activeTab()?.state?.loading ? "stop" : "reload")} />
          <div class="session-open-location">
            <Icon name={activeTab()?.kind === "file" ? "file" : activeTab()?.kind === "web" ? "browser" : "search"} />
            <TextInput
              value={activeTab()?.input ?? ""}
              onInput={(event) => setActiveInput(event.currentTarget.value)}
              onKeyDown={(event) => event.key === "Enter" && void openActiveInput()}
              placeholder="Search or enter address"
            />
          </div>
          <IconButton variant="primary" icon="send" label="Open" onClick={() => void openActiveInput()} />
          <IconButton icon="folder-open" label="Open file" onClick={() => void chooseSystemFile()} />
          <IconButton icon="save" label="Save file" disabled={!dirty()} onClick={() => void saveActiveFile()} />
        </div>
      </div>
      <Show when={activeTab()?.message}>
        {(message) => <div class="session-side-message">{message()}</div>}
      </Show>
      <Switch>
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
          <div class="session-side-browser-host" ref={(element) => { host = element }} />
        </Match>
        <Match when={true}>
          <SessionOpenEmptyState directory={props.directory} addBlankTab={addBlankTab} chooseSystemFile={() => void chooseSystemFile()} />
        </Match>
      </Switch>
    </section>
  )
}

function SessionOpenEmptyState(props: { directory?: string; addBlankTab: () => void; chooseSystemFile: () => void }) {
  return (
    <div class="session-open-empty">
      <div class="session-open-empty-mark">
        <Icon name="browser" />
        <Icon name="file" />
      </div>
      <strong>Ready to open</strong>
      <span>{props.directory ? compactPath(props.directory) : "No project folder selected"}</span>
      <div class="session-open-empty-actions">
        <button type="button" onClick={props.chooseSystemFile}><Icon name="folder-open" /> Open file</button>
        <button type="button" onClick={props.addBlankTab}><Icon name="plus" /> New tab</button>
      </div>
    </div>
  )
}

function blankOpenTab(id: string): OpenTab {
  return { id, kind: "blank", input: "", title: "New tab", text: "", original: "" }
}

function openTabLabel(tab: OpenTab) {
  if (tab.kind === "file" && tab.path) return compactPath(tab.path)
  if (tab.kind === "web") return tab.state?.title || tab.title || tab.url || "Web"
  return tab.title || "New tab"
}

function isBrowserInput(value: string) {
  const input = value.trim()
  if (/^file:/i.test(input)) return false
  if (/^(https?|about):/i.test(input)) return true
  if (/^localhost(?::\d+)?(?:\/.*)?$/i.test(input)) return true
  if (/^(?:127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/.*)?$/i.test(input)) return true
  if (/^\[::1\](?::\d+)?(?:\/.*)?$/i.test(input)) return true
  if (/^[^\s/]+\.[^\s/]+(?:\/.*)?$/i.test(input)) return true
  return /^[^\s]+:\d+(?:\/.*)?$/i.test(input)
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

function pickedFileTarget(value: string, directory = "") {
  const input = normalizeFilePath(value)
  const root = normalizeRoot(directory)
  if (root && isWithinRoot(input, root)) {
    return {
      directory: root,
      path: input.slice(root.length + 1),
      input,
    }
  }
  const parent = parentPath(input)
  if (!parent) return { directory: root, path: input, input }
  return {
    directory: parent,
    path: input.slice(parent.length + 1),
    input,
  }
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

function parentPath(value: string) {
  const index = value.lastIndexOf("/")
  return index > 0 ? value.slice(0, index) : ""
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

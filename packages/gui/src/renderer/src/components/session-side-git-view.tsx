import { File as FileDiffView } from "@opencode-ai/ui/file"
import { resolveFileDiff } from "@opencode-ai/ui/session-diff"
import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import type { GuiClient } from "../lib/client"
import { flattenWorkbenchChangeTree, reconcileWorkbenchChangeRows, type WorkbenchChangeTreeRow } from "../lib/diff-file-tree"
import { shouldVirtualizeDiff } from "../lib/tool-display"
import { workbenchGitBranches, workbenchGitOperation } from "../lib/session-api"
import { Button, LoadingState, Select, TextArea, TextInput } from "./ui"
import { Icon } from "./icon"
import { ModalFrame } from "./modal-frame"
import { sidePanelChangeForPath, type SessionSideGitController } from "./session-side-git-controller"
import { clamp } from "./session-side-path"
import { VirtualList } from "./virtual-list"

const SPLIT_MIN = 0.22
const SPLIT_MAX = 0.55

export function SessionSideDiffPanel(props: {
  title: string
  controller: SessionSideGitController
  gui?: GuiClient
  directory?: string
  request?: { token: number; value?: string }
  openCommitModal: (path?: string) => void
  openFile: (path: string) => void
  refresh: () => void
  allowCommit?: boolean
  allowEdit?: boolean
}) {
  const [selectedFile, setSelectedFile] = createSignal("")
  const [collapsedTree, setCollapsedTree] = createSignal<ReadonlySet<string>>(new Set())
  const [treeFilter, setTreeFilter] = createSignal("")
  const [splitRatio, setSplitRatio] = createSignal(0.32)
  const [diffStyle, setDiffStyle] = createSignal<"unified" | "split">("unified")
  const [busyAction, setBusyAction] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [discardArmed, setDiscardArmed] = createSignal(false)
  let selectedIndex = 0
  let previousRows: readonly WorkbenchChangeTreeRow[] = []
  const rows = createMemo(() => {
    previousRows = reconcileWorkbenchChangeRows(previousRows, flattenWorkbenchChangeTree(props.controller.files(), collapsedTree(), treeFilter()))
    return previousRows
  })

  // Each new query re-reveals its matches fresh, so collapses made under the
  // previous filter do not leak into the next one.
  function updateTreeFilter(value: string) {
    setCollapsedTree(new Set<string>())
    setTreeFilter(value)
  }
  const selected = createMemo(() => sidePanelChangeForPath(props.controller.files(), selectedFile()))
  const selectedPatch = createMemo(() => selectedFile() ? props.controller.patch(selectedFile()) : undefined)

  createEffect(() => {
    const path = selectedFile()
    const files = props.controller.files()
    if (path && files.some((file) => file.path === path)) return
    const next = files[Math.min(selectedIndex, Math.max(0, files.length - 1))]
    setSelectedFile(next?.path ?? "")
  })
  createEffect(() => {
    const path = selectedFile()
    if (path) void props.controller.loadPatch(path)
  })
  createEffect(() => {
    selectedFile()
    setDiscardArmed(false)
    setNotice("")
  })

  async function runFileAction(action: "stage" | "unstage" | "discard") {
    const path = selected()?.path
    if (!props.gui || !path) return
    if (action === "discard" && !discardArmed()) {
      setDiscardArmed(true)
      setNotice("Discard removes this file's unstaged changes. Click Discard again to confirm.")
      return
    }
    setBusyAction(action)
    setNotice("")
    try {
      const result = action === "stage"
        ? await workbenchGitOperation(props.gui, action, { paths: [path] }, props.directory)
        : await workbenchGitOperation(props.gui, action, { paths: [path] }, props.directory)
      setNotice(result.message ?? (result.ok ? `${action === "stage" ? "Staged" : action === "unstage" ? "Unstaged" : "Discarded"} ${path}.` : `Could not ${action} ${path}.`))
      if (result.ok) props.refresh()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : `Could not ${action} ${path}.`)
    } finally {
      setBusyAction("")
      setDiscardArmed(false)
    }
  }
  createEffect(() => {
    const request = props.request
    if (!request?.token || !request.value) return
    const path = request.value
    setTreeFilter("")
    void props.controller.reveal(path).then((parents) => {
      setCollapsedTree((current) => new Set([...current].filter((item) => !parents.includes(item))))
      selectFile(path)
    })
  })

  function selectFile(path: string) {
    selectedIndex = Math.max(0, props.controller.files().findIndex((file) => file.path === path))
    setSelectedFile(path)
  }

  function startSplitResize(event: PointerEvent & { currentTarget: HTMLElement }) {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const width = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 1
    const startX = event.clientX
    const startRatio = splitRatio()
    const onMove = (moveEvent: PointerEvent) => setSplitRatio(clamp(startRatio + ((moveEvent.clientX - startX) / width), SPLIT_MIN, SPLIT_MAX))
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
          <span>
            {props.controller.branch() || (props.controller.mode() === "git" ? "Working tree" : "Project files")}
            {` · ${props.controller.summary().fileCount} file${props.controller.summary().fileCount === 1 ? "" : "s"} `}
            <b class="diff-additions">+{props.controller.summary().additions}</b>
            {" "}<b class="diff-deletions">-{props.controller.summary().deletions}</b>
            <Show when={!props.controller.manifestComplete()}>{` · ${props.controller.loading() ? "Loading" : "Loaded"} ${props.controller.manifestLoaded()}/${props.controller.manifestTotal()} changes`}</Show>
            <Show when={props.controller.manifestComplete() && !props.controller.summary().metricsComplete}>{` · Measuring ${props.controller.summary().metricsResolved}/${props.controller.summary().metricsTotal}`}</Show>
            <Show when={props.controller.refreshing()}> · Refreshing</Show>
            <Show when={props.controller.repository().ahead}>{` · ${props.controller.repository().ahead} ahead`}</Show>
            <Show when={props.controller.repository().behind}>{` · ${props.controller.repository().behind} behind`}</Show>
          </span>
        </div>
        <div class="session-side-git-header-actions">
          <Button appearance="outline" size="compact" type="button" onClick={() => setDiffStyle((value) => value === "unified" ? "split" : "unified")}><Icon name="panel" /> {diffStyle() === "unified" ? "Split diff" : "Unified diff"}</Button>
          <Show when={props.controller.mode() === "git" && props.allowCommit !== false}><Button appearance="soft" tone="success" size="compact" type="button" disabled={props.controller.loading()} onClick={() => props.openCommitModal()}><Icon name="send" /> Commit / Push</Button></Show>
          <Show when={props.controller.mode() === "directory"}><Button appearance="solid" tone="accent" size="compact" type="button" disabled={props.controller.initializing()} onClick={() => void props.controller.initializeRepository()}><Icon name="branch" /> {props.controller.initializing() ? "Initializing..." : "Initialize Git"}</Button></Show>
        </div>
      </header>
      <Show when={props.controller.ready()} fallback={
        <Show when={!props.controller.error()} fallback={<div class="session-side-empty"><span>{props.controller.error()}</span><Button appearance="ghost" size="compact" onClick={() => void props.controller.refresh()}>Retry</Button></div>}>
          <Show when={props.controller.loading()} fallback={<div class="session-side-empty"><span>{props.controller.available() ? "Git changes are not loaded." : "Waiting for a workspace connection."}</span><Show when={props.controller.available()}><Button appearance="ghost" size="compact" onClick={() => void props.controller.refresh()}>Retry</Button></Show></div>}>
            <LoadingState class="session-side-diff-loading" title={props.controller.slowLoading() ? "Still reading changes" : "Loading changes"} description={props.controller.slowLoading() ? "This workspace is taking longer than usual. Git is still scanning changed paths." : "Reading change paths without file contents."} />
          </Show>
        </Show>
      }>
        <div class="session-side-diff-body">
        <Show when={props.controller.refreshError()}>{(value) => <div class="session-side-git-notice"><span>{value()}</span><Button appearance="ghost" size="compact" onClick={() => void props.controller.refresh()}>Retry</Button></div>}</Show>
        <Show when={props.controller.metricsError()}>{(value) => <div class="session-side-git-notice">{value()} Existing files remain available.</div>}</Show>
        <Show when={props.controller.initializationError()}>{(value) => <div class="session-side-git-notice">{value()} Try initializing the repository again.</div>}</Show>
        <Show when={props.controller.files().length > 0} fallback={<div class="session-side-empty">{props.controller.message() || "No project changes."}</div>}>
          <div class="session-side-diff-layout" style={{ "--session-side-file-list-width": `${Math.round(splitRatio() * 10000) / 100}%` }}>
            <div class="session-side-file-pane">
            <div class="workbench-filter">
              <Icon name="search" />
              <TextInput type="search" aria-label="Filter changes" value={treeFilter()} placeholder="Filter changes" onInput={(event) => updateTreeFilter(event.currentTarget.value)} />
              <Show when={treeFilter()}>
                <Button appearance="ghost" type="button" aria-label="Clear change filter" onClick={() => updateTreeFilter("")}><Icon name="x" /></Button>
              </Show>
            </div>
            <Show when={rows().length > 0} fallback={<div class="session-side-empty">No matches.</div>}>
            <VirtualList
              items={rows()}
              rowHeight={30}
              class="session-side-file-list"
              role="tree"
              ariaLabel="Project changes"
              render={(row) => {
                const change = () => row.type === "file" ? props.controller.files().find((file) => file.path === row.path) : undefined
                return (
                   <Button appearance="ghost"
                     type="button"
                     role="treeitem"
                     class="workbench-file-row"
                     aria-expanded={row.type === "directory" ? !collapsedTree().has(row.path) : undefined}
                     classList={{ selected: row.path === selected()?.path, directory: row.type === "directory", expanded: row.type === "directory" && !collapsedTree().has(row.path), deleted: change()?.status === "deleted" }}
                    style={{ "--depth": String(row.depth), "--depth-lines": row.depth === 0 ? "0" : "1" }}
                    onClick={() => {
                      if (row.type === "directory") {
                        setCollapsedTree((current) => current.has(row.path)
                          ? new Set([...current].filter((path) => path !== row.path))
                          : new Set([...current, row.path]))
                        return
                      }
                      selectFile(row.path)
                    }}
                  >
                    <Show when={row.type === "directory"} fallback={<span class="workbench-tree-spacer" />}>
                      <span class="workbench-disclosure"><Icon name={collapsedTree().has(row.path) ? "chevronRight" : "chevronDown"} /></span>
                    </Show>
                    <Icon name={row.type === "directory" ? collapsedTree().has(row.path) ? "folder" : "folder-open" : "file"} />
                    <span>{row.name}</span>
                    <Show when={change()}>
                      {(file) => <small><Show when={!file().binary} fallback={<span>Binary</span>}><Show when={file().additions !== undefined && file().deletions !== undefined} fallback={<span>Measuring</span>}><b class="diff-additions">+{file().additions}</b><b class="diff-deletions">-{file().deletions}</b></Show></Show></small>}
                    </Show>
                  </Button>
                )}}
            />
            </Show>
            </div>
            <div class="session-side-diff-splitter" role="separator" aria-orientation="vertical" aria-valuemin={Math.round(SPLIT_MIN * 100)} aria-valuemax={Math.round(SPLIT_MAX * 100)} aria-valuenow={Math.round(splitRatio() * 100)} tabIndex={0} onPointerDown={startSplitResize} onKeyDown={(event) => {
              const next = event.key === "ArrowLeft" ? splitRatio() - 0.03 : event.key === "ArrowRight" ? splitRatio() + 0.03 : event.key === "Home" ? SPLIT_MIN : event.key === "End" ? SPLIT_MAX : undefined
              if (next === undefined) return
              event.preventDefault()
              setSplitRatio(clamp(next, SPLIT_MIN, SPLIT_MAX))
            }}>
              <Icon name="grip" />
            </div>
            <main class="session-side-patch">
              <Show when={selected()} fallback={<div class="session-side-empty">Select a file.</div>}>
                {(file) => (
                  <section>
                    <header data-side-panel-file={file().path}>
                       <div><strong>{file().path}</strong><span>{file().status}</span></div>
                       <div class="session-side-file-git-actions">
                         <Show when={props.allowEdit !== false && file().openable}><Button appearance="ghost" onClick={() => props.openFile(file().path)}>Edit</Button></Show>
                         <Show when={props.controller.mode() === "git" && (file().unstaged || file().untracked)}><Button appearance="ghost" disabled={busyAction() !== ""} onClick={() => void runFileAction("stage")}>Stage</Button></Show>
                         <Show when={props.controller.mode() === "git" && file().staged}><Button appearance="ghost" disabled={busyAction() !== ""} onClick={() => void runFileAction("unstage")}>Unstage</Button></Show>
                         <Show when={props.controller.mode() === "git" && (file().unstaged || file().untracked)}><Button appearance="ghost" tone="danger" disabled={busyAction() !== ""} onClick={() => void runFileAction("discard")}>{discardArmed() ? "Confirm discard" : "Discard"}</Button></Show>
                         <Show when={props.controller.mode() === "git" && props.allowCommit !== false}><Button appearance="ghost" onClick={() => props.openCommitModal(file().path)}>Commit file</Button></Show>
                       </div>
                    </header>
                    <Show when={notice()}>{(value) => <div class="session-side-git-notice">{value()}</div>}</Show>
                    <Show when={selectedPatch()} fallback={<div class="session-side-empty">Select a file to load its patch.</div>}>
                      {(patch) => <>
                        <Show when={patch().pages.length > 0} fallback={<Show when={patch().complete}><div class="session-side-empty">{patch().message ?? (patch().binary ? "Binary patch is not displayed." : "No text patch available.")}</div></Show>}>
                          <div class="session-side-patch-pages"><For each={patch().pages}>{(text) => <SideDiffPatch file={file().path} patch={text} diffStyle={diffStyle()} />}</For></div>
                        </Show>
                        <Show when={props.controller.patchLoading() === file().path}><div class="session-side-patch-progress">Loading more patch…</div></Show>
                      </>}
                    </Show>
                  </section>
                )}
              </Show>
            </main>
          </div>
        </Show>
        </div>
      </Show>
    </section>
  )
}

export function SidePanelGitCommitModal(props: {
  gui?: GuiClient
  directory?: string
  branch?: string
  repository?: { upstream?: string; remoteUrl?: string; ahead?: number }
  paths?: string[]
  close: () => void
  refresh: () => void
}) {
  const [branches] = createResource(() => props.gui, (gui) => workbenchGitBranches(gui, props.directory))
  const currentBranch = createMemo(() => props.branch ?? branches()?.current ?? "")
  const [branch, setBranch] = createSignal(currentBranch())
  const [message, setMessage] = createSignal("")
  const [body, setBody] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [busy, setBusy] = createSignal<"" | "commit" | "commit-push" | "push">("")
  const changedPaths = createMemo(() => props.paths?.filter(Boolean) ?? [])
  const allChanges = createMemo(() => changedPaths().length === 0)
  const canPushAfterCommit = createMemo(() => !!props.repository?.upstream || !!props.repository?.remoteUrl)
  const canPushOnly = createMemo(() => !!props.repository?.remoteUrl && (!props.repository?.upstream || (props.repository.ahead ?? 0) > 0))
  const pushLabel = createMemo(() => props.repository?.upstream ? "Push" : "Publish branch")

  createEffect(() => setBranch(currentBranch()))

  async function run(action: "commit" | "commit-push" | "push") {
    if (!props.gui) {
      setNotice("GUI client is not ready.")
      return
    }
    setBusy(action)
    setNotice("")
    try {
      const result = await runGitCommitFlow({
        gui: props.gui,
        directory: props.directory,
        action,
        currentBranch: currentBranch(),
        branch: branch(),
        paths: changedPaths(),
        all: allChanges(),
        message: message(),
        body: body(),
        publish: !props.repository?.upstream,
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
      description={allChanges() ? "All changes in the working tree" : `${changedPaths().length} file${changedPaths().length === 1 ? "" : "s"} in the working tree`}
      close={props.close}
      footer={<div class="session-git-modal-actions">
        <Button appearance="ghost" onClick={props.close}>Cancel</Button>
        <Button icon="send" disabled={!canPushOnly() || busy() !== ""} onClick={() => void run("push")}>{busy() === "push" ? "Pushing..." : pushLabel()}</Button>
        <Button icon="check" disabled={!message().trim() || busy() !== ""} onClick={() => void run("commit")}>{busy() === "commit" ? "Committing..." : "Commit"}</Button>
        <Button appearance="solid" tone="accent" icon="send" disabled={!message().trim() || !canPushAfterCommit() || busy() !== ""} onClick={() => void run("commit-push")}>{busy() === "commit-push" ? "Working..." : `Commit + ${pushLabel()}`}</Button>
      </div>}
    >
      <div class="session-git-modal-body">
        <div class="session-git-modal-summary">
          <div><span>Current branch</span><strong>{currentBranch() || "No branch"}</strong></div>
          <div><span>Remote</span><strong>{props.repository?.upstream ?? (props.repository?.remoteUrl ? "Publish required" : "No remote")}</strong></div>
          <div><span>Changes</span><strong>{allChanges() ? "All files" : `${changedPaths().length} file${changedPaths().length === 1 ? "" : "s"}`}</strong></div>
        </div>
        <Select<string> label="Branch" options={branches()?.branches ?? (currentBranch() ? [currentBranch()] : [])} current={branch()} onSelect={(value) => value && setBranch(value)} />
        <label><span>Commit summary</span><TextInput value={message()} onInput={(event) => setMessage(event.currentTarget.value)} placeholder="Describe the change" autofocus /></label>
        <label><span>Description</span><TextArea value={body()} onInput={(event) => setBody(event.currentTarget.value)} placeholder="Optional details" /></label>
        <div class="session-git-modal-status"><span>Push readiness</span><span>{props.repository?.upstream ? `${props.repository.upstream}${props.repository.ahead ? `, ${props.repository.ahead} ahead` : ""}` : props.repository?.remoteUrl ? "No upstream. Push will publish this branch." : "No remote configured."}</span></div>
        <Show when={notice()}>{(value) => <p class="session-git-modal-notice">{value()}</p>}</Show>
      </div>
    </ModalFrame>
  )
}

function SideDiffPatch(props: { file: string; patch: string; diffStyle: "unified" | "split" }) {
  const fileDiff = createMemo(() => resolveFileDiff({ file: props.file, patch: props.patch }))
  return <div class="session-side-diff-patch tool-file-diff"><FileDiffView mode="diff" fileDiff={fileDiff()} diffStyle={props.diffStyle} overflow="scroll" virtualize={shouldVirtualizeDiff(props.patch)} hunkSeparators="simple" /></div>
}

async function runGitCommitFlow(input: {
  gui: GuiClient
  directory?: string
  action: "commit" | "commit-push" | "push"
  currentBranch: string
  branch: string
  paths: string[]
  all: boolean
  message: string
  body: string
  publish: boolean
}) {
  if (input.branch && input.branch !== input.currentBranch) {
    const checkout = await workbenchGitOperation(input.gui, "checkout", { branch: input.branch }, input.directory)
    if (!checkout.ok) return { ok: false, message: checkout.message ?? "Could not checkout branch." }
  }
  if (input.action !== "push") {
    const stage = await workbenchGitOperation(input.gui, "stage", input.all ? { all: true } : { paths: input.paths }, input.directory)
    if (!stage.ok) return { ok: false, message: stage.message ?? "Could not stage files." }
    const commit = await workbenchGitOperation(input.gui, "commit", { message: input.message.trim(), body: input.body.trim() || undefined, paths: input.all ? undefined : input.paths }, input.directory)
    if (!commit.ok) return { ok: false, message: commit.message ?? "Could not create commit." }
  }
  if (input.action === "commit") return { ok: true, message: "Committed changes." }
  const push = await workbenchGitOperation(input.gui, input.publish ? "publish" : "push", undefined, input.directory)
  return { ok: push.ok, message: push.message ?? (push.ok ? "Pushed current branch." : "Could not push current branch.") }
}

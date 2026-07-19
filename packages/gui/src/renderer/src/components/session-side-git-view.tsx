import { File as FileDiffView } from "@opencode-ai/ui/file"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import type { GuiClient } from "../lib/client"
import { buildDiffFileTree, expandedDirectories, flattenDiffFileTree } from "../lib/diff-file-tree"
import { patchContents } from "../lib/tool-display"
import { workbenchGitOperation, type DiffFile, type WorkbenchGitBranches, type WorkbenchGitStatus } from "../lib/store"
import { Button, Select, TextArea, TextInput } from "./ui"
import { Icon } from "./icon"
import { ModalFrame } from "./modal-frame"
import { sidePanelDiffForPath } from "./session-side-git-controller"
import { clamp } from "./session-side-path"

const SPLIT_MIN = 0.22
const SPLIT_MAX = 0.55

export function SessionSideDiffPanel(props: {
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
    const file = sidePanelDiffForPath(props.files, request.value)
    if (file?.file) setSelectedFile(file.file)
  })

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
          <span>{props.files.length} file{props.files.length === 1 ? "" : "s"} <b class="diff-additions">+{totals().additions}</b> <b class="diff-deletions">-{totals().deletions}</b></span>
        </div>
        <Button appearance="ghost" type="button" class="session-side-git-action" disabled={props.loading} onClick={props.openCommitModal}><Icon name="send" /> Commit / Push</Button>
      </header>
      <Show when={!props.loading} fallback={<div class="session-side-empty">Loading diff...</div>}>
        <Show when={props.files.length > 0} fallback={<div class="session-side-empty">{props.empty}</div>}>
          <div class="session-side-diff-layout" style={{ "--session-side-file-list-width": `${Math.round(splitRatio() * 10000) / 100}%` }}>
            <aside class="session-side-file-list">
              <For each={rows()}>
                {(row) => (
                  <Button appearance="ghost"
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
                        <Show when={row.type === "directory"}><Icon name={expandedTree().has(row.id) ? "chevronDown" : "chevronRight"} /></Show>
                      </span>
                      <strong>{row.name}</strong>
                    </span>
                    <Show when={row.file}>
                      {(file) => <small><b class="diff-additions">+{file().additions}</b><b class="diff-deletions">-{file().deletions}</b></small>}
                    </Show>
                  </Button>
                )}
              </For>
            </aside>
            <div class="session-side-diff-splitter" role="separator" aria-orientation="vertical" tabIndex={0} onPointerDown={startSplitResize}>
              <Icon name="grip" />
            </div>
            <main class="session-side-patch">
              <Show when={selected()} fallback={<div class="session-side-empty">Select a file.</div>}>
                {(file) => (
                  <section>
                    <header data-side-panel-file={file().file ?? ""}><strong>{file().file ?? ""}</strong><span>{file().status}</span></header>
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

export function SidePanelGitCommitModal(props: {
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
    const paths = props.status?.files.map((file) => file.path).filter(Boolean) ?? []
    return paths.length > 0 ? paths : props.files.map((file) => file.file).filter((file): file is string => !!file)
  })
  const canPushAfterCommit = createMemo(() => !!props.status?.upstream || !!props.status?.remoteUrl)
  const canPushOnly = createMemo(() => !!props.status?.remoteUrl && (!props.status?.upstream || (props.status.ahead ?? 0) > 0))
  const pushLabel = createMemo(() => props.status?.upstream ? "Push" : "Publish branch")

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
      footer={<div class="session-git-modal-actions">
        <Button appearance="ghost" onClick={props.close}>Cancel</Button>
        <Button icon="send" disabled={!canPushOnly() || busy() !== ""} onClick={() => void run("push")}>{busy() === "push" ? "Pushing..." : pushLabel()}</Button>
        <Button icon="check" disabled={!message().trim() || changedPaths().length === 0 || busy() !== ""} onClick={() => void run("commit")}>{busy() === "commit" ? "Committing..." : "Commit"}</Button>
        <Button appearance="solid" tone="accent" icon="send" disabled={!message().trim() || changedPaths().length === 0 || !canPushAfterCommit() || busy() !== ""} onClick={() => void run("commit-push")}>{busy() === "commit-push" ? "Working..." : `Commit + ${pushLabel()}`}</Button>
      </div>}
    >
      <div class="session-git-modal-body">
        <div class="session-git-modal-summary">
          <div><span>Current branch</span><strong>{props.status?.branch ?? "No branch"}</strong></div>
          <div><span>Remote</span><strong>{props.status?.upstream ?? (props.status?.remoteUrl ? "Publish required" : "No remote")}</strong></div>
          <div><span>Changes</span><strong>{changedPaths().length} file{changedPaths().length === 1 ? "" : "s"}</strong></div>
        </div>
        <Select<string> label="Branch" options={props.branches?.branches ?? (currentBranch() ? [currentBranch()] : [])} current={branch()} onSelect={(value) => value && setBranch(value)} />
        <label><span>Commit summary</span><TextInput value={message()} onInput={(event) => setMessage(event.currentTarget.value)} placeholder="Describe the change" autofocus /></label>
        <label><span>Description</span><TextArea value={body()} onInput={(event) => setBody(event.currentTarget.value)} placeholder="Optional details" /></label>
        <div class="session-git-modal-status"><span>Push readiness</span><span>{props.status?.upstream ? `${props.status.upstream}${props.status.ahead ? `, ${props.status.ahead} ahead` : ""}` : props.status?.remoteUrl ? "No upstream. Push will publish this branch." : "No remote configured."}</span></div>
        <Show when={notice()}>{(value) => <p class="session-git-modal-notice">{value()}</p>}</Show>
      </div>
    </ModalFrame>
  )
}

function SideDiffPatch(props: { file: string; patch: string }) {
  const contents = createMemo(() => patchContents(props.patch, props.file))
  return <div class="session-side-diff-patch"><Show when={contents()} fallback={<pre>{props.patch}</pre>}>
    {(value) => <FileDiffView mode="diff" before={value().before} after={value().after} diffStyle="unified" overflow="scroll" virtualize={false} hunkSeparators="simple" />}
  </Show></div>
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
    const commit = await workbenchGitOperation(input.gui, "commit", { message: input.message.trim(), body: input.body.trim() || undefined }, input.directory)
    if (!commit.ok) return { ok: false, message: commit.message ?? "Could not create commit." }
  }
  if (input.action === "commit") return { ok: true, message: "Committed changes." }
  const push = await workbenchGitOperation(input.gui, input.publish ? "publish" : "push", undefined, input.directory)
  return { ok: push.ok, message: push.message ?? (push.ok ? "Pushed current branch." : "Could not push current branch.") }
}
